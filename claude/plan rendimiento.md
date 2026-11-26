# Plan: rendimiento en producción (carga de datos y documentos)

Anotado el 2026-11-25 para ejecutarlo después. **Nada de esto está hecho todavía.** Ver "Orden de ejecución" al final.

## Por qué

En producción, la información tarda en cargar y abrir un documento cargado es lento. La revisión del código del
2026-11-25 dio estos resultados.

**La base de datos no es el cuello de botella.**
- En local, con el mismo código y esquema, todas las consultas responden en menos de 0,16 s.
- Las tablas de asistencia y RRHH tienen sus índices por empleado y fecha:
  - `jornada(users_company_id, fecha)` y `jornada_evento(jornada_id, ocurrido_en)`;
  - `horario_asignado`, `novedad_rrhh(contrato, fecha_inicial)` y `empleado_archivo(users_company_id, categoria)`;
  - `molinete_marcacion` y `hora_extra`.
- El SQL está parametrizado y el pool de 10 conexiones alcanza.
- Hay consultas dentro de ciclos (`for … await`), pero solo en cargues e importaciones, no en las pantallas.

**El tiempo se va en transferir datos y en descargar cosas completas antes de mostrarlas.**

| Medición (local, 2026-11-25) | Hoy | Con gzip |
|---|---|---|
| `GET /api/users-company`: 509 empleados, 51 campos cada uno | 835 KB | 73 KB |
| `GET /api/users-company/novedades` | 487 KB | 30 KB |
| `GET /api/users-company/pasivo-vacacional` | 250 KB | — |
| `GET /api/asistencia/financiera/en-vivo` | 284 KB | — |
| `GET /api/users-company/catalogos` | 124 KB | — |
| JS del frontend (`dist/assets/index-*.js`, un solo archivo) | 2,5 MB | — |

## Hallazgos y cambios, de mayor a menor impacto

### 1. Comprimir las respuestas

**Hallazgo.** Express no comprime: no hay middleware `compression` en `index.js`. No está documentado cómo está
nginx en `srv845606`. Con la configuración por defecto de nginx (`gzip on` sin `gzip_types`), solo se comprime HTML,
así que JSON, JS y CSS viajan sin comprimir.

**Cambio.**
- Backend: `npm i compression` y `app.use(compression())` antes de las rutas. Con el filtro por defecto solo se
  comprime lo comprimible (JSON, texto). PDF, xlsx e imágenes salen igual y conservan las peticiones por rangos.
- nginx (frontend):
  - `gzip_types` con `application/javascript`, `text/css`, `application/json` e `image/svg+xml`;
  - `Cache-Control: public, max-age=31536000, immutable` **solo** para `/assets/`, cuyos nombres llevan hash;
  - `index.html` con `no-cache`. Si se cachea, después de un despliegue la gente sigue con la versión vieja.

**Antes, confirmar en el servidor:**
```
grep -n "gzip" /etc/nginx/nginx.conf /etc/nginx/sites-enabled/*
curl -sI -H "Accept-Encoding: gzip" https://<dominio>/assets/<archivo>.js | grep -i content-encoding
```

**Riesgo bajo:** el navegador descomprime solo.

### 2. Documentos: abrir sin descargar el archivo completo antes

**Hallazgo.** El frontend pide el archivo con axios y `responseType: 'blob'` (`src/services/api.js`):
- `descargarDocumento`;
- `descargarArchivoExpediente`;
- `descargarSoporte` de novedades y traspasos;
- `descargarDocumentoExpediente`;
- los documentos de Hydra.

Solo cuando termina lo muestra en `PrevisualizacionDocumento.jsx`. La documentación y el contrato son PDF de hasta
50 MB (`claude/modulo recursoshumanos.md` §42), así que no se ve nada hasta el 100 %. El backend ya los envía en
streaming con `res.sendFile`, que admite peticiones por rangos.

**Cambio: enlace temporal firmado.**
- Endpoint nuevo por tipo de archivo, `POST …/enlace`. Revisa **los mismos permisos de hoy**: admin solo lectura,
  `verificarGestionRRHH`, `ver_empleados_rrhh`, SST en Hydra. Devuelve una URL con un token propio:
  - JWT con `proposito: 'archivo'`, la ruta del recurso y el usuario;
  - vence a los 60 s;
  - no sirve como sesión.
- La ruta de descarga acepta ese token por query (`?t=`) además del header. El iframe o `<embed>` abre la URL
  directo: el visor del navegador muestra la primera página apenas llega y pide el resto por rangos.
- **Las rutas actuales no se tocan.** El frontend viejo sigue funcionando, y la descarga con botón puede seguir con blob.

**Riesgo:** es un cambio de seguridad.
- El token va en la URL (historial, logs de nginx). Por eso vale para un solo archivo y vence en un minuto.
- Probar que un enlace vencido o de otro archivo da 401/403.

### 3. Traer solo lo que se usa

**Hallazgos.**
- `RecursosHumanosLayout.jsx` llama a `novedadRrhhService.getAll()` (487 KB) al cargar el layout, solo para mostrar
  el número de la pestaña "Novedades".
- `GET /users-company` devuelve 51 campos por empleado (unos 1,6 KB cada uno) y la tabla muestra unos 12.

**Cambio.**
- Endpoint de conteo, `GET /users-company/novedades/conteo`, que devuelva `{ total }`. Se agrega aparte y no se quita
  nada.
- Lista de empleados más liviana. Antes de quitar un campo, buscar en todo el frontend quién lo lee: tabla, vista de
  tarjetas, filtros (campaña, estado, cargo, analista, documentos, rango de fechas), KPI y descargas. **Solo se quita lo
  que nadie usa.** La ficha y la edición ya piden `GET /users-company/:id` aparte.

**Riesgo:** medio en la lista, porque si se quita un campo que alguna vista usa, esa vista se rompe en silencio. Se
cubre con la búsqueda anterior y probando todas las vistas.

### 4. Frontend por pantalla (code splitting)

**Hallazgo.** `App.jsx` importa todas las pantallas de forma estática y Vite genera un solo JS de 2,5 MB con todos los
módulos: incidentes, inventario, RRHH, asistencia, jsPDF y html2canvas. Cada usuario descarga todo aunque use un solo
módulo.

**Cambio.**
- `React.lazy` + `Suspense` por ruta, o al menos por módulo (layouts y pantallas grandes).
- jsPDF y html2canvas con `import()` dinámico al generar el PDF.

**Riesgo:** quien tenga la pestaña abierta durante un despliegue podría pedir un archivo de pantalla que ya no existe
("Failed to fetch dynamically imported module"). Se cubre de dos formas:
- se conservan los archivos de la versión anterior en el servidor (ver despliegue seguro);
- un manejador global de `vite:preloadError` / error de `import()` recarga la página una vez.

### 5. Índice por cédula (menor)

**Hallazgo.** Hay 8 consultas que buscan `users_company.numero_identificacion = ?` sin el tipo de documento: AsisLock,
molinete y Hydra, en `models/UserCompany.js`, `repositories/asistencia/empleadoRepository.js` y
`repositories/contratacionHydra/*`. El único índice es `uq_users_identificacion(tipo, numero)`, que no sirve para la
cédula sola. Con 509 filas no se nota.

**Cambio.** Migración con el siguiente número libre, revisando `ls migrations/`:
`CREATE INDEX idx_users_company_numero ON users_company (numero_identificacion)`, idempotente. Se aplica a mano en
producción. Con 509 filas toma menos de un segundo y no bloquea.

## Despliegue sin errores para quien está usando el programa

| Momento | Qué pasa hoy | Cómo se evita |
|---|---|---|
| `pm2 restart gestor-backend` (2 a 5 s) | Una petición en esos segundos falla, por ejemplo "Error al guardar". Socket.IO se reconecta solo. | El backend nuevo es **compatible con el frontend viejo**: solo agrega rutas. Se sube primero y en un momento tranquilo. |
| `npm run build` del frontend (unos 20 s) | **Riesgo que ya existe hoy:** Vite vacía `dist/` al empezar. Quien abra o recargue en esos segundos ve una pantalla en blanco. | Script de despliegue seguro (abajo): compila en otra carpeta y la cambia de un golpe. |
| Después del despliegue | Quien tiene la pestaña abierta sigue con la versión vieja hasta recargar. | Con el cambio 4: conservar los assets anteriores y recargar automáticamente si falta un archivo. |

**Integraciones.**
- El intermediario del molinete reintenta (`asistencia.md` §80.1).
- No está confirmado que AsisLock reintente. Por eso el reinicio del backend debe caer en un momento de pocos logueos.

**Script de despliegue seguro del frontend.** Va en el repo del frontend, por ejemplo `scripts/desplegar.sh`:
1. `npm ci && npx vite build --outDir dist-nuevo`;
2. copiar a `dist-nuevo/assets/` los assets de `dist/assets/` que no existan, para que las pestañas viejas los
   encuentren. Limpiar los de más de N despliegues;
3. `mv dist dist-anterior && mv dist-nuevo dist`, que es casi instantáneo;
4. si algo falla, `mv dist-anterior dist`.

nginx sigue sirviendo desde `dist/` sin cambios de configuración.

**Cuándo desplegar:**
- fuera de horario, temprano en la mañana o después del cierre de turnos;
- lejos de las 11:30 p. m. Bogotá, cuando corre el cierre nocturno (`asistencia.md` §77);
- primero el backend y después el frontend.

## Verificación antes de entregar

- 466 tests del backend (`node --test "tests/**/*.test.js"`) y `npm run build`.
- Navegador con cada rol, en claro y en oscuro: RRHH, financiera, admin de solo lectura, SST, jefe y empleado.
  Confirmar que no hay errores en consola.
- Abrir **y** descargar cada tipo de documento:
  - documentación y contrato;
  - expediente;
  - soportes de novedades y de traspasos;
  - documento del expediente enlazado a una novedad;
  - documentos de Hydra (candidato y empleado).
- Seguridad:
  - el admin sigue sin escribir;
  - un enlace vencido o de otro archivo no abre;
  - el token de archivo no sirve como sesión.
- Medir de nuevo las respuestas de la tabla de arriba con `Accept-Encoding: gzip`, y el tamaño del JS inicial.

## Orden de ejecución

Un commit por cambio, para poder revertir cada uno por separado:

1. Script de despliegue seguro del frontend. Sirve desde ya, aunque no se haga nada más.
2. Compresión en Express. Ajuste de nginx, que hace el usuario en el servidor.
3. Enlace temporal para documentos (backend y frontend).
4. Conteo de novedades y lista de empleados más liviana.
5. Frontend por pantalla, con la recarga automática.
6. Migración del índice por cédula (opcional).
