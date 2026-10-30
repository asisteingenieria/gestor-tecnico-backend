# Módulo Recursos Humanos — Contexto y Bitácora de Cambios

> Este documento tiene dos partes: (1) lo que ya existe hoy — el apartado "Empleados" (llamado "Personal" por el usuario) dentro del rol `gestorActivos` — y (2) la bitácora de cambios que se van aplicando para crear el nuevo rol `recursosHumanos` y trasladarle ese módulo. Se actualiza en cada paso de la implementación.

> ⚠️ **Regla fija sobre qué campos puede tener el formulario de alta/edición manual de empleado
> (`AgentForm.jsx`, paso "Personal"/"Contratación"): las únicas dos hojas de Excel que cuentan
> como fuente de verdad son la hoja "Nuevo Epleado" (sic) de `Descargas/DATOS (1) (1).xlsx` y la
> hoja "EJEMPLO" de `Descargas/NominaEmpleadosWO190723-1 0826.xlsx`.** Confirmado explícitamente
> por el usuario dos veces (sesión 2026-09-29, ver §18 y su reiteración posterior). No agregar,
> mostrar ni pedir en ese formulario ningún campo que no exista en esas dos hojas — ni siquiera si
> existe en la hoja "TOTAL PERSONAL" (esa es la fuente del *import masivo*, tiene columnas extra
> como traslado/retiro/vacunación/analista/observaciones que "Nuevo Epleado" y "EJEMPLO" no traen,
> ver §18.7) ni si la columna ya tiene lugar en el esquema de BD. Antes de agregar un campo nuevo
> al formulario manual, verificar contra estas dos hojas puntuales, no contra el esquema ni contra
> otras hojas del mismo Excel.

## 1. Estado actual (antes de tocar nada) — apartado "Empleados" / "Personal"

### 1.1 Qué es

Módulo de gestión de empleados sobre la tabla `users_company` (ver también `claude/contextoriginal.md` §5). Hoy vive **dentro del rol `gestorActivos`**, como una pestaña más de "Gestión de Activos" llamada **"Empleados"** en el menú (el usuario se refiere a ella como "Personal").

### 1.2 Dónde está implementado

**Backend**

| Archivo | Rol que involucra | Detalle |
|---|---|---|
| `routes/usersCompany.js` | `gestorActivos`, `admin` | Middleware local `verificarGestorActivos` (líneas 6-14) bloquea todo el router a quien no sea `gestorActivos` o `admin`. Todas las rutas de `/api/users-company` pasan por `verifyToken` + este middleware. |
| `controllers/userCompanyController.js` | — | Lógica de negocio (CRUD transaccional de empleados, catálogos, asignación de activos). No tiene checks de rol propios; confía en el middleware de la ruta. |
| `models/UserCompany.js` | — | Acceso a datos. |
| `controllers/userController.js` (líneas 93, 96, 143, 183, 186, 240) | `validRoles` para crear/editar usuarios del sistema | Lista blanca de roles asignables desde `UserManagement`: `['admin', 'coordinador', 'supervisor', 'technician', 'jefe_operaciones', 'administrativo', 'gestorActivos', 'tecnicoInventario', 'disenador']`. **No incluye `directivoFinanciero`** (se crea por script aparte) — precedente a tener en cuenta: agregar un rol nuevo aquí es obligatorio para poder crearlo desde la UI de admin. |
| `database` — columna `users.role` (ENUM) | — | El dump `database/gestor.sql` está desactualizado (solo llega hasta `gestorActivos`, migración 015). Los roles `tecnicoInventario`, `directivoFinanciero` y `disenador` están en producción vía ALTER TABLE aplicados manualmente — **no hay migración versionada para `directivoFinanciero` ni `disenador`** en `migrations/`. El patrón de migración correcto para agregar un rol es el de `015_add_gestor_activos_role_and_activos_table_fixed.sql` y `021_add_tecnico_inventario_role_and_history.sql`: `ALTER TABLE users MODIFY COLUMN role ENUM(...lista completa...) NOT NULL DEFAULT 'technician';` (hay que reescribir el ENUM completo, no se puede "agregar" un valor suelto). |
| `middleware/auth.js` | — | No tiene un middleware específico para `gestorActivos` (los checks van inline en las rutas, ver tabla de arriba). Sí existen middlewares con patrón `verifyRole([...])` para otros módulos (`canAccessAssets`, `isDirectivoFinanciero`, `isDisenador`, etc.) que se pueden usar como plantilla. |

**Frontend**

| Archivo | Detalle |
|---|---|
| `src/context/AuthContext.jsx` (línea ~112) | Expone el flag `isGestorActivos: user?.role === 'gestorActivos'`. No hay flag `isRecursosHumanos` todavía. |
| `src/App.jsx` | Ruta `activos/empleados` envuelta en `<GestorActivosRoute><AgentManagement /></GestorActivosRoute>` (guard basado en `isGestorActivos`). `LayoutWrapper` asigna `AssetLayout` a todo el rol `gestorActivos` (no solo a la parte de activos). `RedirectByRole`/`DashboardRoute` redirigen a `gestorActivos` → `/activos`. |
| `src/components/AssetLayout.jsx` (líneas 28-59) | Menú lateral de `gestorActivos` con 5 items: Ingresar Activos, Crear desde Script, Inventario, Análisis y Gráficos, **Empleados** (`href: '/activos/empleados'`, icono `Users`). Header fijo dice "Gestión de Activos" y el badge de usuario dice "Gestor de Activos" (hardcodeado, línea 167). |
| `src/components/AgentManagement.jsx` | Componente de listado/gestión de empleados (tabla con info laboral). Usa `userCompanyService` (`/api/users-company`). |
| `src/components/AgentForm.jsx` | Formulario único por secciones (datos personales, contrato, salario, seguridad social, cuenta bancaria, dirección, contacto de emergencia) — carga catálogos vía `/users-company/catalogos` y el empleado completo al editar. |
| `src/components/AssetForm.jsx` | Selector de empleado (`nombre_completo`) para asignar un activo — **esto pertenece al módulo de Activos, no al de Empleados**; ojo con no romper esta dependencia cruzada si se mueve el módulo de empleados. `userCompanyService.getAll()` probablemente se sigue necesitando ahí aunque el CRUD de empleados se traslade a RRHH. |
| `src/services/api.js` | `userCompanyService` (líneas ~145-155): `getAll`, `getById`, `create`, `update`, `delete`, `getGastoTotal`, `getActivos`, `assignActivo`, `unassignActivo`. Todo apunta a `/users-company/*`. |

### 1.3 Resumen del acceso actual

Hoy, para llegar al módulo de Empleados hace falta:
1. Tener `role = 'gestorActivos'` (o `admin`, que pasa todos los checks de rol pero no tiene ítem de menú propio para esto — un admin tendría que navegar directo a la URL).
2. El guard de frontend `GestorActivosRoute` (basado en `isGestorActivos`).
3. El middleware de backend `verificarGestorActivos` en `routes/usersCompany.js`.

No existe hoy ningún concepto de "recursos humanos" en el código (ni rol, ni flag, ni middleware, ni componente).

---

## 2. Decisiones de alcance (confirmadas con el usuario)

1. **Acceso exclusivo, no compartido**: `gestorActivos` pierde el módulo de gestión de Empleados (menú, ruta, CRUD completo). El módulo pasa a ser propiedad de `recursosHumanos` (+ `admin`).
2. **Conflicto detectado y resuelto**: `AssetForm.jsx` (módulo Activos, rol `gestorActivos`) llama a `GET /api/users-company` para poblar el selector "agente asignado" al crear/editar un activo. Se optó por dejar esa única ruta (`GET /`) accesible en **modo solo lectura** también para `gestorActivos`, mientras que catálogos, ficha completa, alta, edición, baja y asignación/desasignación de activos a un empleado quedan exclusivos de `recursosHumanos`/`admin`.

Checklist — todo aplicado:

- [x] **Backend — DB**: migración `037_add_recursos_humanos_role.sql` (agrega `recursosHumanos` al ENUM `users.role`; de paso versiona `directivoFinanciero` y `disenador`, que no tenían migración registrada). **Pendiente de ejecutar manualmente en la base de datos** (no hay runner automático) — query entregada al usuario, aún no aplicada.
- [x] **Backend — `routes/usersCompany.js`**: reemplazado el middleware único `verificarGestorActivos` por dos: `verificarLecturaEmpleados` (`gestorActivos`, `recursosHumanos`, `admin` — solo en `GET /`) y `verificarRecursosHumanos` (`recursosHumanos`, `admin` — todas las demás rutas).
- [x] **Backend — `controllers/userController.js`**: `recursosHumanos` agregado a `validRoles` (líneas ~93 y ~183), a los mensajes de error de rol inválido, y a la condición que anula `sede`/`departamento` en `createUser` y `updateUser` (mismo trato que `gestorActivos`/`tecnicoInventario`/`disenador`).
- [x] **Frontend — `AuthContext.jsx`**: agregado flag `isRecursosHumanos: user?.role === 'recursosHumanos'`.
- [x] **Frontend — `App.jsx`**: nuevo guard `RecursosHumanosRoute`; `LayoutWrapper` usa `RecursosHumanosLayout` para el rol; `RedirectByRole` y `DashboardRoute` redirigen a `/recursos-humanos`; ruta `activos/empleados` eliminada y reemplazada por `recursos-humanos` (fuera del bloque de rutas de Activos), envuelta en `RecursosHumanosRoute` + `AgentManagement`.
- [x] **Frontend — `RecursosHumanosLayout.jsx`** (nuevo archivo): layout propio, calcado de `AssetLayout` pero con un único ítem de menú "Empleados" → `/recursos-humanos`, header y badge de usuario "Recursos Humanos".
- [x] **Frontend — `AssetLayout.jsx`**: quitado el ítem de menú "Empleados" y el import no usado del icono `Users`.
- [x] **Frontend — `AgentManagement.jsx`/`AgentForm.jsx`**: sin cambios de código — siguen hablando con `/api/users-company`; ahora solo son alcanzables desde `/recursos-humanos` bajo el rol nuevo.
- [x] **Frontend — `AssetForm.jsx`**: sin cambios de código — su `GET /users-company` directo sigue funcionando porque `gestorActivos` conserva lectura de esa ruta puntual.
- [x] **Frontend — `UserManagement.jsx`** (no estaba en el plan original, se detectó al implementar): agregado `recursosHumanos` al arreglo `roles` (selector de alta/edición), al filtro por rol, a la lógica de "sin sede específica" en el listado, a la condición que oculta el campo Sede en el formulario, y un mensaje informativo propio cuando se selecciona el rol.

**Verificación hecha:** `node -c` sobre los dos archivos backend tocados (sin errores de sintaxis); `npx eslint` sobre los archivos frontend tocados/creados (solo advertencias/errores preexistentes no relacionados, en `UserManagement.jsx` y `AuthContext.jsx`); `npx vite build --mode development` completo sin errores (solo warnings preexistentes de tamaño de chunk). No se probó en navegador con un usuario `recursosHumanos` real porque el rol todavía no existe en la base de datos (falta correr la migración `037`).

---

## 3. Bug encontrado en pruebas y corregido

**Síntoma:** usuario con `role = 'recursosHumanos'` migrado en BD, login OK, redirigido correctamente a `/recursos-humanos`, pero la pantalla mostraba "Acceso Denegado — Solo los gestores de activos pueden acceder a esta sección."

**Causa:** `AgentManagement.jsx` tenía un guard de acceso **propio**, independiente del guard de ruta (`RecursosHumanosRoute`) en `App.jsx`: `const { isGestorActivos } = useAuth(); if (!isGestorActivos) { return <AccesoDenegado.../> }` (línea ~11 y ~28-38). No estaba contemplado en el checklist original porque se asumió que el único control de acceso al componente era el guard de ruta; en realidad el componente se protegía dos veces.

**Fix aplicado:** `src/components/AgentManagement.jsx` — cambiado `isGestorActivos` → `isRecursosHumanos` en la desestructuración de `useAuth()` y en la condición, y el mensaje de la pantalla de denegado a "Solo Recursos Humanos puede acceder a esta sección." Se verificó que `AgentForm.jsx` no tiene un guard equivalente (no hacía falta tocarlo) y que los `isGestorActivos` restantes en el código (`AssetManagement.jsx`, `AssetInventory.jsx`, `AssetCharts.jsx`, `App.jsx`) pertenecen legítimamente al módulo de Activos.

**Nota (no corregida, fuera de alcance):** ese mismo bloque en `AgentManagement.jsx` tiene un `return` condicional antes de un `useEffect` (línea ~40), lo que viola las reglas de hooks de React (`react-hooks/rules-of-hooks`, detectado por ESLint). Es preexistente al cambio de rol, no algo introducido en este trabajo; en la práctica no debería dispararse porque el componente solo se monta cuando el guard de ruta ya validó el rol. Queda pendiente si se quiere limpiar en otro momento.

---

## 4. Segundo bug encontrado en pruebas y corregido

**Síntoma:** con el guard de `AgentManagement.jsx` ya arreglado, al crear un empleado desde `/recursos-humanos` con datos de seguridad social, la petición `POST /api/users-company` devolvía 500: `"Out of range value for column 'tarifa_arl' at row 1"`.

**Diagnóstico:** se reprodujo directamente contra el backend en ejecución (JWT generado a mano con el `JWT_SECRET` del `.env`, sin pasar por el navegador) para aislar la causa sin depender de contar con la traza completa. Con un payload mínimo válido el alta funciona perfectamente (confirmó que el módulo, las rutas y la migración `037` ya aplicada están bien). El error solo aparece con `seguridad_social.tarifa_arl` fuera de rango: la columna `seguridad_social.tarifa_arl` es `DECIMAL(8,5)` (máx. `999.99999`), pensada para un porcentaje (ej. `0.522`), y el formulario (`AgentForm.jsx`) no tenía tope superior en el input (`type="number"` sin `max`), dejando pasar valores como `5454` que MySQL rechaza en modo estricto con un error crudo que llegaba tal cual al usuario como 500.

**Fix aplicado (defensa en dos capas, preexistente al cambio de rol — no introducido por él, pero bloqueaba la primera prueba real del módulo):**
- `controllers/userCompanyController.js` — `validarObligatorios(data)`: nueva validación que rechaza con 400 claro (`"La tarifa ARL debe ser un porcentaje entre 0 y 100"`) si `seguridad_social.tarifa_arl` es no numérico o está fuera de `[0, 100]`, antes de llegar a la base de datos. Aplica tanto a `create` como a `update` (comparten la misma función de validación).
- `src/components/AgentForm.jsx` — agregado `max: 100` al input de "Tarifa ARL (%)" (antes solo tenía `min: 0`).

**Verificado:** reproducción directa contra el backend con `tarifa_arl: '5454'` ahora devuelve `400 {"success":false,"message":"La tarifa ARL debe ser un porcentaje entre 0 y 100"}` en vez del 500 crudo. `node -c` y `eslint` sin errores nuevos.

---

## 5. Comparación esquema vs Excel fuente (`Descargas/DATOS.xlsx`)

El usuario explicó que las tablas del módulo de empleados (migración `034`, 32 tablas) se crearon con base en los campos de la hoja "TOTAL PERSONAL" de este Excel, pero el archivo trae 4 hojas en total: `TOTAL PERSONAL`, `CONSOLIDADO NOVEDADES`, `TRASPASOS`, `PASIVO VACACIONAL`. Se leyeron las 4 hojas (librería `xlsx` del frontend, vía script Node temporal) y se compararon sus encabezados campo a campo contra el esquema real (columnas confirmadas contra la migración `034` completa + `DESCRIBE` en vivo de las tablas núcleo).

### Hoja "TOTAL PERSONAL" — casi completa, gaps puntuales
- ⚠️ **`Banco` no tiene columna en el Excel**, pero `cuenta_bancaria.banco_idbanco` es `NOT NULL` en la BD. Revisar con el usuario de dónde saldrá ese dato al migrar filas reales.
- ⚠️ Sin cobertura: fecha/bandera de "Traslado" de EPS/AFP/Cesantías (el modelo solo cierra el registro anterior con `CURDATE()` al cambiar de entidad, no admite una fecha de traslado histórica); vacunación COVID (tipo, 1ª y 2ª dosis); Entrega de Equipo, Serial Diadema, Locker; RUT, Piso, Carnet; Analista Encargado; Dotación y tallas (camisa/pantalón/calzado).
- Todo lo demás (identificación, datos personales, contrato, salario, dirección, contacto de emergencia, EPS/ARL/AFP/Cesantías/Caja sin el traslado) sí tiene columna equivalente.

### Hoja "CONSOLIDADO NOVEDADES" — mapea a `novedad_rrhh`, con huecos documentales
Cubre bien: tipo de novedad, accidente de tránsito, fechas (inicial/final/retorno/recibido), total de días, diagnóstico, observaciones, responsable. Sin cobertura: `Fecha reporte`, `Origen de INC`, y los flags de soportes documentales (**Documento Original, Copia, Historia Clínica, RUNT, FURIPS, SOAT**) — no existen como columnas.

### Hoja "TRASPASOS" — sin tabla dedicada
No existe ninguna tabla de auditoría de cambios de área/cargo/campaña/centro de costo (solo `historial_salarial` cubre el salario, y no guarda el "anterior vs nuevo" de esos otros campos). Tampoco hay tracking de periodo de trabajo en casa (fecha inicio/fin), diadema, equipo de cómputo asignado en el contexto de un traspaso, ni "ratificación". Sería una tabla/migración nueva completa si se quiere implementar.

### Hoja "PASIVO VACACIONAL" — sin ninguna tabla
No existe ningún esquema de vacaciones: días trabajados/acumulados/tomados/compensados, pasivo vacacional, ni el historial de periodos tomados (fecha inicio/fin por periodo). Módulo completamente no implementado.

**Pendiente de decisión con el usuario:** priorizar qué gaps cerrar primero (se sugirió empezar por `banco` en `cuenta_bancaria` por ser bloqueante para migrar la Hoja 1 tal cual) y si se diseñan migraciones nuevas para Traspasos y Pasivo Vacacional.

---

## 6. Migraciones 038 y 039 (esquema actual + gaps del Excel)

El usuario pegó un script "VERSION DEFINITIVA" que resultó ser **idéntico** (mismas 32 tablas y columnas) a la migración `034` ya aplicada — se verificó con `diff` línea por línea, sin diferencias estructurales (solo comentarios y el bloque `CREATE SCHEMA`/`USE`/rollback). Confirmado que no había nada nuevo que agregar por ese lado.

A partir de eso se crearon dos migraciones nuevas:

- **`038_esquema_empleados_actual_snapshot.sql`** — snapshot documentado del esquema ya aplicado (las mismas 32 tablas de la `034`), pero usando `CREATE TABLE IF NOT EXISTS` en vez de `DROP TABLE IF EXISTS + CREATE TABLE`. **Importante:** se evitó a propósito el patrón DROP+CREATE de la `034` porque ya hay empleados reales cargados en `users_company` (incluido el de prueba del rol `recursosHumanos`) — un DROP los habría borrado. Es segura de correr en cualquier entorno (no-op si las tablas ya existen, las crea igual si no).
- **`039_esquema_empleados_campos_faltantes.sql`** — cierra los gaps identificados en la sección 5 (comparación contra el Excel):
  - `ALTER TABLE seguridad_social`: `fecha_traslado` + `entidad_anterior_id` (FK).
  - `ALTER TABLE users_company`: `rut`.
  - `ALTER TABLE contrato`: `piso` + `analista_encargado_id` (FK a `users_company`, mismo patrón que `jefe_inmediato_id`/`jefe_area_id`).
  - `ALTER TABLE retiro`: `equipo_entregado`.
  - `ALTER TABLE novedad_rrhh`: `fecha_reporte`, `origen_incapacidad`, `tiene_documento_original`, `tiene_copia_documento`, `tiene_historia_clinica`, `tiene_runt`, `tiene_furips`, `tiene_soat`.
  - Tabla nueva `vacunacion_covid` (1:1 con `users_company`).
  - Tabla nueva `dotacion` (1:N, historial de entregas de uniforme por empleado).
  - Tabla nueva `asignacion_recurso` (1:N — diadema/locker/carnet; usa columna de texto `tipo_recurso` en vez de un catálogo nuevo, siguiendo el mismo patrón que `seguridad_social.tipo`).
  - Tabla nueva `traspaso` (1:N con `contrato` — snapshot "anterior" vs "nuevo" de área/cargo/campaña/centro de costo/salario/modalidad, más trabajo en casa, diadema, equipo, ratificación). No existía ninguna tabla de auditoría de estos cambios.
  - Tablas nuevas `vacaciones` + `periodo_vacacional` (normalizando los ~10 grupos repetidos de "Periodo Tomado/Fecha Inicio/Fecha Final" del Excel en filas 1:N en vez de columnas repetidas). No existía ningún esquema de vacaciones.

**Validado:** ambas migraciones se corrieron contra una base de datos temporal (`test_migracion_039_temp`, creada y destruida en la misma prueba, sin tocar `call_center_support`) usando el pool `mysql2` del propio backend. Resultado: 038 y 039 corren sin errores, 32 + 6 = 38 tablas resultantes, todas las FK resuelven correctamente.

**Corrección de normalización (tras revisión pedida por el usuario):** la primera versión de `039` tenía 4 inconsistencias frente al patrón de las 32 tablas originales, corregidas antes de darla por terminada:
1. `vacunacion_covid.tipo_vacuna` y `asignacion_recurso.tipo_recurso` eran VARCHAR libres → ahora son catálogos nuevos (`tipo_vacuna`, `tipo_recurso`, con seed básico) + FK, igual que `tipo_identificacion`/`genero`/`modalidad`/etc.
2. Las FK de `traspaso` hacia catálogos (`area`, `campania`, `centro_costo`, `cargo` ×2, `modalidad`) estaban en `ON DELETE SET NULL` → corregidas a `RESTRICT`, igual que sus equivalentes en `contrato` (`fk_contrato_area`, `fk_contrato_cargo`, etc.), para no perder el snapshot histórico si se borra un valor de catálogo.
3. `seguridad_social.entidad_anterior_id` estaba en `SET NULL` → corregida a `RESTRICT`, igual que `entidad_seguridad_social_id` en la misma tabla.
4. Las FK hacia `users_company` que representan un **rol de persona** (`jefe_area`/`jefe_inmediato` anterior y nuevo en `traspaso`, `analista_encargado_id` en `contrato`) se dejaron en `SET NULL`, que es lo correcto — coincide con el patrón ya usado en `fk_contrato_jefe_inmediato`/`fk_contrato_jefe_area`.

Revalidado contra la BD temporal tras el fix: 40 tablas, 35 FKs en las tablas nuevas/tocadas, reglas `ON DELETE` confirmadas una por una (ver bitácora del script de validación — no se dejó archivo, se verificó inline y se descartó).

**No ejecutadas todavía contra la base de datos real** — quedan pendientes de que el usuario las corra manualmente (no hay migration runner automático en este proyecto). Tras aplicarlas, sería necesario además: actualizar `models/UserCompany.js` y `controllers/userCompanyController.js` para leer/escribir los campos y tablas nuevas (hoy el modelo no los toca), y extender `AgentForm.jsx`/`AgentManagement.jsx` en el frontend para exponerlos en la UI. Ese trabajo de modelo/controlador/UI no se ha hecho aún — por ahora solo existe el esquema.

---

## 7. Módulos "Consolidado Novedades", "Traspasos" y "Pasivo Vacacional" (UI + backend completos)

Tras aplicar `038`/`039`, el usuario pidió las pantallas para las 3 hojas del Excel que aún no tenían UI. Se implementó backend + frontend completo para las 3.

**Migración adicional — `040_seed_tipo_novedad.sql`:** se detectó que `tipo_novedad` seguía vacío (0 filas) desde la 034 original — sin eso era imposible crear una `novedad_rrhh` (FK `NOT NULL`). Se sembró con 8 categorías `RRHH` (incapacidades, licencias, calamidad doméstica, permiso remunerado) y 4 `OPERACION` (tardanza, ausentismo, hora extra, cambio de turno). **Ya aplicada directamente contra `call_center_support`** (es solo INSERT, bajo riesgo).

**Backend — modelos nuevos:**
- `models/NovedadRrhh.js` — CRUD simple con joins a `contrato`→`users_company` (nombre/identificación del empleado), `tipo_novedad`, `cargo`/`campania`/`centro_costo`, y `users_company` para `responsable_id`.
- `models/Traspaso.js` — CRUD con ~33 columnas (snapshot anterior/nuevo); usa un array `CAMPOS` compartido entre INSERT y UPDATE para no desalinear los `?`. Joins a `area`/`campania`/`centro_costo`/`cargo`/`modalidad` (anterior y nuevo por separado).
- `models/Vacaciones.js` — CRUD transaccional (`db.getConnection()` + `beginTransaction`) porque `vacaciones` tiene un 1:N con `periodo_vacacional`; en `update` se reemplazan **todos** los periodos (`DELETE` + reinserción), mismo patrón que `diseno_entregas/replace`.

**Backend — controller/rutas:** todo bajo `/api/users-company` (mismo router/controller del módulo de empleados, no un módulo nuevo separado):
```
GET/POST      /users-company/novedades
GET/PUT/DELETE /users-company/novedades/:novedadId
GET/POST      /users-company/traspasos
GET/PUT/DELETE /users-company/traspasos/:traspasoId
GET/POST      /users-company/vacaciones
GET/PUT/DELETE /users-company/vacaciones/:vacacionesId
```
Registradas **antes** de `/:id` en `routes/usersCompany.js` para no colisionar (mismo criterio que `/catalogos` y `/gasto-total`). Protegidas con `verificarRecursosHumanos` (no con el middleware de solo-lectura). `UserCompany.getCatalogos()` ahora también devuelve `tipos_novedad`.

**Bug encontrado y corregido durante las pruebas:** en `models/Traspaso.js` usé `mod` como alias de tabla para el JOIN a `modalidad` — `MOD` es palabra reservada en MySQL (operador de módulo), causaba `500` en `GET /traspasos` (el `POST` sí pasaba porque no hacía ese JOIN). Renombrado a `modal`.

**Frontend — 6 archivos nuevos** (`NovedadesRRHH.jsx`+`NovedadForm.jsx`, `Traspasos.jsx`+`TraspasoForm.jsx`, `PasivoVacacional.jsx`+`VacacionesForm.jsx`), siguiendo el mismo estilo que `AgentManagement`/`AgentForm` (tabla + modal, Tailwind, mismos helpers de campo). Detalles de diseño:
- El selector de empleado en los 3 formularios usa `GET /users-company` (que ya trae `idcontrato` por empleado) para resolver `contrato_id` — **no** se usa `catalogos.empleados` (ese solo trae `id`+`nombre_completo`, sin `idcontrato`).
- `TraspasoForm`: al elegir un empleado, hace `GET /users-company/:id` (`getByIdCompleto`) y precarga el bloque "Estado anterior" con los valores actuales del contrato/salario; el bloque "Estado nuevo" arranca como copia editable del anterior.
- `VacacionesForm`: lista de periodos repetible (agregar/quitar filas) que se manda como array `periodos` al backend, que hace el reemplazo completo.
- Nuevos ítems de menú en `RecursosHumanosLayout.jsx` (Consolidado Novedades, Traspasos, Pasivo Vacacional) y rutas `recursos-humanos/novedades|traspasos|vacaciones` en `App.jsx`, todas bajo `RecursosHumanosRoute`.

**Bug de convención corregido antes de terminar:** los 3 componentes nuevos copiaron el patrón de `AgentManagement.jsx` de poner el `if (!isRecursosHumanos) return <AccesoDenegado/>` **antes** del `useEffect` (viola `react-hooks/rules-of-hooks`, detectado por ESLint). A diferencia del caso de `AgentManagement.jsx` (código preexistente, se dejó así), aquí sí se corrigió moviendo el check después de todos los hooks, ya que es código nuevo y no había motivo para propagar el anti-patrón tres veces más.

**Verificado extensivamente contra el backend real** (con JWT generado a mano, igual que las pruebas anteriores): `POST`/`GET` de las 3 entidades, `PUT` con reemplazo de periodos en vacaciones (confirmado que el periodo viejo se borra y quedan solo los nuevos), y limpieza de todos los registros de prueba (0 filas residuales en las 3 tablas). `node -c` en todo el backend tocado, `eslint` sin errores en todo el frontend tocado/creado, `npx vite build` sin errores nuevos.

**Nota operativa:** al correr `vite build` para validar, se modificó por efecto secundario la carpeta `dist/` (versionada en el repo del frontend) — se restauró a su estado original con `git checkout -- dist/` + `git clean -fd dist/` antes de terminar, ya que no era parte del cambio pedido.

**No aplicado a la base real:** nada de esta sección requería DDL nuevo (solo el seed `040`, ya aplicado). El código de rutas/controller/modelos/frontend ya está listo para usar en cuanto el backend/frontend se reinicien recojan los cambios.

---

## 8. Filas desplegables + paginación (20 en 20) en las 4 tablas de RRHH

El usuario pidió que cada tabla del módulo (Empleados, Consolidado Novedades, Traspasos, Pasivo Vacacional) tuviera: (1) un botón para desplegar/ocultar el detalle de cada fila, y (2) paginación de 20 en 20 registros para mejorar el rendimiento. Se interpretó como aplicable a las 4 tablas del módulo (todo lo construido hasta ahora en RRHH), no solo a una.

**`components/Pagination.jsx`** (nuevo, reutilizado en las 4 tablas): botones anterior/siguiente + "Mostrando X-Y de Z" + "Página N de M". Paginación **client-side** sobre el array ya filtrado por búsqueda (no server-side — no se agregó `LIMIT`/`OFFSET` al backend); mejora el rendimiento de renderizado en el DOM, no la carga de red. Si en el futuro las listas crecen mucho, ahí sí valdría la pena paginar en el backend.

**Patrón aplicado en las 4 tablas** (`AgentManagement.jsx`, `NovedadesRRHH.jsx`, `Traspasos.jsx`, `PasivoVacacional.jsx`): columna nueva con botón chevron (`ChevronDown`/`ChevronUp` de lucide-react) al inicio de cada fila; al hacer clic, se inserta una `<tr>` adicional con un panel de detalle (grid de campos) que ocupa todo el ancho (`colSpan`); un `Set` de ids expandidos permite tener varias filas abiertas a la vez. `useEffect` resetea la página a 1 cuando cambia el término de búsqueda.

**Qué muestra el detalle de cada tabla** (todo con datos ya presentes en el payload de `getAll`, sin fetches adicionales, salvo el caso de Vacaciones):
- **Empleados**: fecha de nacimiento, género, estado civil, grupo sanguíneo, número de hijos, RUT, ciudad de nacimiento/expedición, fecha de expedición, área, tipo de contrato, usuario SSFF.
- **Novedades**: cargo, centro de costo, fecha de retorno/recibido/reporte, origen de la incapacidad, diagnóstico, observaciones, y los 6 soportes documentales mostrados uno por uno con ✓/✗ (en la fila principal solo se veía el contador "x/6").
- **Traspasos**: estado, fecha fin, modalidad, centro de costo anterior→nuevo, trabajo en casa, diadema, equipo, y una tabla comparativa anterior/nuevo de campaña, cargo SSFF, usuario SSFF y ambos bonos. Los campos de jefe de área/inmediato se dejaron fuera del detalle porque el payload de `getAll` solo trae su ID, no su nombre (no se agregaron joins nuevos al backend para esto, por mantener el cambio acotado a la UI que se pidió).
- **Pasivo Vacacional**: cargo, campaña, centro de costo, y la lista de periodos tomados — este es el único caso con **carga perezosa**: `getAll` no trae los periodos (solo `total_periodos`), así que al expandir por primera vez se llama `vacacionesService.getById(id)` y el resultado se cachea en estado local (`periodosPorRegistro`) para no repetir la petición si se vuelve a expandir la misma fila.

**Bug de convención corregido de paso:** al tocar `AgentManagement.jsx` de fondo, se aprovechó para mover el `if (!isRecursosHumanos) return ...` después de los `useEffect` (mismo problema de `react-hooks/rules-of-hooks` que ya se había corregido en los otros 3 componentes en la sesión anterior, pendiente en este archivo porque era el único preexistente).

**Verificado:** `eslint` sin errores en los 5 archivos tocados/creados, `npx vite build` sin errores nuevos. De nuevo se restauró `dist/` con `git checkout -- dist/` + `git clean -fd dist/` tras la validación.

---

## 8.1 Nombres de jefe de área / jefe inmediato en el detalle de Traspasos

Se cerró el hueco que se había dejado a propósito en la sección anterior: `models/Traspaso.js` ahora hace 4 self-joins a `users_company` (uno por cada combinación jefe_area/jefe_inmediato × anterior/nuevo, alias `jaa`/`jan`/`jia`/`jin`) para resolver `jefe_area_anterior_nombre`, `jefe_area_nuevo_nombre`, `jefe_inmediato_anterior_nombre`, `jefe_inmediato_nuevo_nombre`. El detalle desplegable de `Traspasos.jsx` ahora incluye esas dos filas en la tabla comparativa anterior/nuevo.

**Verificado:** query probada contra el backend real (POST con `jefe_area_anterior_id`/`jefe_inmediato_nuevo_id`, GET confirmando que ambos nombres resuelven correctamente), sin errores de columnas ambiguas. `node -c` y `eslint` sin errores. Dato de prueba limpiado.

---

## 9. Pendiente

- Migraciones `037`, `038`, `039` y `040` — **todas ya aplicadas por el usuario** contra `call_center_support`.
- Probar en el navegador (no se ha hecho manualmente todavía, solo verificado por API con JWT generado a mano):
  - `/recursos-humanos` — CRUD de empleados (ya se probó antes en esta sesión).
  - `/recursos-humanos/novedades` — crear/editar/eliminar una novedad, revisar que los 6 checkboxes de soportes documentales guarden bien.
  - `/recursos-humanos/traspasos` — confirmar que al elegir un empleado se precargue correctamente el bloque "Estado anterior" con sus datos reales de contrato/salario.
  - `/recursos-humanos/vacaciones` — agregar/quitar periodos en el formulario y confirmar que el listado en la tabla ("Periodos") refleje el conteo correcto tras guardar.
  - Confirmar que `gestorActivos` conserve el selector de "agente asignado" en `AssetForm` pero ya no vea ningún ítem de RRHH en su menú.
- Los catálogos `tipo_retiro` y `motivo_retiro` (usados por la tabla `retiro`, fuera del alcance de esta sesión) siguen vacíos — la funcionalidad de "retiro" de empleados sigue sin controlador/ruta/UI. Queda para una sesión futura si se necesita.

---

## 10. Cierre — commit, merge a main y deploy a producción (2026-07-21)

Todo lo de este documento (backend + frontend) terminó **commiteado, pusheado y mergeado a `main`** en ambos repos oficiales (`asisteingenieria/gestor-tecnico-backend` y `-frontend`), commit `"modulo recursos humanos"` (`f944c7e` en backend, PR #9 en ambos). Verificado byte a byte que el contenido pusheado coincide exactamente con lo que se había construido en esta sesión.

**Descubrimiento importante durante el deploy:** ambos servidores de producción ya tenían mergeados directamente (fuera del flujo git de la empresa) commits de los repos personales de otro desarrollador (`davidzaratecamp/gestor-backend` y `-frontend` — ver detalle completo en `claude/contextoriginal.md` §7). El `git pull origin main` en producción, hecho después de este merge, trajo el módulo RRHH y se mezcló con esos commits externos **sin ningún conflicto de git** en ninguno de los dos repos (verificado antes con un merge de prueba en rama descartable, y confirmado en el pull real).

**Deploy backend:** `git pull` en `/root/gestor-tecnico-backend` generó un merge commit (`cf3a75c`) sin conflictos. Quedaron sueltos en el working directory (no forman parte del merge, preexistentes) `migrations/026_add_directivo_financiero_role.sql` y `scripts/createTestCoordinadorClaro.js` — pendiente decidir si se commitean o se descartan.

**Deploy frontend:** `git pull` en `/var/www/gestor-tecnico-frontend` requirió especificar estrategia (`git pull --no-rebase origin main`) porque el `main` local del servidor ya divergía; mergeó limpio (estrategia `ort`, sin conflictos). **Pendiente en el momento de cerrar esta sesión:** correr `npm install && npm run build` en el servidor (el pull no reconstruye `dist/`) y luego `nginx -t && systemctl reload nginx` — sin este paso el bug original del rol `disenador` (menú lateral vacío) sigue sin resolverse en producción, porque nginx sirve `dist/` tal cual está commiteado, y ese pull no lo tocó.

**No resuelto todavía:** colisión de numeración de migraciones `027`/`028` entre el repo oficial y los repos personales de David (ver `claude/contextoriginal.md` §7) — falta renumerar antes de correr esas migraciones contra la BD real, si no se han corrido ya.

---

## 11. Sesión 2026-09-15 — Perfil del empleado, datos de prueba y un bug del modelo

### 11.1 Modal "Ver perfil del empleado" (nuevo)

**Nuevo:** `src/components/EmpleadoPerfilModal.jsx`
**Modificado:** `src/components/AgentManagement.jsx` — botón de ojo "Ver perfil" como primera acción de cada fila, antes de los de activos, editar y eliminar.

Modal de solo lectura que muestra **toda** la información del empleado en 8 secciones: datos personales, dirección de residencia, información laboral (con jefe inmediato y jefe de área resueltos a nombre), salario vigente, seguridad social (EPS, ARL con tarifa, AFP, cesantías, caja), cuenta bancaria, contacto de emergencia y tabla de activos asignados.

Cierra con `Escape` o con los botones de la cabecera y el pie. Cancela la petición si se cierra antes de que responda.

**Detalle clave de implementación:** `GET /users-company/:id` (`getByIdCompleto`) devuelve **IDs de catálogo, no nombres** — está pensado para alimentar el formulario de edición, no para mostrarse. Por eso el modal carga en paralelo tres endpoints ya existentes:

```
GET /users-company/:id           → empleado con secciones anidadas (IDs)
GET /users-company/catalogos     → ~20 catálogos para resolver esos IDs a nombres
GET /users-company/:id/activos   → activos asignados
```

y resuelve cada ID con un helper `nombreDe(lista, id, render)`, el mismo enfoque que ya usa `AgentForm.jsx`. **No hizo falta ningún endpoint ni consulta nueva en el backend.**

Excepción: los campos que `SELECT_EMPLEADO` ya trae resueltos (`tipo_identificacion_nombre`, `estado_civil_nombre`, `grupo_sanguineo_nombre`, `genero_nombre`, `ciudad_nacimiento_nombre`, `ciudad_expedicion_nombre`) se usan directo, sin pasar por el catálogo.

**Trampa con la tabla `activos`:** las columnas son `numero_placa`, `marca_modelo`, `numero_serie_fabricante`, `ubicacion`, `estado` — **no** `placa`/`marca`/`modelo`. El primer intento usó los nombres equivocados y hubo que corregirlo contra el esquema real.

**Estado de verificación:** `vite build` compila. Lint: 1 error `Icon is defined but never used`, falso positivo del `eslint.config.js` del repo (no incluye el plugin de React y por eso no ve componentes usados en JSX); `AssetDetailModal.jsx:141` y `Tecnicos.jsx:486` tienen el mismo error con el mismo patrón `({ icon: Icon })`. **No probado en el navegador.**

### 11.2 Bug del modelo: `contrato.piso` y `users_company.rut` nunca se guardan

Las migraciones `038`/`039` agregaron ambas columnas, pero **`models/UserCompany.js` no las cableó**:

- `camposPersonales()` no incluye `rut` en su arreglo de valores.
- `insertarContrato()` no incluye `piso` (ni `analista_encargado_id`) en la lista de columnas del `INSERT`.
- Los `UPDATE` correspondientes tampoco.

Consecuencia: aunque el payload los traiga, **siempre quedan en `NULL`**. Esto afecta al formulario real de RRHH (`AgentForm.jsx`), no solo a scripts de prueba — si el formulario expone esos campos, el usuario los llena y se pierden en silencio.

Detectado al verificar tabla por tabla los empleados sembrados en §11.3.

**Corregido** (sesión 2026-09-23, como efecto colateral del trabajo de import masivo — ver
[[project-rrhh-bulk-import]]): `camposPersonales()` ya incluye `rut`, e `insertarContrato()` ya
incluye `piso` en el `INSERT`; los `UPDATE` correspondientes de `update()` también los escriben.
Confirmado leyendo `models/UserCompany.js` el 2026-09-30. No se necesitó tocar la BD, solo el
modelo.

### 11.3 Datos de prueba — `scripts/seedEmpleadosAsistencia.js`

Creado para poder probar el futuro módulo de asistencia (ver `asistencia.md` y `claude/contextoriginal.md` §8), pero es igual de útil para probar el módulo de RRHH, porque puebla **todas** las tablas del esquema de empleados.

Crea 1 director (`users_company.id=7`) y 5 empleados a su cargo (ids 8–12), cédulas `9000000001`–`9000000006`. Cada uno con `contrato` activo, `historial_salarial`, las 5 afiliaciones de `seguridad_social`, `cuenta_bancaria`, `direccion` y `contacto_emergencia`. Los 5 empleados tienen `contrato.jefe_inmediato_id = 7`.

Es **idempotente**: si el empleado ya existe llama a `UserCompany.update` en vez de `create`. Reutiliza los modelos en lugar de escribir SQL propio, de modo que el alta pasa por la misma transacción que usa la app real — lo que a su vez sirve como prueba de humo del modelo.

Efecto secundario observado: correrlo dos veces con salarios distintos dejó **2 filas en `historial_salarial`** por empleado, 1 vigente. Es el comportamiento correcto del modelo (cierra la vigencia anterior y abre una nueva), y de paso confirma que esa lógica funciona.

### 11.4 Filtro nuevo en `GET /users-company` (2026-09-16, no es de esta sesión)

`GET /users-company?sin_usuario=true` devuelve solo empleados **sin** cuenta de login
vinculada (`users.users_company_id`). Se agregó para el selector de creación de usuarios
`director_operaciones`/`empleado` del admin (`/users`), no para este módulo — se documenta
aquí porque toca `UserCompany.getAll()` (ahora recibe `{ soloSinUsuario }`) y
`userCompanyController.getAll`. Sin filtro, el comportamiento no cambió. Detalle completo en
`asistencia.md` §15.

### 11.5 Catálogos: duplicados detectados

Al inspeccionar la BD local para el seed aparecieron catálogos con filas duplicadas, probablemente por correr los seeds `035`/`036` más de una vez:

- **`tipo_contrato`**: 10 filas que son 5 valores repetidos (ids 1–5 y 6–10: Indefinido, Fijo, Obra o labor, Prestación de servicios, Aprendizaje). **Sigue sin limpiar** — fuera del alcance de la sesión 2026-09-24 (§12.4), que solo pidió arreglar `ciudad`.
- **`ciudad`**: ~~40 filas con al menos Bogotá (1 y 21), Barranquilla (4 y 24) y Villavicencio (12 y 32) duplicadas.~~ **Corregido, ver §12.4.**

No rompe nada — las FK apuntan a un id válido — pero los selectores del formulario muestran opciones repetidas. Para el seed se usaron siempre los ids bajos. Pendiente decidir si se limpia `tipo_contrato`.

---

## 12. Sesión 2026-09-24 — Drawer de perfil completo + comparación campo a campo contra el Excel fuente

### 12.1 Drawer con la totalidad de los datos

`EmpleadoDrawer.jsx` (pestaña "Información") mostraba un resumen curado, no todos los datos del
empleado. Se amplió a 9 secciones que cubren todo lo que ya devuelve `getByIdCompleto` +
`/users-company/catalogos`: datos personales completos (antes faltaban todos: fecha nacimiento,
género, estado civil, grupo sanguíneo, hijos, ciudades, fecha expedición, usuario SSFF), dirección
con tipo y ciudad, laboral completo (área, centro de costo, modalidad, oleada, sede/piso, fin de
periodo de prueba, fin de contrato, **jefe de área** que no se mostraba, analista encargado,
observaciones), salario con bonos, seguridad social completa (antes solo EPS/ARL/AFP, faltaban
cesantías y caja), cuenta bancaria con tipo, dotación como historial completo (antes solo la
primera entrega) y recursos asignados con detalle. No hizo falta ningún endpoint nuevo.

De paso se corrigió `utils/fecha.js::formatearFecha`: sin guardia para `null`, `new Date(null)`
cae al epoch Unix y se veía como "01 de ene de 1970" en cualquier fecha vacía en BD (síntoma
reportado por el usuario en fin de periodo de prueba/fin de contrato). Ahora retorna `null` si el
valor de entrada es falsy.

### 12.2 Fuga de fuente mono corregida (no es de RRHH, pero se tocó la misma sesión)

`tailwind.config.js` pisaba `font-sans`/`font-mono` globalmente por el rediseño de Asistencia
(pasada 1, ver [[project-rrhh-frontend-redesign]]), afectando `CopyableId.jsx`,
`DirectivoDashboard.jsx`, `IncidentDetailModal.jsx`, `ScriptParser.jsx`, `WorkstationManagement.jsx`
y 5 componentes de `incidents/*`. Se renombraron las claves a `asistencia-sans`/`asistencia-mono`/
`asistencia-display` y se actualizaron los 12 archivos de `src/components/asistencia/` (28 usos)
para pedirlas explícitamente. RRHH nunca estuvo afectado (su tipografía vive en `--font-sans`/
`--font-display` como propiedades CSS en `tokens.css`, no en Tailwind).

### 12.3 Comparación campo a campo contra el Excel fuente (`Descargas/DATOS (1) (1).xlsx`)

A pedido del usuario, se comparó un empleado real ya importado (Kevin Alejandro Vargas Moreno,
cédula 1001294395, `users_company.id=13`) contra su fila origen en el Excel (fila 2, hoja "TOTAL
PERSONAL"), columna por columna contra las 91 columnas reales del header. Se usó
`utils/importEmpleadosExcel.js::COL` como mapa de referencia y se leyó el Excel directo con
`xlsx` (dependencia ya presente en el backend).

**Bugs de import corregidos (la columna del Excel tiene dato real, la tabla ya tenía la
columna desde la migración 039, pero el import nunca la copiaba):**
- `contrato.fecha_fin_periodo_prueba` — Excel trae `2023-09-16` real para este empleado, BD
  tenía `NULL`. Confirmado con al menos 3 filas más con dato real.
- `contrato.fecha_fin_contrato` — columna mapeada de todos modos aunque **ninguna de las 389
  filas actuales trae dato real** (siempre "N/A"), para que quede lista si algún contrato a
  término fijo lo trae en el futuro.
- `contrato.observaciones` — mismo caso: mapeada, sin datos reales en las 389 filas actuales.

Corregido en `utils/importEmpleadosExcel.js` (agregado `FECHA_FIN_PERIODO_PRUEBA:49`,
`FECHA_FIN_CONTRATO:50`, `OBSERVACIONES:84` a `COL` y a `normalizarFila`) y
`services/importEmpleadosService.js` (los 3 campos se pasan ahora al objeto `contrato` que arma
`construirDataEmpleado`). El modelo (`UserCompany.js`) ya aceptaba estas columnas desde la 039,
solo faltaba que el import las mandara. **Se reprocesó el Excel completo** (`confirmar()` sobre
las 389 filas): 389 actualizados, 0 creados, 0 errores, 7 advertencias (las mismas de siempre).
Verificado contra el empleado de prueba: `fecha_fin_periodo_prueba` quedó en `2023-09-16`.

**Dejado sin resolver a propósito — traslados de EPS/AFP/Cesantías:** el Excel trae columnas
"Traslado EPS"/"Fecha de Traslado" (y lo mismo para AFP y Cesantías) que corresponderían a
`seguridad_social.entidad_anterior_id`/`fecha_traslado` (agregadas en la migración 039, nunca
cableadas). Se revisaron las 389 filas reales y **ninguna trae dato en esas columnas** — no hay
forma de verificar si el formato es un nombre de entidad, un booleano u otra cosa sin un ejemplo
real. Implementarlo a ciegas es más riesgo que beneficio hoy; además requeriría tocar
`guardarSeguridadSocial()` en el modelo (hoy no acepta esos dos campos). Queda documentado aquí
para retomarlo si aparece un Excel con esos datos poblados.

**Gaps de esquema reales (la columna del Excel no tenía dónde guardarse, no es un bug de
import) — migración `047_add_campos_faltantes_excel_rrhh.sql` creada, validada contra una copia
temporal de `direccion`/`contrato`/`users_company` (creada y destruida en la misma prueba), y
**ya aplicada por el asistente contra `call_center_support`** (2026-09-24, a pedido explícito
del usuario):
- `contrato.director_area_id` (FK a `users_company`, `ON DELETE SET NULL`, mismo patrón que
  `jefe_area_id`) — columna "Director de Área" del Excel, confirmada **distinta** de "Jefe de
  Área" con datos reales (ej. fila 5: Director "ANDRES SANTIAGO NUNCIRA JIMENEZ" vs Jefe de Área
  "MAYRA ALEJANDRA BARBOSA VIGOYA").
- `contrato.cargo_ssff` (VARCHAR libre, no catálogo) — columna "Cargo en SSFF", confirmada
  distinta de "Cargo" con datos reales (ej. "SUPERVISOR DE OPERACION TMK" vs "COORDINADOR
  CALL"); los valores no calzan con el catálogo `cargo` existente.
- `contrato.fecha_entrega_certificacion_laboral` (DATE) — columna "Fecha Entrega Certificación
  Laboral Y Cesantías"; sin datos reales en las 389 filas actuales, se agrega la columna igual
  por si aparece en una carga futura.
- `direccion.zona_direccion_id` (catálogo nuevo `zona_direccion`, seed Urbano/Rural, FK
  `ON DELETE RESTRICT`) — columna "Tipo De Dirección" del Excel (valor real visto: "URBANO" en
  las 389 filas), concepto distinto del catálogo `tipo_direccion` ya existente
  (Residencia/Correspondencia/Laboral, que clasifica el *uso* de la dirección, no la zona).

**Cableado completo tras aplicar la migración (2026-09-24):**
- `models/UserCompany.js`: `insertarContrato()` y el `UPDATE` de `update()` ya escriben
  `director_area_id`/`cargo_ssff`/`fecha_entrega_certificacion_laboral`; `guardarDireccion()`
  ya escribe `zona_direccion_id`; `getCatalogos()` expone `zonas_direccion`, y de paso
  `tipos_vacuna`/`tipos_recurso` (no estaban expuestos, hacían falta para el form). Se agregaron
  además `guardarVacunacion()`, `guardarDotacion()` y `guardarRecursos()` como funciones del
  modelo (antes solo existían, duplicadas, dentro de `importEmpleadosService.js` para el import
  masivo) — ahora **también** corren dentro de la transacción de `create()`/`update()`, así que
  un alta o edición manual desde `/recursos-humanos` puede capturar vacunación, dotación y
  recursos asignados, no solo el import. Ambas rutas (form manual e import) coexisten sin
  conflicto porque las dos son idempotentes con el mismo criterio ("no insertar si es igual a lo
  último guardado" en dotación, "no duplicar si ya hay una asignación activa" en recursos).
- `utils/importEmpleadosExcel.js`/`services/importEmpleadosService.js`: mapeadas las 4 columnas
  (`Director de Área` col. 31, `Cargo en SSFF` col. 25, `Tipo De Dirección` col. 36 → catálogo
  `zona_direccion`, `Fecha Entrega Certificación Laboral` col. 85); `director_area_id` se
  resuelve por nombre en la segunda pasada (`resolverJefesYAnalistas`, igual que `jefe_area_id`).
- `controllers/userCompanyController.js`: `extraerCampos()` ahora pasa `vacunacion`/`dotacion`/
  `recursos` del body (antes esos 3 buckets no existían para el flujo manual, solo para import).
- `AgentForm.jsx`: se agregaron los campos que YA existían en el modelo pero nunca se pudieron
  capturar a mano — identificación secundaria, RUT, piso, jefe de área, analista encargado — más
  los 4 nuevos (director de área, cargo en SSFF, fecha certificación laboral, zona de dirección)
  y 3 secciones nuevas completas: Vacunación COVID-19, Dotación y Recursos asignados (diadema,
  locker, carnet). Antes de esta sesión, estas 3 secciones **solo** se podían poblar importando
  un Excel — un empleado dado de alta a mano quedaba sin esa información sin ninguna forma de
  cargarla después salvo re-importar.
- `EmpleadoDrawer.jsx`: agregadas las filas de Director de área, Cargo en SSFF, Certificación
  laboral y Zona (en Dirección). El patrón ya usado en el resto del componente (el helper `Dl`
  oculta la fila si el valor es falsy) se mantiene: un campo vacío en BD simplemente no aparece,
  nunca se inventa un valor por defecto.
- **Reprocesado el Excel completo una segunda vez** tras el cableado: 389 actualizados, 0
  errores. Verificado con los dos casos reales que motivaron la migración: Deinise Quintero
  (`cargo_ssff` = "SUPERVISOR DE OPERACION TMK", distinto de su `cargo`) y Jhon Moreno
  (`director_area` = "Andrés Nuncira" vs `jefe_area` = "Mayra Barbosa", confirmados distintos).
- **Verificado además con un empleado de prueba desechable** (creado y borrado en la misma
  prueba) que el flujo completo `create()` → `update()` con vacunación/dotación/recursos no
  lanza errores de SQL y que el historial de dotación sí abre una fila nueva cuando cambian las
  tallas (mismo comportamiento que salario).

**Sin resolver, documentado en la sub-sección anterior:** los traslados de EPS/AFP/Cesantías —
la columna ya existe en BD desde la 039 pero ninguna fila real del Excel trae dato, no hay forma
de verificar el formato sin arriesgar una implementación incorrecta.

---

## 12.4 Ciudades duplicadas en el catálogo (2026-09-24)

El usuario reportó ciudades repetidas en el selector "Ciudad de expedición" de `AgentForm.jsx`.
Causa confirmada (ya apuntada en §11.5 pero nunca corregida): el catálogo `ciudad` tenía 20
nombres duplicados (Bogotá, Medellín, Cali, Barranquilla...), con los IDs del segundo grupo
desplazados exactamente +20 respecto al primero (Bogotá 1 y 21, Medellín 2 y 22...) — patrón que
confirma que el seed de ciudades (migraciones 035/036) se corrió dos veces contra la misma BD.

**No era solo basura sin usar:** antes de tocar nada se verificó que ambos IDs de Bogotá (1 y 21)
ya estaban en uso por empleados reales en las 4 columnas que referencian `ciudad`
(`users_company.ciudad_nacimiento_id` 5 vs 14, `ciudad_expedicion_id` 6 vs 0,
`contrato.ciudad_idciudad` 6 vs 0, `direccion.ciudad_idciudad` 6 vs 1) — un `DELETE` directo
habría dejado huérfanos a los empleados que apuntaban al id descartado.

**Migración `048_fix_ciudades_duplicadas.sql`:** a diferencia del resto de migraciones del
proyecto, esta no depende de IDs fijos — agrupa por `nombre`, conserva el `MIN(idciudad)` de
cada grupo duplicado, reapunta las 4 columnas afectadas hacia ese id y solo entonces borra las
filas sobrantes. Se hizo así a propósito para que sirva igual en cualquier entorno con el mismo
problema (producción probablemente lo tiene, porque corrió las mismas migraciones 035/036).

**Validado contra una copia temporal con datos reales** (`test_migracion_048_temp`, clonada con
`CREATE TABLE ... AS SELECT *` de `ciudad`/`users_company`/`contrato`/`direccion`, creada y
destruida en la misma prueba): 137→117 ciudades, 0 nombres duplicados restantes, 0 referencias
huérfanas en las 4 tablas, mismo total de empleados antes/después, y los 19 empleados de Bogotá
(5+14) quedaron correctamente apuntando al mismo id tras el fix.

**Ya aplicada por el asistente contra la BD local** (`call_center_support`) a pedido explícito
del usuario: 137→117 ciudades, 0 duplicados. **Pendiente correr contra producción** cuando se
despliegue — es solo este archivo `.sql`, sin cambios de código (no hay `models`/`controllers`
que tocar, el catálogo se sigue leyendo igual).

**Fuera de alcance de esta sesión:** el catálogo `tipo_contrato` sigue con 10 filas duplicadas
(5 valores × 2), mencionado en §11.5, sin corregir — el usuario solo pidió arreglar `ciudad`.

---

## 12.5 Cobertura completa de ciudades (DIVIPOLA) + combobox con buscador (2026-09-24)

Tras corregir los duplicados (§12.4), el usuario preguntó cuál era la mejor forma de elegir
ciudad en el formulario y cómo cubrir "todas las posibles ciudades" — el catálogo solo tenía las
~117 que habían aparecido en Excels reales, no todos los municipios de Colombia. Se acordó con
el usuario: sembrar el catálogo completo (DIVIPOLA) + un combobox con buscador en vez del
`<select>` plano (inmanejable con >1000 opciones).

**Fuente de datos:** `https://raw.githubusercontent.com/marcovega/colombia-json/master/colombia.min.json`
(1104 filas departamento+municipio, 1022 nombres únicos en JS). Descargado con `curl`, nunca
tecleado a mano — con >1000 filas el riesgo de error de tipeo manual era alto.

**El catálogo `ciudad` no tiene columna de departamento** (solo `idciudad`+`nombre`), así que
municipios con el mismo nombre en distintos departamentos (ej. varias "La Unión") quedan
representados una sola vez — mismo criterio que ya regía el catálogo antes de esta sesión.

**Migración `049_seed_divipola_ciudades.sql`, generada por script (no a mano) comparando el
catálogo real contra DIVIPOLA por nombre normalizado**, en 4 pasos:
1. **Fusiones** (3): filas que ya tenían un duplicado bien escrito en el catálogo —
   `BOGOTÁ D.C`/`BOGOTÁ D.C D.C.` → `Bogotá`, `RIOACHA` (le faltaba la H) → `RIOHACHA`. Mismo
   patrón de reapuntar FKs + borrar que la migración 048.
2. **Renombres in-place** (84): filas sin duplicado, solo mal escritas (mayúsculas sin tilde,
   ej. `CHIQUINQUIRA` → `Chiquinquirá`) — se corrigen en el mismo `id`, sin tocar FKs. Incluye 2
   sinónimos reales resueltos a mano porque la normalización sola no los detecta: `Cartagena` →
   `Cartagena de Indias` y `Espinal` → `El Espinal` (así los nombra DIVIPOLA).
3. **Altas** (918): municipios de DIVIPOLA sin ninguna forma existente todavía.
4. **`ALTER TABLE ciudad ADD UNIQUE KEY uq_ciudad_nombre (nombre)`** — no existía ninguna
   restricción de unicidad, la causa raíz de fondo de §12.4. Con esto un duplicado exacto ya no
   se puede volver a crear (aunque sigue siendo posible crear una variante mal escrita a mano,
   ver más abajo).
5. **Dejadas sin tocar a propósito** (10 filas): `BARQUISIMETO-LARA`, `CARACAS`,
   `DISTRITO CAPITAL LIBERTADOR`, `LA GUAJIRA` (es un departamento, no un municipio),
   `MARACAIBO`, `NINAIMA`, `QUITO`, `SAN CRISTOBAL TACHIRA`, `TACHIRA-SAN CRISTOBAL`,
   `VENEZUELA` — ciudades venezolanas/ecuatorianas reales de empleados extranjeros, o texto
   sin información suficiente para saber a qué corresponde. No son parte de DIVIPOLA.

**Bug encontrado y corregido antes de tocar la BD real** (dos vueltas de validación contra una
copia temporal con datos reales, mismo patrón que la 048): la collation real de la columna
(`utf8mb4_0900_ai_ci`) es insensible a tildes y mayúsculas — `"Chima"` (Santander) y `"Chimá"`
(Córdoba) son, para MySQL, el mismo valor, aunque en JavaScript son strings distintos. La primera
versión del generador deduplicaba por string exacto y intentaba insertar ambos, reventando la
`UNIQUE KEY` del paso 4. Corregido deduplicando por nombre normalizado como el resto de la
migración. Un segundo intento reveló el mismo tipo de bug con el sinónimo manual `Cartagena` →
`Cartagena de Indias` (el nombre final no coincidía con el nombre original usado para calcular
qué ya estaba cubierto). Ambos casos solo aparecieron al **validar contra una copia temporal con
datos reales antes de tocar la BD** — exactamente el motivo de hacerlo así.

**Aplicada contra la BD local:** 117 → 1032 ciudades. **Pendiente correr contra producción.**

**`ComboboxBuscable.jsx` (nuevo, `src/components/`):** select con buscador — escribe y filtra
por nombre (sin tildes/mayúsculas), navega con flechas, `Enter` selecciona, botón para limpiar
la selección. El menú se renderiza en un portal a `<body>` (mismo motivo que `FiltroChip` en
`AgentManagement.jsx`: el modal del formulario tiene su propio scroll y recortaría el
desplegable). Limita a 50 resultados visibles a la vez por rendimiento (1032 filas sin filtrar
no se listan todas). Reemplazó los 4 `<select>` de ciudad en `AgentForm.jsx` (expedición,
nacimiento, dirección, ciudad de trabajo) — antes eran `<select>` planos con 1032 `<option>`,
inmanejables para elegir a mano.

**Nota para el futuro:** la `UNIQUE KEY` evita duplicados *exactos*, pero alguien podría seguir
creando una variante mal escrita de una ciudad que ya existe (ej. escribir "Bogota" sin tilde
como nueva) si en algún punto se habilita "crear ciudad nueva" desde el formulario — hoy no
existe esa opción (el combobox solo permite elegir del catálogo ya sembrado), así que no aplica
todavía.

---

## 13. Sesión 2026-09-24 (continuación) — Selector Cliente/Campaña separado + bug de guardado
prematuro en el wizard

### 13.1 Origen: por qué el selector de Campaña mostraba "Obamacare (Obamacare)"

El usuario notó que el selector único de Campaña en `AgentForm.jsx` mostraba opciones como
"OBAMACARE (OBAMACARE)" y "BEEMO (BEEMO)" — el nombre de la campaña repetido entre paréntesis.
Investigado contra la BD real y el Excel fuente (`Descargas/DATOS (1) (1).xlsx`):

- El texto entre paréntesis es el **cliente** de la campaña (`campania.Cliente_idCliente` →
  `cliente.nombre`), no un adorno — el selector armaba `${nombre} (${cliente_nombre})` para
  distinguir campañas homónimas entre clientes distintos.
- **BEEMO** (7 empleados reales) y **OBAMACARE** (33 empleados reales, de los cuales 26 traían
  `Cliente=OBAMACARE` y 7 `Cliente=OBAMACARE-LV` en el Excel) son datos **reales** del Excel: esas
  filas traen literalmente el mismo texto en la columna "Cliente" (col. B) y en "Campaña"
  (col. W) — no es un bug de import. Como no existía un cliente previo con ese nombre para
  matchear, `services/importEmpleadosService.js` creó un cliente placeholder con NIT ficticio
  (`SIN-NIT-BEEMO`, `SIN-NIT-OBAMACARE`).
- **Obama** (campaña id 2, cliente id 2, **0 empleados**) sí es residuo de la semilla
  `036_seed_catalogos_laborales.sql` — el Excel nunca usa "Obama" como cliente. Es el mismo tipo
  de residuo que existía para **Claro**: la migración 036 también sembró una campaña "Claro"
  (id 1, 0 empleados) que en algún momento se borró manualmente de la BD (confirmado: el cliente
  "Claro" id 1 sigue vivo porque 9 campañas reales de Claro lo usan, pero la campaña "Claro"
  id 1 ya no existe) — por eso hoy nunca se ve "Claro (Claro)" en el selector. La campaña "Obama"
  queda pendiente del mismo tratamiento (aún no se borró, decisión del usuario).
- Cliente **OBAMACARE-LV** (id 6) quedó huérfano: se creó al importar las 7 filas con
  `Cliente=OBAMACARE-LV`, pero como la campaña "OBAMACARE" ya existía (creada antes, apuntando al
  cliente id 4), el resolver de campaña matchea por nombre solamente y nunca reasigna el
  `Cliente_idCliente` — el cliente id 6 no quedó atado a ninguna campaña real.
- **Beemo y Obamacare siguen pendientes de una decisión de negocio** (¿son clientes propios que
  solo necesitan un NIT real, o deberían reasignarse a un cliente existente como Claro/Asiste?) —
  no se tocó la BD para estos dos.

### 13.2 Fix aplicado: separar Cliente y Campaña en el formulario

En vez de limpiar datos, se resolvió el problema de raíz en la UI: **Cliente y Campaña ahora son
dos selectores independientes** en el paso "Contrato" de `AgentForm.jsx`, en vez de un único
selector con el cliente entre paréntesis.

- **Backend** — `models/UserCompany.js::getCatalogos()`: el `SELECT` de `campanias` ahora también
  devuelve `cam.Cliente_idCliente AS cliente_id` (antes solo `cliente_nombre`). Es el único
  cambio de backend — el contrato se sigue guardando igual que siempre, con un solo
  `campania_id`; el cliente se sigue derivando en el modelo vía `clienteDeCampania()`. El nuevo
  selector "Cliente" del frontend es **puramente de UI** (filtro), nunca se envía al backend.
- **Frontend** — `AgentForm.jsx`: estado nuevo `clienteId` (no forma parte de `contrato`, no se
  persiste). `clientesUnicos` se deriva de-duplicando `catalogos.campanias` por `cliente_id` (no
  hace falta un catálogo nuevo de clientes). El selector "Campaña" se filtra por el cliente
  elegido (`campaniasFiltradas`) y ya no muestra el paréntesis. Sincronización en ambos sentidos:
  elegir Cliente limpia la Campaña si ya no aplica (`handleClienteChange`); elegir Campaña
  directamente autocompleta el Cliente (`handleCampaniaChange`). Al editar un empleado existente,
  el Cliente se precarga buscando la campaña ya guardada en `catalogos.campanias`.
- Efecto colateral correcto: como `clientesUnicos` sale de `catalogos.campanias` (no de la tabla
  `cliente` completa), el selector "Cliente" **no muestra** el cliente huérfano "OBAMACARE-LV"
  (id 6) — solo aparecen clientes con al menos una campaña real asociada.

**Verificado:** `eslint` sin errores, `vite build --mode development` sin errores nuevos (`dist/`
restaurado tras la prueba, igual que en sesiones anteriores), y probado en vivo en el navegador
con un usuario `recursosHumanos` de prueba (creado y borrado en la misma sesión): el filtro
Cliente→Campaña funciona (ej. elegir "Asiste" reduce Campaña a sus 8 campañas reales), y editar
un empleado existente precarga Cliente/Campaña correctos (Samuel Abaunza → Claro/HOGAR).

### 13.3 Bug encontrado durante la prueba en vivo: "Siguiente" guardaba el formulario sin mostrar
el paso 2 (preexistente, no relacionado con 13.2)

**Síntoma reportado por el usuario:** al editar un empleado y hacer clic en "Siguiente" (paso 1 →
paso 2), el modal se cerraba de inmediato sin mostrar los campos de Contratación.

**Diagnóstico:** reproducido en vivo (usuario de prueba `_debug_rrhh_temp`, rol
`recursosHumanos`, creado y borrado en la misma sesión). Con logs temporales se confirmó que
`reportValidity()` devolvía `true` y `setPaso(2)` sí se ejecutaba — el modal igual se cerraba, sin
errores en consola ni una petición de red asociada al clic (se descartó que fuera el overlay
`onClick={onClose}`: nunca se disparó). La causa real: el botón derecho del pie del modal cambia
de `type="button"` (paso 1, "Siguiente") a `type="submit"` (paso 2, "Guardar/Actualizar
empleado") en la **misma posición del árbol JSX sin `key`**, así que React reutiliza el mismo
nodo `<button>` del DOM y solo le muta el atributo `type`. Como `setPaso(2)` se aplica de forma
síncrona dentro del mismo evento de clic, el navegador evalúa el "activation behavior" de ese
clic **después** de que el botón ya mutó a `type="submit"` — el mismo clic que debía solo avanzar
de paso termina también enviando el formulario con los datos que ya estuvieran cargados en el
paso 2 (para un empleado existente, sus datos ya precargados), guardando y cerrando el modal sin
que el usuario llegara a ver el paso 2. Confirmado con una petición `PUT /api/users-company/:id`
con `200 OK` en el log de red durante una de las reproducciones.

Es un bug **preexistente**, no introducido por el cambio de 13.2 — el JSX de los botones del pie
no se tocó en ese cambio, y el bug se reproduce igual con el código de antes.

**Fix aplicado** (`AgentForm.jsx`, botones del pie, paso 2): se agregó `key="btn-siguiente"` /
`key="btn-guardar"` a cada variante del botón derecho, forzando a React a crear un nodo DOM nuevo
en cada cambio de paso en vez de mutar el existente — así el `type` nunca cambia sobre un
elemento que está procesando un clic en curso. El botón izquierdo ("Atrás"/"Cancelar") no se
tocó: ambas variantes ya eran `type="button"`, sin riesgo de auto-submit.

**Verificado en vivo:** con el fix, "Siguiente" muestra correctamente el paso 2 sin guardar nada;
"Atrás" vuelve al paso 1 sin problema; probado varias veces de ida y vuelta. No se guardó ningún
dato de prueba sobre empleados reales (se cerró el modal sin confirmar antes de cada cambio de
Cliente/Campaña de prueba).

### 13.4 Pendiente

- Decisión de negocio sobre Beemo/Obamacare (§13.1): mantener como clientes propios con NIT real,
  o reasignar a un cliente existente.
- Borrar la campaña/cliente "Obama" (id 2, 0 empleados) si se confirma que es residuo de semilla
  — mismo tratamiento que ya se le dio a la campaña "Claro" en algún momento anterior.
- Limpiar el cliente huérfano "OBAMACARE-LV" (id 6) si no se decide reutilizarlo.
- El catálogo `tipo_contrato` sigue con 10 filas duplicadas (§11.5), sin corregir.

---

## 14. Sesión 2026-09-28 — Campos del Excel de nómina real en el formulario de registro

El usuario pidió ajustar el formulario de alta/edición de empleados (`AgentForm.jsx`) contra un
Excel distinto a los usados hasta ahora: `Descargas/NominaEmpleadosWO190723-1 0826.xlsx`, hoja
`EJEMPLO` (56 columnas, 7 filas de ejemplo reales). A petición explícita del usuario, se excluyeron
las 5 columnas de liquidación de nómina que venían resaltadas en el Excel (verde/amarillo):
`Cesantias`, `IntCesantias`, `Prima`, `Vacaciones`, `Ret. Fte` — ese cálculo no es responsabilidad
de este módulo.

**Decisiones tomadas con el usuario antes de tocar el esquema** (ver hilo de preguntas de esta
sesión):
1. `Empresa` (siempre `"ASISTE ING SAS"` en la muestra) → catálogo nuevo (no texto libre), listo
   para si algún día hay más de una razón social.
2. `Centro De Trabajo` (siempre `"BOGOTA"` en la muestra) → mismo dato que "Ciudad de trabajo"
   (`contrato.ciudad_idciudad`, ya existente); no se agregó campo nuevo.
3. Catálogos chicos con un solo valor de ejemplo (`Clase`, `Periodo Pago`, `Clasificación Dian`,
   `Tipo Sena`, `Tipo Cotizante`, `Subtipo de Cotizante`) → catálogos FK sembrados solo con lo
   visto en el ejemplo, mismo patrón que el resto del módulo (no texto libre).

**Migración `050_add_campos_nomina_registro_empleados.sql`** — 7 catálogos nuevos
(`empresa`, `clase_contrato`, `periodo_pago`, `clasificacion_dian`, `tipo_sena`, `tipo_cotizante`,
`subtipo_cotizante`; todos sembrados con el valor visto salvo `tipo_sena`, que quedó vacío porque
ninguna de las 7 filas de muestra traía dato — la columna del Excel viene en blanco salvo,
probablemente, para aprendices SENA, que no aparecen en la muestra), 7 columnas FK nuevas en
`contrato` (`empresa_id`, `clase_contrato_id`, `periodo_pago_id`, `clasificacion_dian_id`,
`tipo_sena_id`, `tipo_cotizante_id`, `subtipo_cotizante_id`, todas `NULL` para no romper contratos
existentes), `contrato.aplica_dotacion` (`TINYINT(1) DEFAULT 1` — la columna `Dotación` del Excel
viene `-1`/`0`, booleano de nómina en formato Excel/Access, **no** la talla: eso ya vive en la
tabla `dotacion`, migración 039, sin tocar aquí) y `users_company.declarante_renta` +
`libreta_militar_numero`.

**Validada contra una copia temporal con estructura real** (`test_migracion_050_temp`, clonada con
`SHOW CREATE TABLE` de las 63 tablas de `call_center_support`, sin datos, creada y destruida en la
misma prueba): la migración corre sin errores, los 7 catálogos quedan sembrados correctamente
(`tipo_sena` vacío como se esperaba), y una inserción funcional de `contrato` con las 7 FK nuevas +
`aplica_dotacion` + `declarante_renta`/`libreta_militar_numero` en `users_company` confirma que las
constraints resuelven bien (se copiaron filas sueltas de los catálogos base — cliente, campaña,
área, etc. — para poder armar el INSERT de prueba). **Ya aplicada por el asistente contra la BD
local** (`call_center_support`). **Pendiente correr contra producción.**

**Gap cerrado sin migración nueva — fechas de afiliación:** las 5 columnas `Fecha Afil. ARL/EPS/
AFP/Fondo Cesantías/Caja` del Excel no necesitaban columna nueva:
`seguridad_social.fecha_afiliacion` ya existe desde la migración 034 (una fila por tipo de
afiliación). El gap real era que `guardarSeguridadSocial()` en `models/UserCompany.js` siempre
escribía ahí la fecha de ingreso del contrato, ignorando una fecha de afiliación real si el
formulario la traía. Se reescribió la función para aceptar `<tipo>_fecha_afiliacion` por cada uno
de los 5 tipos (ej. `eps_fecha_afiliacion`): si cambia solo la fecha (misma entidad), actualiza el
registro activo en el sitio; si cambia la entidad, sigue cerrando el registro anterior y abriendo
uno nuevo como antes (comportamiento de traslado ya existente, sin tocar). Sin este cambio, el
formulario no tenía dónde mostrar ni guardar esas 5 fechas aunque la columna ya existiera.

**Backend cableado completo** (`models/UserCompany.js`, `controllers/userCompanyController.js`):
`camposPersonales()`/`INSERT`/`UPDATE` de `users_company` ya escriben `declarante_renta` y
`libreta_militar_numero`; `insertarContrato()`/`UPDATE` de `contrato` ya escriben las 7 FK nuevas +
`aplica_dotacion`; `getByIdCompleto()` expone las 5 fechas de afiliación por tipo; `getCatalogos()`
expone los 7 catálogos nuevos (`empresas`, `clases_contrato`, `periodos_pago`,
`clasificaciones_dian`, `tipos_sena`, `tipos_cotizante`, `subtipos_cotizante`); `CAMPOS_PERSONALES`
en el controller incluye los 2 campos nuevos de `users_company` (se copian solos vía
`extraerCampos()`, sin lógica adicional). No se tocaron `validarObligatorios()` ni
`CAMPOS_CONTRATO_OBLIGATORIOS`: todos los campos nuevos quedaron **opcionales**, no se pidió que
fueran obligatorios.

**Frontend (`AgentForm.jsx`):** nuevo campo "Libreta militar No." (identificación) y checkbox
"Declarante de renta" (datos personales) en el paso 1; en el paso 2, 7 selectores nuevos en
Contrato (Empresa, Clase, Periodo de pago, Clasificación Dian, Tipo Sena, Tipo cotizante, Subtipo
de cotizante) + checkbox "Dotación" (aplica/no aplica), y 5 campos de fecha nuevos en Seguridad
social (uno junto a cada selector de entidad). Para un empleado **nuevo**, los catálogos que hoy
solo tienen 1 valor real (`Empresa`, `Clase`, `Periodo de pago`, `Clasificación Dian`, `Tipo
cotizante`, `Subtipo de cotizante`) se preseleccionan automáticamente si el catálogo trae
exactamente 1 fila — mismo criterio ya usado para `tipo_direccion_id = 'Residencia'`; deja de
autocompletar solo si en el futuro se agrega una segunda fila a alguno de esos catálogos.
`tipo_sena_id` no se preselecciona (catálogo vacío).

**`EmpleadoDrawer.jsx`:** agregadas las filas de detalle correspondientes (Libreta militar,
Declarante de renta, Empresa, Clase · Periodo de pago, Clasificación Dian, Tipo Sena, Cotizante,
Dotación, y la fecha de afiliación añadida a cada línea de EPS/ARL/AFP/Cesantías/Caja) — mismo
patrón del resto del componente (el helper `Dl` oculta la fila si el valor es falsy).

**Deliberadamente fuera de alcance:** `utils/importEmpleadosExcel.js` y
`services/importEmpleadosService.js` (el import masivo) **no se tocaron** — ese importador lee un
Excel con un layout de columnas distinto (`Descargas/DATOS (1) (1).xlsx`, hoja "TOTAL PERSONAL",
ver §5/§12.3), y el pedido de esta sesión fue puntualmente sobre el formulario manual de registro,
no sobre el import masivo. Si más adelante se quiere poder importar estos mismos campos desde un
Excel de nómina, es trabajo aparte. Tampoco se tocó el detalle desplegable de `AgentManagement.jsx`
(§8) ni `PasivoVacacional.jsx`/`Traspasos.jsx`/`NovedadesRRHH.jsx`.

**Verificado:** migración probada contra copia temporal (ver arriba), luego aplicada de verdad
contra la BD local (`call_center_support`); `node -c` sin errores en los 2 archivos backend
tocados; `npx eslint` sin errores nuevos en los 2 archivos frontend tocados (el único error
reportado en `EmpleadoDrawer.jsx` es el falso positivo ya documentado en §11.1); `npx vite build
--mode development` sin errores nuevos (`dist/` restaurado con `git checkout -- dist/` +
`git clean -fd dist/` tras la prueba). Además, prueba funcional end-to-end contra el backend real
corriendo (JWT generado a mano, rol `recursosHumanos`): crear empleado con las 7 FK nuevas +
`aplica_dotacion` + `declarante_renta`/`libreta_militar_numero` + las 5 fechas de afiliación,
`GET` confirmando el round-trip, `PUT` cambiando solo `eps_fecha_afiliacion` (confirma que
`guardarSeguridadSocial()` actualiza en el sitio en vez de cerrar/abrir vigencia cuando la entidad
no cambia) y `DELETE` de limpieza.

**Probado en el navegador (2026-09-28, misma sesión):** usuario de prueba `_debug_rrhh_ui_temp`
(rol `recursosHumanos`, creado y borrado al final) contra el frontend real (`npm run dev`,
`localhost:5173`) y el backend ya corriendo del usuario. Confirmado con capturas: los 7 selectores
nuevos del paso 2 aparecen y los que tienen un único valor real se autoseleccionan (Empresa, Clase,
Periodo de pago, Clasificación Dian, Tipo cotizante, Subtipo de cotizante — `Tipo Sena` queda en
"Sin especificar" como se esperaba, catálogo vacío); el checkbox de Dotación aparece marcado por
defecto; el combobox de Ciudad de trabajo (DIVIPOLA, §12.5) filtra correctamente; las 5 fechas de
afiliación aparecen junto a cada selector de seguridad social. Alta de un empleado de prueba
completo (398 → confirmado en el listado), drawer mostrando todos los campos nuevos correctamente
agrupados (Empresa, Clase · Periodo de pago, Clasificación Dian, Cotizante, Dotación, EPS con fecha
de afiliación combinada), y edición confirmando que el formulario precarga exactamente los mismos
valores guardados. Empleado y usuario de prueba eliminados al terminar (397 empleados de vuelta).

### 14.1 Pendiente

- Correr la migración `050` contra producción.
- `tipo_sena` sigue sin ningún valor sembrado — cuando aparezca un empleado real con contrato de
  aprendizaje SENA, agregar los valores reales al catálogo (hoy el selector estaría vacío).
- Si se decide que el import masivo también debe poblar estos campos, mapear las columnas
  correspondientes en `utils/importEmpleadosExcel.js`/`services/importEmpleadosService.js` —
  pendiente, fuera de alcance de esta sesión.

---

## 15. Sesión 2026-09-28 (continuación) — Los 10 campos nuevos también en el import masivo

Tras cerrar §14, el usuario preguntó si el botón "Cargar Excel" ya traía estos 10 campos nuevos
usando la plantilla de nómina. La respuesta fue no — el importador solo lee `TOTAL PERSONAL`, una
hoja con layout distinto al Excel de nómina. Lo que siguió fue un ida y vuelta de replanteos hasta
llegar al enfoque correcto; queda documentado porque el primer camino que se exploró **no se
implementó** y no hay que repetirlo:

**Camino descartado:** en un primer momento se interpretó que el Excel de nómina (`EJEMPLO`) debía
*reemplazar* la plantilla de import masivo. Eso llevó a una cadena de problemas reales (la plantilla
de nómina no trae Oleada ni Campaña/Cliente, y su columna "Cargo" no calza con el catálogo de
campañas) que hubiera requerido borrar los empleados ya cargados, relajar columnas `NOT NULL` en
todo el sistema, y tratar "Cargo" como si fuera "Campaña". El usuario cortó ese camino a tiempo
("espera replanteemos me equivoqué") antes de tocar nada en la BD.

**Camino correcto:** revisar la hoja **"Nuevo Epleado"** (sic, 72 columnas) del mismo
`Descargas/DATOS (1) (1).xlsx` — esa es, según el usuario, la referencia real de qué campos hacen
falta para registrar un empleado. Comparada columna por columna contra `TOTAL PERSONAL` (la hoja
que **sí** lee el importador, 91 columnas), resultó ser un subconjunto exacto en las mismas
posiciones (0-48 idénticas; a partir de ahí `TOTAL PERSONAL` intercala columnas de traslado/retiro/
vacunación que "Nuevo Epleado" no tiene). Es decir: el importador actual **ya cubre** todo lo que
"Nuevo Epleado" pide — Campaña, Cliente, Oleada, Cargo real, RUT, Piso, Jefe inmediato/área, etc. no
necesitaban ningún cambio.

Comparando luego `TOTAL PERSONAL` contra el Excel de nómina, la lista real de gaps se redujo a:
- **5 columnas de fecha de afiliación que YA EXISTÍAN en `TOTAL PERSONAL`** (`Fecha De Afiliación
  Arl` col. 52, `Fecha Afiliación Eps` col. 55, `Fecha D eAfiliacion Afp` col. 59, `Fecha
  Afiliacion Fondo De Cesantias` col. 63, `Fecha De Afiliación A Caja` col. 67) pero que el
  importador **nunca leía** — mismo tipo de gap que ya se había encontrado y corregido en el
  formulario manual (§14), solo que aquí en el archivo de origen, no en el modelo.
- **9 campos genuinamente nuevos**, sin posición fija en `TOTAL PERSONAL`: Empresa, Clase, Periodo
  Pago, Clasificación Dian, Tipo Sena, Tipo Cotizante, Subtipo de Cotizante, Declarante, Libreta
  Militar No.
- La columna `Dotación`/`DOTACIÓN` del Excel de nómina **no es un concepto nuevo**: `TOTAL
  PERSONAL` ya tenía una columna `DOTACIÓN` (`SI`/`N/A`, col. 87) que decide si se guarda el
  historial de tallas. Se reutilizó esa misma señal para alimentar también
  `contrato.aplica_dotacion` (migración 050) — no se agregó ninguna columna nueva para esto.

**Implementación (aditiva, sin tocar el 90% del importador que ya funcionaba):**
- `utils/importEmpleadosExcel.js`: `COL` ganó 5 índices fijos
  (`ARL_FECHA_AFILIACION`/`EPS_FECHA_AFILIACION`/`AFP_FECHA_AFILIACION`/
  `CESANTIAS_FECHA_AFILIACION`/`CAJA_FECHA_AFILIACION`). Para los 9 campos sin posición fija se
  agregó `detectarColumnasNuevas()`: escanea el header del archivo por **nombre** (normalizado sin
  tildes/mayúsculas/puntos), no por posición — a diferencia del resto del archivo, estos nombres
  son únicos y sin ambigüedad, así que no hace falta parsear por posición como con "Tipo De
  Identificación"/"Identificación" repetidos. Si una columna no está en el archivo subido, el
  campo queda `null`/`undefined` sin romper la carga (compatible con archivos viejos que no las
  traen). Nuevo helper `booleano()` para "Declarante" (acepta `-1`/`0`, `true`/`false`,
  `SI`/`NO`/`VERDADERO`/`FALSO`).
- `services/importEmpleadosService.js`: `cargarCatalogosFijos()` y `crearResolver()` ganaron los 7
  catálogos nuevos como **cerrados** (solo lectura, igual que género/modalidad/área — nunca crean
  fila nueva), con advertencia si el valor del Excel no está sembrado. `construirDataEmpleado()`
  cablea los 10 campos hacia `data`/`data.contrato`/`data.seguridad_social`, reutilizando
  exactamente los mismos nombres de campo que ya esperaba `models/UserCompany.js` desde §14 (no
  hizo falta tocar el modelo en absoluto — el mismo `create()`/`update()`/`guardarSeguridadSocial()`
  sirve para el alta manual y para el import masivo).
- `ImportEmpleadosModal.jsx` (frontend): `ENCABEZADOS_PLANTILLA` (la plantilla que descarga el
  botón "Descargar plantilla") ganó las 9 columnas nuevas al final.

**Verificado exhaustivamente:**
- El archivo real (`DATOS (1) (1).xlsx`, 389 filas) se volvió a parsear completo: 0 errores, 0
  columnas nuevas detectadas por error (confirma que no rompe archivos viejos), y las 3 de 5 fechas
  de afiliación con dato real (EPS/ARL/Caja) se leyeron correctamente por primera vez — AFP/
  Cesantías dieron `null` en las 389 filas, confirmado contra el valor crudo de la celda que
  realmente están vacías (`"N/A"`) en el archivo, no es un bug de mapeo.
- Archivo sintético con las 9 columnas nuevas en variantes de mayúsculas/acentos (`EMPRESA`,
  `clase`, `CLASIFICACIÓN DIAN`, `tipo cotizante`...) para confirmar que la detección por nombre no
  depende de la capitalización exacta del archivo real.
- `previsualizar()`/`confirmar()` corridos directo contra la BD local real: alta de un empleado de
  prueba con los 10 campos nuevos resueltos correctamente (catálogos cerrados, `aplica_dotacion`,
  fecha de afiliación EPS cayendo al fallback de fecha de ingreso cuando el Excel no la trae, igual
  que en el formulario manual).
- Prueba end-to-end vía HTTP real (`POST /import-excel/preview` y `/commit`, JWT de prueba,
  servidor ya corriendo del usuario): mismo resultado, empleado de prueba limpiado al final.
- `node -c` sin errores en los 2 archivos backend; `npx eslint` sin errores en el frontend tocado.

**No se tocó la base de datos** en esta sub-sesión (no hizo falta ninguna migración nueva ni
borrado de datos — todo lo necesario ya estaba desde la migración 050 de §14).

---

## 16. Sesión 2026-09-28 (continuación) — Módulo de Retiro (modal + reactivar)

El usuario pidió, comparando contra la hoja **"Retiro empleado"** del mismo
`Descargas/DATOS (1) (1).xlsx` (26 columnas), un modal para registrar el retiro de un empleado
que muestre lo que ya se sabe de él y solo pida lo que falta. La tabla `retiro` ya existía desde
la migración `034` (con `equipo_entregado` agregado en la `039`), pero **sin controlador, ruta ni
UI** — quedaba pendiente desde §9. De las 26 columnas de la hoja, 17 ya se capturan al dar de alta
al empleado (Cliente, Identificación, Nombres, Modalidad, Analista encargado, etc.); las 9
restantes son las que de verdad hacían falta, y de esas, 4 ya tenían columna en `retiro`
(`fecha_retiro`, `fecha_ultima_conexion`, `fecha_entrega_certificacion`, `equipo_entregado`) y
`Serial Diadema` no necesitaba columna nueva (ya se rastrea en `asignacion_recurso`, migración
`039`) — el gap real eran solo `justificacion` (no existía) y `motivo_retiro` (existía como
catálogo cerrado, `motivo_retiro_idmotivo_retiro`, vacío desde la `034`, nunca usado).

**Decisiones tomadas con el usuario antes de tocar el esquema** (ninguna de las 389 filas reales
del Excel tiene un retiro real — todas son "ALTA" — así que no había dato real de donde sembrar):
1. `tipo_retiro` (catálogo vacío) → sembrado con categorías legales estándar de terminación
   laboral en Colombia (Renuncia voluntaria, Despido con justa causa, Despido sin justa causa,
   Terminación de contrato, Mutuo acuerdo, Abandono de cargo, Pensión, Fallecimiento).
2. `motivo_retiro` → se cambia de catálogo cerrado a **texto libre**, porque los motivos reales
   varían demasiado para una lista corta y cerrada (a diferencia de "Tipo de retiro", que sí son
   categorías legales estándar). La tabla `motivo_retiro` queda huérfana (vacía, sin FK), mismo
   criterio que otros residuos de catálogo del proyecto (campaña "Obama", §13.1) — no se borra.

**Migración `051_add_retiro_campos_y_seed_tipo_retiro.sql`:** siembra `tipo_retiro` (8 filas),
elimina la FK `fk_retiro_motivo_retiro` + la columna `motivo_retiro_idmotivo_retiro`, agrega
`retiro.motivo_retiro` (VARCHAR libre) y `retiro.justificacion` (VARCHAR). Validada contra una
copia temporal (estructura clonada + INSERT de prueba con las columnas nuevas) antes de aplicarla
contra `call_center_support`.

**Backend — `models/Retiro.js`** (nuevo, mismo patrón en capas que `NovedadRrhh.js`/`Traspaso.js`):
- `getByUserCompanyId(ucId)` — retiro vigente del empleado (o `null`), con `tipo_retiro_nombre`
  resuelto por JOIN.
- `registrar(ucId, data)` — transacción: inserta el retiro sobre el contrato vigente, lo pasa a
  `estado_contrato = 'retirado'`, y si `equipo_entregado` viene en `true`, **libera** (desactiva)
  las asignaciones activas de `asignacion_recurso` del empleado (diadema/locker/carnet) — así se
  cierra el dato "Serial Diadema" del Excel sin duplicarlo en una columna nueva. Rechaza con error
  claro si el empleado ya tiene un retiro registrado (`UNIQUE KEY uq_retiro_contrato` de la `034`
  ya lo protegía a nivel de BD; el modelo lo valida antes para dar un mensaje legible).
- `actualizar(ucId, data)` — edita el retiro ya registrado; solo libera recursos si
  `equipo_entregado` pasa de `false` a `true` en esta edición (no repite la liberación si ya se
  había hecho).
- `reactivar(ucId)` — deshace el retiro: borra la fila y vuelve el contrato a `'activo'`. No
  reasigna los recursos que se hayan liberado (documentado en el modal, ver abajo).

**Backend — controller/rutas:** 4 endpoints nuevos bajo `/api/users-company/:id/retiro`
(`GET`/`POST`/`PUT`/`DELETE`, este último = reactivar), agregados a `userCompanyController.js` y
`routes/usersCompany.js` junto a `/:id/activos` (mismo prefijo `/:id`, sin colisión). Protegidos
por `verificarRecursosHumanos`. `UserCompany.getCatalogos()` ahora también expone `tipos_retiro`.

**Frontend — `RetiroModal.jsx`** (nuevo): muestra de solo lectura lo que ya se conoce del
empleado (identificación, campaña · cargo, modalidad, analista encargado — sin volver a pedirlo) y
un formulario solo con lo que hace falta: fecha de retiro* y tipo de retiro* (obligatorios, igual
que a nivel de API), fecha última conexión, motivo (texto libre), justificación (textarea),
checkbox de entrega de equipo (con nota de que libera diadema/locker/carnet) y fecha de
certificación laboral y cesantías. Si el empleado ya tiene un retiro registrado, el modal se abre
en modo edición con los datos precargados y agrega un bloque "Reactivar empleado" con confirmación
en dos pasos (sin `window.confirm`, mismo criterio que `ConfirmarEliminarModal.jsx`).

**Integración:** el botón "Traspasar" del footer de `EmpleadoDrawer.jsx` seguía deshabilitado
("Próximamente", nunca se conectó al módulo de Traspasos que sí existe — no se tocó, fuera de
alcance). Se agregó un botón nuevo junto a él: "Registrar retiro" / "Ver retiro" según si ya
existe uno, que abre `RetiroModal`. La pestaña "Información" del drawer ahora también muestra una
sección "Retiro" (fecha, tipo, motivo, justificación, entrega de equipo, fecha de certificación)
cuando el empleado tiene uno — mismo patrón que el resto del drawer (`Dl` oculta la fila si el
valor es falsy). `AgentManagement.jsx` ya mostraba el badge "Retirado" en la tabla
(`estadoBadge()` ya contemplaba `'retirado'`/`'inactivo'` desde antes) — no hizo falta tocarlo,
se actualiza solo al refrescar la lista tras registrar/reactivar.

**Verificado exhaustivamente:**
- Migración probada contra copia temporal, luego aplicada a la BD local real.
- `node -c` sin errores en los 3 archivos backend nuevos/tocados; `npx eslint` sin errores nuevos
  en los 4 archivos frontend (el único error es el falso positivo ya documentado en §11.1);
  `npx vite build --mode development` sin errores nuevos (`dist/` restaurado tras la prueba).
- Prueba funcional completa por HTTP contra el backend real (JWT de prueba, rol
  `recursosHumanos`) con un empleado desechable: crear → `GET retiro` (null) → `POST registrar`
  (201, contrato pasa a `retirado`) → segundo `POST` rechazado con 409 (ya tiene retiro) → `PUT
  actualizar` (motivo cambia) → `DELETE reactivar` (contrato vuelve a `activo`, retiro
  desaparece) → limpieza. Todo se comportó exactamente como se diseñó.
- **Prueba end-to-end en el navegador** (usuario `recursosHumanos` de prueba, creado y borrado al
  final; empleado desechable `RETIROBROWSER001`, creado y borrado al final): abrí el drawer,
  click en "Registrar retiro", confirmé que el modal precarga los datos de solo lectura del
  empleado (Campaña · Cargo, Modalidad — Analista encargado salió vacío porque el empleado de
  prueba no tenía uno asignado, comportamiento correcto), llené el formulario (incluida la
  columna "Entrega de equipo") y lo guardé — el badge de la tabla cambió a "Retirado" al instante.
  Reabrí el drawer: la sección "Retiro" mostraba todo lo guardado y el botón ya decía "Ver
  retiro". Lo abrí de nuevo: el formulario precargó exactamente lo guardado. Probé "Reactivar
  empleado": apareció la advertencia inline, confirmé, y el badge volvió a "Activo" — sin usar
  `window.confirm` en ningún punto.

### 16.1 Pendiente

- Correr la migración `051` contra producción.
- El botón "Traspasar" del drawer sigue deshabilitado ("Próximamente") aunque el módulo de
  Traspasos ya existe y funciona desde el menú — nunca se conectó. Fuera de alcance de esta
  sesión, queda para quien quiera cerrarlo.
- Si en el futuro se necesita reasignar automáticamente los recursos liberados al reactivar un
  empleado, hoy `Retiro.reactivar()` no lo hace (queda documentado en el modal, decisión
  consciente para no adivinar qué recurso debería recibir de vuelta).

---

## 17. Sesión 2026-09-28 (continuación) — Documento secundario solo para PPT/Pasaporte

El usuario pidió que "Tipo de documento secundario" e "Identificación secundaria" (paso 1 de
`AgentForm.jsx`) solo aparezcan cuando el tipo de documento **principal** es PPT o Pasaporte —
para CC (y el resto) no tiene sentido pedirlo. `codigo` en el catálogo `tipo_identificacion` es
`PPT` y `PA` respectivamente (Pasaporte, no "PAS" como lo nombró el usuario — confirmado contra
la BD real antes de codificar la condición).

**`AgentForm.jsx`:** se agregó `mostrarDocumentoSecundario` (deriva el código del tipo de
documento principal elegido y compara contra `'PPT'`/`'PA'`) envolviendo los dos campos con `&&`
en vez de ocultarlos con `display:none` — así tampoco quedan en el DOM ni conservan validación
HTML residual. Se agregó `handleTipoIdentificacionChange` (reemplaza el `onChange` genérico de
ese select): al cambiar el tipo principal a algo que no sea PPT/PA, limpia
`tipo_identificacion_secundaria_id` y `numero_identificacion_secundaria` en el mismo `setState` —
si no se limpiaran, un usuario que eligiera PPT, llenara el secundario y después corrigiera a CC
dejaría esos dos campos guardados en silencio sin verlos en pantalla.

**Verificado en el navegador:** con el selector vacío, los campos no aparecen. Al elegir "Cédula
de ciudadanía (CC)" siguen sin aparecer. Al elegir "Permiso por protección temporal (PPT)"
aparecen; se llenó "Identificación secundaria" con un valor de prueba y se volvió a cambiar el
tipo principal a CC — los campos desaparecieron (y, por el `handleTipoIdentificacionChange`,
quedan limpios en el estado, no solo ocultos). No se guardó ningún dato de prueba. `npx eslint`
sin errores nuevos.

---

## 18. Sesión 2026-09-29 — Auditoría campo a campo del formulario contra el Excel fuente, "analista
encargado" automático desde el login, y correcciones menores

A pedido del usuario, se comparó `AgentForm.jsx` (alta/edición manual de empleado) columna por
columna contra las **dos hojas que él definió como fuente de verdad** para ese formulario: hoja
**"Nuevo Epleado"** (72 columnas, `Descargas/DATOS (1) (1).xlsx`) y hoja **"EJEMPLO"** (56
columnas, `Descargas/NominaEmpleadosWO190723-1 0826.xlsx`) — a diferencia de "TOTAL PERSONAL",
que es la hoja del import masivo y tiene columnas adicionales (traslado/retiro/vacunación/
analista/observaciones) que estas dos no tienen (ver §15).

### 18.1 "Nombre propio" — campo automático de solo lectura

La columna "Nombre Propio" de "Nuevo Epleado" (col. 14, ej. `"Vargas Moreno Kevin Alejandro"`)
resultó ser el nombre completo en orden Apellido-Apellido-Nombre-Nombre, puramente derivado de
las 4 columnas de nombre/apellido que el formulario ya capturaba — mismo criterio que
`nombre_completo` (`CONCAT_WS` en `models/UserCompany.js:13`). Se agregó a `AgentForm.jsx` un
campo de **solo lectura** justo después de "Segundo apellido" que muestra ese valor calculado en
vivo (`nombrePropio`, línea ~57-64), sin guardarlo en el estado `personal` — nunca viaja en el
`payload` del `POST`/`PUT`.

### 18.2 Ciudad de trabajo vs. Ciudad de residencia

El campo "Ciudad" de la sección "Dirección de residencia" no tenía columna propia en el Excel —
el import masivo reutiliza el mismo valor de "Ciudad Donde Labora" tanto para
`contrato.ciudad_id` como para `direccion.ciudad_id` (`services/importEmpleadosService.js:343` y
`:385`), porque el Excel no distingue "ciudad donde trabaja" de "ciudad donde vive". Para evitar
confusión en el formulario manual (donde sí pueden ser distintas, ej. alguien que vive en Soacha
y trabaja en Bogotá), se renombró la etiqueta a **"Ciudad de residencia"** (`AgentForm.jsx`,
campo `direccion.ciudad_id`), dejando **"Ciudad de trabajo"** (`contrato.ciudad_id`) como estaba.
Ambos siguen siendo campos independientes en la BD, solo cambió el texto de la etiqueta.

### 18.3 Fin de periodo de prueba automático (+2 meses) y Fin de contrato condicional

Dos reglas de negocio nuevas en el paso "Contratación" de `AgentForm.jsx`:

- **Fin de periodo de prueba**: al capturar/cambiar "Fecha de ingreso" (`handleFechaIngresoChange`),
  se autocompleta con `fecha_ingreso + 2 meses` mediante el helper `sumarMeses` (maneja bien fin
  de mes y años bisiestos: no desborda el mes destino). El campo sigue siendo editable a mano si
  el caso real difiere.
- **Fin de contrato**: ahora es condicional (`mostrarFinContrato`) — solo aparece si el "Tipo de
  contrato" elegido **no** es Indefinido (se detecta por nombre del catálogo, que no tiene columna
  `codigo`). Al cambiar a Indefinido (`handleTipoContratoChange`) se limpia `fecha_fin_contrato`
  del estado, mismo criterio que el documento secundario del §17 (no dejar un valor guardado en
  silencio si el usuario cambia de tipo de contrato).

### 18.4 "Analista encargado" deja de pedirse en el formulario — se toma automático del login

El usuario aclaró que "Analista encargado" (`contrato.analista_encargado_id`) debe ser **quien
registra al empleado**, no un dato que se pida en el formulario ni algo relacionado con el
proceso de retiro. Cambios:

- **`AgentForm.jsx`**: quitado el `selectField('Analista encargado', ...)` del paso
  "Contratación". El campo sigue en el estado `contrato` (para no perder el valor al editar un
  empleado que ya lo tenga, por ejemplo importado).
- **`controllers/userCompanyController.js::create()`**: se agregó
  `data.contrato.analista_encargado_id = req.user.users_company_id || null;` justo después de
  `extraerCampos()` — se pisa lo que venga del body, siempre se deriva del JWT de quien hace el
  `POST`. Solo aplica en `create()`, no en `update()` (así no se sobreescribe si otra persona de
  RRHH edita después al mismo empleado).
- **Diagnóstico del gap con el Excel real**: la columna "Analista Encargado" **sí** trae dato real
  en las 389 filas de "TOTAL PERSONAL" (ej. `"STEFANY VELASQUEZ"`, `"MARIA REYES"`), pero **nunca
  llegó a la BD** — de 397 contratos, solo 1 (un residuo de prueba) tiene `analista_encargado_id`
  no nulo. Causa: `services/importEmpleadosService.js::resolverJefesYAnalistas()` busca coincidencia
  **exacta** contra el nombre completo de 4 partes, y el Excel da el nombre corto de 2 partes —
  "Stefany Velasquez" nunca calza con "Stefany Julieth Velasquez Rodriguez". Además, no todos los
  analistas nombrados existen como empleado en el sistema (`"MARIA REYES"` no tiene ningún match
  ni por nombre completo ni por primer nombre + primer apellido) — ni el mejor matching lo
  resolvería. **Decisión del usuario: no corregir el import histórico** — los ~389 empleados
  importados quedan con este campo en `NULL`, y de aquí en adelante cada alta nueva por el
  formulario manual sí lo lleva, tomado del login.

### 18.5 `recursosHumanos` ahora exige ficha de empleado vinculada

Como el punto anterior depende de que `req.user.users_company_id` exista, se verificó contra la
BD local que **ninguna** cuenta `recursosHumanos`/`admin` tenía ficha vinculada — la única cuenta
`recursosHumanos` real (`recursoshumanos`, id 28) es de prueba (`full_name = "PruebaRecursosHumanos"`),
sin ficha de empleado que le corresponda.

- **`controllers/userController.js:4`**: `ROLES_VINCULADOS_A_EMPLEADO` ahora incluye
  `'recursosHumanos'` (antes solo `director_operaciones`/`empleado`) — activa la validación ya
  existente en `createUser`/`updateUser`: sin `users_company_id` la petición se rechaza con 400.
- **`UserManagement.jsx:51`**: mismo array actualizado — el selector "Empleado (ficha de RRHH) *"
  ahora también aparece al crear/editar una cuenta con rol `recursosHumanos`.
- **Cuenta de prueba creada** (a pedido del usuario, vía `User.create()` para que el hash de
  contraseña sea idéntico al de la app real): `sharon.pardo` / `Rrhh2026*`, rol `recursosHumanos`,
  vinculada a `users_company.id = 299` (Sharon Disley Pardo Sánchez, cargo "ANALISTA DE GESTIÓN
  HUMANA", contrato activo, sin cuenta previa). Verificado login con `User.validatePassword()`.
- **Pendiente real**: la cuenta `recursoshumanos` de prueba (id 28) sigue sin ficha — la próxima
  vez que se edite desde `/users` va a exigir elegir una. El usuario todavía no ha identificado
  quién es el analista real de RRHH que va a operar el módulo en producción.

### 18.6 Filtro "Analista" en la tabla de empleados

- **`models/UserCompany.js`**: `SELECT_EMPLEADO` ganó un self-join a `users_company` (alias
  `ana`) para resolver `analista_encargado_id` a `analista_encargado_nombre`, expuesto en
  `GET /users-company` (`getAll`/`getById`) — mismo patrón que los self-joins de `Traspaso.js`
  para jefe de área/inmediato.
- **`AgentManagement.jsx`**: nuevo chip de filtro "Analista" (`filtroAnalistas`,
  `opcionesAnalista`), mismo componente `FiltroChip` y mismo criterio AND con los demás filtros
  (Campaña/Estado/Cargo). Solo muestra como opción a los analistas que ya tengan al menos un
  empleado registrado bajo su nombre.

### 18.7 Campos quitados del formulario manual por no estar en ninguna de las dos hojas fuente

Comparando el resto de los ~50 campos del formulario contra "Nuevo Epleado" + "EJEMPLO" completos
(columna por columna, con datos reales de muestra para desambiguar headers repetidos por celdas
combinadas), se encontraron 2 campos más que solo existen en "TOTAL PERSONAL" y se quitaron de
`AgentForm.jsx` (mismo criterio que "Analista Encargado" del §18.4 — se dejan en el estado para no
perder el dato al editar un empleado ya importado, y **siguen mostrándose en `EmpleadoDrawer.jsx`
sin cambios**):

- **"Fecha certificación laboral y cesantías"** (`contrato.fecha_entrega_certificacion_laboral`).
- **"Vacunación COVID-19"** (`tipo_vacuna_id`, `primera_dosis_fecha`, `segunda_dosis_fecha`) —
  sección completa quitada.
- **"Observaciones"** (`contrato.observaciones`).

Con esto, las dos hojas fuente quedan con cobertura 1:1 contra el formulario: todo lo que traen se
captura, y nada de lo que se captura viene de fuera de ellas (salvo las excepciones explícitas de
§18.4, que el usuario pidió a propósito).

### 18.8 Bug corregido: "Carnet: —" en el drawer de perfil

Detectado durante la prueba end-to-end de §18.9: `EmpleadoDrawer.jsx` mostraba `"Carnet: —"` en la
sección "Recursos asignados" aunque el carnet sí estuviera marcado como entregado. Causa: a
diferencia de diadema/locker (que siempre tienen un `identificador`), el carnet se guarda con
`identificador: null` a propósito (`models/UserCompany.js::guardarRecursos()`, no tiene serial) y
tampoco se setea `fecha_entrega` — el `[...].filter(Boolean).join(' · ') || '—'` de la línea 271
del drawer siempre caía al fallback `'—'`, indistinguible de "no entregado". **Fix:** el fallback
cambió a `'Entregado'` — la sola presencia de la fila en `recursos_asignados` ya implica que el
recurso fue asignado.

### 18.9 Prueba end-to-end en el navegador

Con la cuenta `sharon.pardo` (§18.5), se registró un empleado de prueba (`9500000042`, "Prueba
Automatizada Formulario Completo") llenando **todos** los campos de las dos secciones del
formulario. Verificado en el perfil tras guardar: `nombrePropio` en vivo, `fecha_fin_periodo_prueba`
calculada correctamente (29 sept → 29 nov 2026), `fecha_fin_contrato` visible por elegir tipo
"Fijo", `analista_encargado_nombre = "SHARON DISLEY PARDO SANCHEZ"` guardado sin haberlo pedido en
el formulario, y el resto de secciones (identificación, personales, dirección, laboral, salario,
seguridad social completa, cuenta bancaria, contacto de emergencia, dotación, recursos) redondeando
sin pérdida de datos. El bug de §18.8 se detectó y corrigió en esta misma prueba. Empleado de
prueba eliminado al terminar (397 empleados de vuelta, `$773.834.808` de gasto mensual de vuelta a
su valor original).

## 19. Sesión 2026-09-29 (continuación) — Auditoría completa contra las dos hojas fuente + campo faltante "Tipo de vivienda"

A pedido del usuario, se repitió la auditoría de §18 pero en las dos direcciones: no solo
"¿sobra algo en `AgentForm.jsx` que no esté en las dos hojas?" sino también "¿falta algo de las
dos hojas que no se esté capturando?". Se leyeron los encabezados reales de las dos hojas
directamente de los archivos (`Descargas/DATOS (1) (1).xlsx` hoja "Nuevo Epleado", 72 columnas;
`Descargas/NominaEmpleadosWO190723-1 0826.xlsx` hoja "EJEMPLO", 56 columnas) con un script Node
puntual (no se dejó archivo, se descartó tras usarlo) y se cruzaron columna por columna contra
cada campo del formulario.

**Resultado de la dirección "¿sobra algo?":** ninguno. Los ~50 campos vigentes de `AgentForm.jsx`
están respaldados por al menos una de las dos hojas. El checkbox "Dotación Aplica" (revisado en
la misma sesión, ver más abajo) también está bien sourced (columna real en ambas hojas) — su
problema es que está desconectado de las tallas en la UI, no que no debería existir.

**Resultado de la dirección "¿falta algo?":** un hueco real. La hoja "EJEMPLO" tiene una columna
`Tipo Dirección` (índice 24) con valor `"Casa"` en las 7 filas reales de la muestra — **distinta**
de `Tipo De Dirección` de "Nuevo Epleado" (`"URBANO"`, ya mapeada a `direccion.zona_direccion_id`,
migración 047). Verificado que no existía ningún catálogo de "tipo de vivienda" en el esquema. El
usuario pidió cerrarlo.

**Migración `052_add_tipo_vivienda_direccion.sql`:** catálogo nuevo `tipo_vivienda` (sembrado solo
con `'Casa'`, único valor confirmado en la muestra — mismo criterio que `tipo_sena`/`empresa`/etc.
de la migración 050: sembrar solo lo visto, dejar el catálogo listo para crecer) +
`direccion.tipo_vivienda_id` (FK `ON DELETE RESTRICT`, después de `zona_direccion_id`). Validada
contra una copia temporal de `direccion` (clonada con `SHOW CREATE TABLE`, creada y destruida en
la misma prueba) antes de aplicarla. **Ya aplicada contra la BD local** (`call_center_support`).
**Pendiente correr contra producción.**

**Backend cableado** (`models/UserCompany.js`): `guardarDireccion()` ya lee/escribe
`tipo_vivienda_id` en el `INSERT`/`UPDATE` de `direccion`; `getCatalogos()` expone `tipos_vivienda`.
`getByIdCompleto()` no necesitó cambio (usa `SELECT * FROM direccion`, ya trae la columna nueva
sola).

**Frontend:** `AgentForm.jsx` — nuevo selector "Tipo de vivienda" en la sección "Dirección de
residencia", junto a "Zona"; estado `direccion.tipo_vivienda_id` inicializado vacío y precargado al
editar. `EmpleadoDrawer.jsx` — nueva fila de detalle junto a "Zona", mismo patrón (`nombreDe` +
`Dl`, se oculta si no hay valor).

**Verificado:** migración probada en copia temporal y luego aplicada a la BD local real; `node -c`
sin errores en `UserCompany.js`; `npx eslint` sin errores nuevos (el único reportado en
`EmpleadoDrawer.jsx` es el falso positivo ya documentado en §11.1); prueba funcional end-to-end
contra el backend real corriendo (JWT de prueba con la cuenta `sharon.pardo`, rol
`recursosHumanos`): `GET /catalogos` confirma `tipos_vivienda: [{id:1, nombre:'Casa'}]`, alta de un
empleado desechable (`9500000099`, id 412) con `direccion.tipo_vivienda_id: 1`, `GET` confirmando
el round-trip completo, y `DELETE` de limpieza.

## 20. Sesión 2026-09-29 (continuación) — Catálogo `tipo_novedad` reemplazado por las novedades de Contratación

El usuario pidió quitar las 12 opciones vigentes de "Tipo de novedad" (sembradas por la migración
040: 8 `RRHH` genéricas de incapacidad/licencia + 4 `OPERACION` de asistencia) y dejar solo estas
13, todas bajo la categoría `CONTRATACION`: Vacaciones, Incapacidad Accidente Trabajo,
Incapacidades origen común, Incapacidades accidente de tránsito, Licencia de paternidad, Licencia
de Maternidad, Licencia No remunerada, Licencia Remunerada, Licencia por luto, Suspensiones, Horas
de votación, Licencia Jurado de Votación, Día de la familia (nombres guardados tal cual los
escribió el usuario, sin normalizar tildes/mayúsculas).

**Bloqueante encontrado antes de tocar nada:** `novedad_rrhh` (id 3) referenciaba
`tipo_novedad_idtipo_novedad=12` ("Cambio de turno") — la única fila real de esa tabla en la BD
local, y su contenido (`resumen_diagnostico`/`observaciones` = "dsssssssssssssss"/
"sddddddddddddddd") es evidentemente un registro de prueba olvidado de una sesión anterior. La FK
`fk_nov_rrhh_tipo_novedad` es `ON DELETE RESTRICT`, así que no se podía vaciar el catálogo sin
resolver esa fila primero. Confirmado con el usuario: se borra (no era un dato de negocio real).

**Migración `053_reemplazar_tipo_novedad_contratacion.sql`:** borra esa fila de prueba, vacía
`tipo_novedad` por completo y siembra las 13 filas nuevas bajo `categoria='CONTRATACION'`. Deja
una advertencia explícita en el propio archivo: si se corre contra una BD (ej. producción) donde
`novedad_rrhh` sí tiene registros reales apuntando a alguno de los 12 tipos viejos, el `DELETE`
fallará por la FK — señal correcta de resolver esos registros a mano antes, no de forzar el borrado.
**Ya aplicada contra la BD local.** **Pendiente correr contra producción** (ahí sí puede haber
novedades reales que bloqueen el `DELETE` — revisar antes de correrla).

**Sin cambios de código:** ni `NovedadForm.jsx` ni `NovedadesRRHH.jsx` tenían nada hardcodeado de
`RRHH`/`OPERACION` — ambos leen el catálogo dinámicamente desde `GET /users-company/catalogos`, así
que el cambio de opciones es puramente de datos. Verificado contra el endpoint real: las 13 filas
nuevas aparecen, las 12 viejas ya no.

### 20.1 Pendiente

- Correr la migración `053` contra producción, revisando primero si `novedad_rrhh` tiene
  registros reales que referencien alguno de los 12 tipos viejos (en local no los había, en
  producción no se ha verificado).

---

### 19.1 Pendiente

- Correr la migración `052` contra producción.
- El catálogo `tipo_vivienda` solo tiene `'Casa'` — agregar `'Apartamento'` u otros valores cuando
  aparezca un dato real que lo traiga (mismo caso que `tipo_sena` en la migración 050).

### 19.2 Prueba en el navegador de todo el módulo (misma sesión, más tarde)

A pedido del usuario, se probó el módulo completo en el navegador real (`npm run dev`,
`localhost:5173`) con la cuenta `sharon.pardo` (`recursosHumanos`, ya existente, vinculada a
`users_company.id=299`):

- **Empleados → Nuevo empleado**: modal completo, selector "Tipo de vivienda" presente y
  funcional (Sin especificar/Casa) junto a "Zona".
- **Novedades → Nueva novedad**: el dropdown "Tipo de novedad" mostró exactamente las 13 opciones
  `[CONTRATACION]` de la migración `053`, sin rastro de las 12 anteriores.
- **Traspasos** y **Pasivo vacacional**: cargan bien, sin regresiones, con su único registro real
  cada uno.
- **Drawer de perfil** (`EmpleadoDrawer.jsx`): todas las secciones correctas; "Tipo de vivienda" no
  aparece para empleados importados (viene `NULL`, comportamiento esperado — el campo solo se
  puede capturar desde el formulario manual, nunca desde el import masivo).
- **Modal "Registrar retiro"**: carga bien, las 8 categorías de `tipo_retiro` (migración 051)
  correctas.
- **Alta completa de un empleado de prueba end-to-end vía UI** (no solo API): creado
  `9500000123` / "Pruebanavegador Tipovivienda" con Tipo de vivienda = Casa, Cliente = Asiste,
  Campaña = Administración y Finanzas, Cargo = Analista de Gestión Humana, etc. Confirmado tras
  guardar: el listado pasó de 397 a 398 empleados, el drawer mostró **"Analista encargado: SHARON
  DISLEY PARDO SANCHEZ"** guardado automáticamente sin pedirlo en el formulario (confirma de nuevo
  el comportamiento de §18.4), y "Fin periodo de prueba" calculado correctamente a +2 meses.
  **Nota:** como no se llenó el campo "Dirección" (calle), `guardarDireccion()` no creó ninguna
  fila de dirección (por diseño: `if (!direccion.direccion || !direccion.tipo_direccion_id) return`,
  ver `models/UserCompany.js`), así que el drawer no mostró la sección "Dirección" ni pudo
  confirmarse ahí "Tipo de vivienda: Casa" — el round-trip de ese campo específico ya se había
  verificado por API con un payload de dirección completo (ver cierre de la sesión anterior), esto
  solo confirma que el resto del formulario funciona de punta a punta en el navegador. Empleado de
  prueba eliminado al terminar (397 empleados y gasto mensual de vuelta a sus valores originales).

---

## 21. Sesión 2026-09-29 (continuación) — Sueldo sugerido por Cliente+Cargo y causas de retiro reales

El usuario trajo un Excel nuevo, `Descargas/Informacion 280926 (1).xlsx`, con dos hojas: "Salarios"
(59 filas, 4 bloques Cliente/Cargo/Salario) y "Causas finalizacion contrato" (5 filas Tipo De
Retiro/Motivo De Retiro/Justificacion). Pidió que el campo "Salario mensual" de `AgentForm.jsx` se
autocompletara segun Cliente+Cargo, y que el catalogo de retiro reflejara las causas reales.

**Decisiones tomadas con el usuario antes de tocar el esquema** (ver hilo de preguntas de esta
sesión):
1. Ambigüedad real: ASISTE + "AYUDANTE DE OBRA" trae 3 salarios distintos en el Excel
   (2.200.000/2.300.000/2.500.000, sin ningún dato que distinga cuál aplica). Se guardan las 3 filas
   tal cual, pero el autocompletado **no actúa** cuando hay más de un salario distinto para la misma
   combinación Cliente+Cargo — el campo queda como estaba, sin adivinar.
2. El sueldo autocompletado queda **editable** (sugerencia), no bloqueado — mismo criterio que "Fin
   de periodo de prueba" (§18.3).
3. Dos cargos del Excel no matcheaban exacto contra el catálogo `cargo`: "GTR (Gestor en Tiempo
   Real)" y "FORMADOR SENIOR PE". Se fusionaron contra el cargo existente más parecido ("GTR" y
   "FORMADOR SENIOR") en vez de crear cargos nuevos.
4. El catálogo `tipo_retiro` (8 valores genéricos sembrados en la 051 a falta de dato real, ver esa
   migración) se reemplaza por los 5 valores reales del Excel — mismo criterio ya aplicado con
   `tipo_novedad` en la 053. El "Motivo De Retiro" viene emparejado 1 a 1 con cada tipo en la fuente:
   se agregó `motivo_sugerido` a `tipo_retiro` para autocompletar el campo "Motivo" (que sigue siendo
   texto libre, editable) al elegir el tipo. "Justificación" solo trae nota en la fila "Renuncia
   Voluntaria" ("Solo aplica en este Item"): se agregó `requiere_justificacion` (booleano) para
   mostrar/exigir ese campo únicamente en ese caso — mismo patrón condicional que el documento
   secundario de PPT/Pasaporte (§17).

**Migración `054_create_salario_referencia.sql`:** tabla nueva `salario_referencia`
(`Cliente_idCliente`, `cargo_idcargo`, `salario`), **sin** UNIQUE KEY sobre (cliente,cargo) — a
propósito, por el caso de Ayudante de Obra. Sembrada con 58 filas generadas por script a partir del
Excel (59 filas crudas, 1 colapsada por ser duplicado exacto de "Coordinador call"/"Jefe de
operaciones" en Claro con el mismo valor). Los 4 clientes del Excel (ASISTE/CLARO/OBAMACARE/
OBAMACARE-LV) ya existían tal cual en el catálogo `cliente`; de 48 cargos únicos, 46 matchearon
exacto y 2 se fusionaron según la decisión 3 de arriba.

**Migración `055_reemplazar_tipo_retiro_causas_reales.sql`:** ensancha `tipo_retiro.nombre` a
VARCHAR(80) ("Terminacion de contrato por periodo de prueba" son 45 caracteres, no entraba en el
VARCHAR(40) original), agrega `motivo_sugerido`/`requiere_justificacion`, borra los 8 valores viejos
y siembra los 5 reales. **Verificado antes de correrla** que `retiro` tenía 0 filas en local (el
`DELETE` es `ON DELETE RESTRICT` desde la tabla `retiro` — si hay retiros reales referenciando los
tipos viejos, falla, igual que advierte la 053 sobre `tipo_novedad`).

Ambas migraciones validadas contra una copia temporal (`test_migracion_054_055_temp`, tablas
`cliente`/`cargo`/`tipo_retiro` clonadas con datos reales) antes de aplicarlas. **Ya aplicadas contra
la BD local** (`call_center_support`). **Pendiente correr contra producción.**

**Backend cableado:** `models/UserCompany.js::getCatalogos()` expone `salarios_referencia`
(`cliente_id`, `cargo_id`, `salario`, sin resolver — la búsqueda de coincidencia la hace el
frontend sobre el arreglo completo, igual que el resto de catálogos) y `tipos_retiro` ahora incluye
`motivo_sugerido`/`requiere_justificacion`. `models/Retiro.js` no necesitó ningún cambio — sigue
guardando `motivo_retiro`/`justificacion` tal como lleguen del payload.

**Frontend:**
- `AgentForm.jsx`: nuevo helper `salarioSugerido(clienteId, cargoId)` — filtra
  `catalogos.salarios_referencia` por la combinación elegida; si hay más de un valor distinto,
  devuelve `null` (no autocompleta). Se dispara desde `handleClienteChange` (ya existía, ahora
  también intenta autocompletar con el cargo ya elegido) y desde un `handleCargoChange` nuevo
  (reemplaza el `onChange(setContrato)` genérico que tenía el selector "Cargo").
- `RetiroModal.jsx`: nuevo `handleTipoRetiroChange` — al elegir "Tipo de retiro" autocompleta
  "Motivo" con `motivo_sugerido` (editable) y limpia "Justificación" si el tipo no la requiere.
  El campo "Justificación" ahora se renderiza condicionalmente (`mostrarJustificacion`,
  derivado de `requiere_justificacion` del tipo elegido) en vez de mostrarse siempre.

**Verificado en el navegador** (cuenta `sharon.pardo`, `recursosHumanos`):
- Alta de empleado: Cliente=Claro + Cargo=Agente call center autocompletó "Salario mensual" a
  1.750.905,00 (coincide exacto con la fuente). Cliente=Asiste + Cargo=Ayudante de obra (el caso
  ambiguo) **no** tocó el campo, dejó el valor anterior intacto — confirma la decisión 1.
- Retiro: con un empleado desechable (`9500099888`, creado y borrado en la misma prueba), el
  dropdown "Tipo de retiro" mostró exactamente los 5 valores nuevos; al elegir "Renuncia
  Voluntaria" el Motivo se autocompletó a "Renuncia voluntaria" y apareció "Justificación*"
  (requerido); al cambiar a "Terminacion de contrato con justa causa" el Motivo cambió a "Justa
  causa" y "Justificación" desapareció. Registro guardado end-to-end (badge pasó a "Retirado"),
  empleado eliminado al terminar (397 empleados y gasto mensual de vuelta a sus valores originales).

**Corrección de formato (mismo día, a pedido del usuario):** el input nativo `type="number"` de
"Salario mensual" mostraba el valor autocompletado tal cual venía de la columna `DECIMAL` de
`salario_referencia` (ej. `1925996.00`), sin puntos de miles y con `.00` sobrando. Un
`<input type="number">` no admite separadores de miles (el navegador solo entiende `.` como
separador decimal), así que se cambió a `<input type="text" inputMode="numeric">`: se agregó el
helper `formatearMiles()` (redondea a entero y usa `toLocaleString('es-CO')` para mostrar
`1.925.996`) y `handleSalarioChange` (descarta todo lo que no sea dígito al escribir, guarda solo
números en el estado). `salarioSugerido()` también se ajustó para redondear a entero al
autocompletar, en vez de arrastrar el `.00` del `DECIMAL`. El payload sigue mandando un número
(`parseFloat`), sin cambios en el backend. Verificado en el navegador: Claro + Analista de calidad
autocompletó "1.925.996" en vez de "1925996.00".

### 21.1 Pendiente

- Correr las migraciones `054` y `055` contra producción — revisar antes si `retiro` tiene filas
  reales referenciando alguno de los 8 tipos viejos (en local no había ninguna).
- Decisión de negocio pendiente (no se tocó): para ASISTE + "Ayudante de obra" el sueldo sigue sin
  autocompletar por la ambigüedad de 3 valores en la fuente. Si en el futuro se identifica qué
  distingue a cada uno (ej. un nivel/seniority no capturado hoy), se podría desambiguar.

---

## 22. Sesión 2026-09-29 (continuación) — Más opciones en "Tipo de vivienda"

El catálogo `tipo_vivienda` (migración 052) solo tenía "Casa" — el único valor visto en la muestra
real del Excel en ese momento (§19). El usuario pidió agregar el resto de opciones estándar porque
el selector de `AgentForm.jsx` quedaba limitado a una sola opción.

**Migración `056_seed_mas_tipos_vivienda.sql`:** agrega Apartamento, Apartaestudio, Habitación,
Finca y Otro (`INSERT IGNORE`, por el `UNIQUE KEY` en `nombre` — no rompe si "Casa" ya existe). **Ya
aplicada contra la BD local.** **Pendiente correr contra producción.**

**Sin cambios de código:** `AgentForm.jsx` ya lee `catalogos.tipos_vivienda` dinámicamente (mismo
patrón que `tipo_novedad`/`tipo_retiro`, ver §20-21) — el selector muestra las 6 opciones solo con
el cambio de datos. Verificado contra `GET /users-company/catalogos`.

---

## 23. Sesión 2026-09-29 (continuación) — Ocultar "Obama" duplicado del selector "Cliente"

El usuario notó que el selector "Cliente" del paso "Contrato" (`AgentForm.jsx`) mostraba dos
opciones para el mismo cliente real: "Obama" y "OBAMACARE". Ya estaba diagnosticado en §13.1:
"Obama" (`cliente.idCliente=2`, campaña "Obama" id 2) es residuo de la semilla `036` — **0
contratos reales** la usan (confirmado de nuevo contra la BD: 317 Claro / 40 Asiste / 33 OBAMACARE
/ 7 BEEMO, cero bajo Obama). "OBAMACARE" (id 4) sí es el cliente real con 33 empleados.

**Pedido explícito del usuario:** ocultar uno de los dos en el selector para **altas nuevas**, sin
tocar ningún dato ya guardado — si algún empleado existente quedara registrado bajo "Obama" (hoy
ninguno lo está), su edición debe seguir mostrándolo tal cual, sin forzar el cambio.

**`AgentForm.jsx` — `clientesUnicos`:** se agregó un filtro que quita del `Map` cualquier cliente
cuyo nombre sea exactamente `'Obama'`, **salvo** que sea el cliente actualmente seleccionado
(`clienteId`) — así un empleado que ya estuviera vinculado a él (edición) lo seguiría viendo en el
selector, mientras que una alta nueva nunca lo ofrece como opción. No se tocó la BD (ni la
campaña "Obama" ni el cliente id 2 se borraron — siguen ahí, igual que "Obama" quedó documentado
como residuo pendiente de limpieza en §13.4, sin resolver todavía esa decisión de borrado).

**Verificado en el navegador:** con un alta nueva (formulario abierto y cerrado sin guardar), el
selector "Cliente" mostró exactamente `Asiste, BEEMO, Claro, OBAMACARE` — sin "Obama". `npx eslint`
sin errores nuevos.

---

## 24. Sesión 2026-09-29 (continuación) — Ida y vuelta sobre si "OBAMACARE-LV" es el mismo cliente que "OBAMACARE"

Primero se interpretó (mal) que el 4º bloque de la hoja "Salarios" (`Informacion 280926 (1).xlsx`),
etiquetado "OBAMACARE-LV", era el mismo cliente real que "OBAMACARE" — se migraron sus 5 filas de
`salario_referencia` de `Cliente_idCliente=6` a `Cliente_idCliente=4`. **El usuario corrigió esto de
inmediato: son dos clientes reales distintos**, cada uno con su propia lista de sueldos. Se
revirtió el cambio en el mismo turno, antes de que llegara a ningún ambiente además de local.

**Estado final (correcto):** las 5 filas de OBAMACARE-LV quedan en `Cliente_idCliente=6` (el
cliente `OBAMACARE-LV`, id 6), separadas de las 8 filas de OBAMACARE (`Cliente_idCliente=4`) — tal
como estaban sembradas originalmente en la versión inicial de la `054` (§21). Verificado con el
archivo de migración corregido contra una copia temporal (`cliente`/`cargo` clonados): coincide
fila por fila con la BD local (58 filas). Con esto, la ambigüedad que había aparecido por error en
"Backoffice Obamacare" y "Jefe de operaciones" bajo OBAMACARE **desaparece** — cada cliente vuelve a
tener su propio valor único por cargo.

**Advertencia dejada en la migración `054`, pendiente de resolver:** `OBAMACARE-LV` (`idCliente=6`)
sigue huérfano en el sistema — ninguna `campania` lo referencia (§13.1), y el selector "Cliente" de
`AgentForm.jsx` solo lista clientes que tienen al menos una campaña real (`clientesUnicos` se deriva
de `catalogos.campanias`, no de la tabla `cliente` completa). Esto significa que, **hoy, nadie puede
elegir "OBAMACARE-LV" como Cliente al dar de alta un empleado** — sus 5 filas de referencia están
bien sembradas pero son inalcanzables desde el formulario hasta que exista una campaña real bajo
ese cliente. Queda pendiente decidir si se crea esa campaña (y con qué nombre/área/centro de costo)
para que el autocompletado de sueldo realmente sirva para este cliente.

**Sin cambios de código** (frontend/backend) en ninguna de las dos vueltas: la lógica de
`salarioSugerido()`/`getCatalogos()` es genérica por `cliente_id`/`cargo_id`, no tiene ningún id
hardcodeado.

---

## 25. Sesión 2026-09-29 (continuación) — Campaña real para "OBAMACARE-LV"

Tras cerrar §24, el usuario notó que "OBAMACARE-LV" seguía sin aparecer en el selector "Cliente" del
formulario. Confirmaba justo la advertencia dejada en la migración `054`: el cliente existe en la
tabla `cliente` (`idCliente=6`) pero ninguna `campania` lo referenciaba, y `clientesUnicos` en
`AgentForm.jsx` deriva sus opciones de `catalogos.campanias`, no de la tabla `cliente` completa.

**Migración `057_seed_campania_obamacare_lv.sql`:** siembra una campaña `OBAMACARE-LV` (mismo
nombre que el cliente, igual patrón que la campaña `OBAMACARE` ya existente para el cliente
OBAMACARE) apuntando a `Cliente_idCliente=6`. `campania` solo tiene `idcampania`/`nombre`/
`Cliente_idCliente` — no hace falta decidir área ni centro de costo a nivel de campaña (esos se
eligen por empleado en `contrato`). **Ya aplicada contra la BD local** (`idcampania=22`).
**Pendiente correr contra producción.**

**Verificado en el navegador:** el selector "Cliente" ahora muestra `Asiste, BEEMO, Claro,
OBAMACARE, OBAMACARE-LV`; al elegir OBAMACARE-LV + Cargo "Agente comercial" el sueldo se
autocompletó a `1.750.905` (coincide con la fuente). Empleado de prueba cerrado sin guardar.

**Sin cambios de código.**

---

## 26. Sesión 2026-09-29 (continuación) — Selector "Cargo" filtrado por Cliente

El usuario pidió que el selector "Cargo" del paso "Contratación" (`AgentForm.jsx`) solo muestre los
cargos reales de cada Cliente (hoy muestra los 61 cargos del catálogo completo, sin filtrar) —
mismo criterio ya aplicado a Cliente→Campaña. `salarios_referencia` (migración 054) ya tiene
exactamente esa relación Cliente↔Cargo real, tomada de la hoja "Salarios": no hizo falta ningún
dato nuevo, solo usar la tabla que ya existía con otro propósito.

**`AgentForm.jsx`:**
- `cargosFiltrados`: si el Cliente elegido tiene al menos una fila en `catalogos.salarios_referencia`,
  el selector "Cargo" solo muestra esos cargos (más el que ya estuviera seleccionado, si no
  calzara — mismo criterio de preservar el valor en edición que ya se usó con "Obama", §23). Si el
  Cliente no tiene **ninguna** fila en `salarios_referencia` (ej. BEEMO, que no está en la hoja
  "Salarios" del Excel), **no se filtra** — se muestra el catálogo completo, para no dejar el
  selector vacío y bloquear el alta.
- `handleClienteChange`/`handleCampaniaChange`: si el Cargo ya elegido deja de pertenecer a los
  cargos reales del nuevo Cliente, se limpia (`cargo_id: ''`) — mismo criterio ya usado con
  Campaña, para no dejar seleccionado en silencio un cargo que ni siquiera aparece en las opciones
  visibles.

**Verificado en el navegador:** Cliente=Claro → el selector "Cargo" mostró exactamente los 16
cargos reales de Claro (Agente call center, Analista de calidad, Analista PQR, Backoffice,
Coordinador backoffice PE, Coordinador call, Datamarshall senior, Director de formación, Director
de operaciones, Formador, Formador senior, GTR, Jefe de backoffice, Jefe de operaciones,
Legalizador, Team leader — sin duplicados, aunque la fuente traía "Coordinador call" repetido).
Cliente=BEEMO (sin datos en el Excel de Salarios) → el selector mostró el catálogo completo (61
cargos), confirmando que no se rompe para clientes fuera de esa hoja. `npx eslint` sin errores
nuevos.

**Sin cambios de BD.**

---

## 27. Sesión 2026-09-29 (continuación) — "Jefe inmediato"/"Jefe de área"/"Director de área" filtrados a personas reales

El usuario pidió que estos tres selectores no ofrezcan los ~397 empleados como candidatos (hoy
comparten literalmente la misma lista completa, `empleadosJefe`), sino solo a quienes realmente
aparecen como jefe/director de alguien en los datos reales — identificando esas personas contra el
Excel importado.

En vez de releer el Excel a mano (con el riesgo de desajuste de nombres que ya se documentó en
§18.4 para "Analista Encargado"), se usó el dato ya resuelto: los ~389 empleados importados
(`resolverJefesYAnalistas()`, `services/importEmpleadosService.js`) ya emparejaron esos nombres
contra `users_company` y los dejaron guardados en `contrato.jefe_inmediato_id`/`jefe_area_id`/
`director_area_id`. Contar los valores **distintos ya usados** en esas tres columnas da exactamente
el conjunto de personas reales — sin tener que volver a matchear nombres:

- **Jefe inmediato**: 34 personas distintas (de 397 empleados).
- **Jefe de área**: 8 personas distintas.
- **Director de área**: 4 personas distintas.

**Backend — `models/UserCompany.js::getCatalogos()`:** nuevo helper `empleadosPorRol(columna)`
(llamado solo con los 3 nombres de columna fijos, nunca con datos de request) que hace
`SELECT DISTINCT` sobre `contrato` + `users_company`, y expone `jefes_inmediatos`/`jefes_area`/
`directores_area` en el catálogo. **Bug encontrado y corregido antes de terminar:** la primera
versión ordenaba por `u.primer_apellido, u.primer_nombre` con `SELECT DISTINCT` — MySQL lo rechaza
("Expression #1 of ORDER BY clause is not in SELECT list... incompatible with DISTINCT"), corregido
ordenando por el alias `nombre_completo` (que sí está en el `SELECT`). Verificado con
`GET /users-company/catalogos` real antes de probar en el navegador.

**Frontend — `AgentForm.jsx`:** `empleadosJefe` (una sola lista compartida) se reemplaza por tres
listas independientes (`jefesInmediatosOpciones`/`jefesAreaOpciones`/`directoresAreaOpciones`), cada
una filtrada desde su catálogo correspondiente vía el helper `filtrarJefes()` — que además conserva
el valor ya guardado si por algún motivo no estuviera en la lista "real" (mismo criterio ya usado
con Cargo en §26 y con "Obama" en §23; en la práctica no debería pasar nunca aquí, porque la lista
se deriva de esos mismos valores).

**Verificado en el navegador:** con un alta nueva, "Jefe inmediato" mostró exactamente 34 opciones,
"Jefe de área" 8 y "Director de área" 4 — coincidiendo uno a uno con las cuentas reales de la BD.
Modal cerrado sin guardar. `npx eslint` sin errores nuevos.

**Fuera de alcance, no tocado:** `TraspasoForm.jsx` (módulo Traspasos) también tiene selectores de
jefe de área/inmediato (anterior y nuevo, §8.1) que siguen usando la lista completa de empleados —
el pedido fue puntualmente sobre `AgentForm.jsx`. Si se quiere el mismo filtro ahí, es trabajo
aparte (los catálogos `jefes_inmediatos`/`jefes_area` ya están disponibles para reutilizar).

### 18.10 Pendiente

- Identificar a la persona real de RRHH que va a operar `/recursos-humanos` en producción, para
  crear/vincular su ficha de empleado y su cuenta real (no la de prueba `sharon.pardo`, que queda
  para descartar).
- Los ~389 empleados del import masivo quedan permanentemente sin `analista_encargado_id` —
  decisión consciente del usuario, no un bug pendiente de arreglar (§18.4).
- Ningún cambio de esta sesión tocó la base de datos ni requirió migración nueva — todo fue
  frontend (`AgentForm.jsx`, `AgentManagement.jsx`, `UserManagement.jsx`, `EmpleadoDrawer.jsx`) y
  backend de código (`userCompanyController.js`, `userController.js`, `UserCompany.js`), sin DDL.

---

## 28. Sesión 2026-09-30 — Recorte y ajustes finos de `AgentForm.jsx`, a pedido puntual del
usuario campo por campo (no una auditoría nueva contra las hojas fuente de §18/19)

Serie de instrucciones cortas y sueltas sobre el formulario de alta/edición de empleado. Se agrupan
aquí por sesión, no por tema. Patrón seguido en todas las remociones de campo (salvo que se diga lo
contrario): **se quita el control de la UI, pero el estado de React que lo respalda se conserva**
(sigue inicializándose y cargándose al editar) — así un empleado que ya tenga ese dato guardado
(por import masivo o alta previa) no lo pierde en silencio la próxima vez que alguien lo edite y
guarde el formulario. Solo deja de ser **capturable a mano**.

### 28.1 Campos quitados de la UI (estado conservado)

- **"Declarante de renta"** (checkbox, `personal.declarante_renta`).
- **"Tipo Sena"** (`contrato.tipo_sena_id`).
- **"Clase"** (`contrato.clase_contrato_id`) y **"Clasificación Dian"** (`contrato.clasificacion_dian_id`).
- **"Subtipo de cotizante"** (`contrato.subtipo_cotizante_id`).
- **"Fecha afiliación cesantías"** (`segSocial.cesantias_fecha_afiliacion`).

Ninguno de estos catálogos se tocó ni se eliminó de BD — `getCatalogos()` los sigue exponiendo,
por si se necesitan de nuevo más adelante.

### 28.2 "Estado del contrato" — oculto al crear, visible al editar

Antes se mostraba siempre. Ahora `{agente && selectField('Estado del contrato', ...)}` — `agente`
es `null` en alta y el objeto del empleado en edición (prop que ya distinguía ambos modos). No hizo
falta tocar el backend: `insertarContrato()` en `models/UserCompany.js` ya dejaba el contrato en
`activo` por defecto (`estadoContratoActivo()`) cuando el campo llegaba vacío/`undefined`. Verificado
en el navegador en ambos modos.

### 28.3 "Dotación" (Talla camisa/pantalón/calzado) — sección condicionada al checkbox "Aplica"

Antes las 3 tallas se mostraban siempre, sin importar el checkbox. Ahora están envueltas en
`{contrato.aplica_dotacion && (...)}`. Además, **`aplica_dotacion` cambia su valor por defecto de
`true` a `false`** para un alta nueva (línea del `useState` inicial de `contrato`) — el checkbox
arranca sin marcar. El valor por defecto al **editar** un empleado existente sigue siendo el que
trae la BD (columna `contrato.aplica_dotacion TINYINT(1) NOT NULL DEFAULT 1`, migración 050); el
`|| true` que ya existía en el `useEffect` de carga es solo para el caso legacy de un registro sin
ese campo poblado, no se tocó. Confirmado que alta y edición son instancias de React separadas
(`{showCreateForm && <AgentForm .../>}` / `{showEditForm && ... <AgentForm .../>}` en
`AgentManagement.jsx`), así que el nuevo default no arrastra estado de una sesión de edición previa.

### 28.4 "Tipo de contrato" = Aprendizaje → sugiere "Fin de contrato" a 6 meses del ingreso

Mismo patrón que ya existía para "Fin periodo de prueba" (+2 meses, helper `sumarMeses()`). Se
dispara en dos puntos — `handleTipoContratoChange` (si ya hay fecha de ingreso al elegir
Aprendizaje) y `handleFechaIngresoChange` (si el tipo de contrato ya elegido es Aprendizaje) — para
que quede bien sin importar el orden en que se llenen los dos campos. Sigue siendo editable
después. Verificado en el navegador con dos fechas de ingreso distintas (15 y 31 del mes),
incluyendo el caso sin desborde de mes que ya cubre `sumarMeses()`.

### 28.5 Formato de fecha dd/mm/aaaa — aclarado, explícitamente no tocado

El usuario reportó ver fechas en mes/día/año en los `<input type="date">` nativos del formulario.
Se le explicó que ese formato lo decide el navegador/SO de quien lo abre (idioma/región), no el
código — el valor guardado por debajo siempre es ISO (`aaaa-mm-dd`), y como el equipo real de RRHH
opera con Windows/Chrome en español, es muy probable que ya les salga bien en producción. Se le
preguntó si de todas formas quería forzar el formato con un input de texto enmascarado (perdiendo
el calendario emergente nativo) — **eligió no tocar nada**. Sin cambios de código.

### 28.6 Sueldo sugerido (054) — resuelve el caso ambiguo, bloquea el campo, distintivo visual

Hasta ahora, cuando Cliente+Cargo tenían más de un salario real distinto en `salarios_referencia`
(ej. Asiste + Ayudante de obra: 2.200.000 / 2.300.000 / 2.500.000), el campo "Salario mensual"
simplemente se dejaba intacto, sin ayuda. Cambios:

- **Selector "Sueldo sugerido — elige uno"** (`salariosAmbiguos`, derivado de
  `catalogos.salarios_referencia` filtrado por Cliente+Cargo actual): aparece solo cuando hay >1
  valor real distinto, con cada opción formateada en pesos (`$ 2.200.000`, etc.). Al elegir una,
  llena "Salario mensual".
- **"Salario mensual" se bloquea (`disabled`)** en cuanto toma valor por autocompletado único
  (caso normal, 1 solo valor real) o por este selector (`salarioBloqueado`, nuevo estado) — se
  vuelve a habilitar solo si Cliente o Cargo cambian a una combinación sin referencia salarial.
  **Al editar un empleado ya existente el campo arranca SIN bloquear** (el bloqueo solo se activa
  cuando el valor se fija dentro de esta misma sesión de formulario) — así se conserva la
  posibilidad de registrar un aumento de sueldo real al editar, aunque su cargo tenga referencia.
- **Distintivo visual en "Cliente" y "Cargo"**: etiqueta pequeña "$ SALARIO" junto al label +
  borde izquierdo cian en el campo (`ai-field--salario-source`/`ai-label-tag`, nuevas clases en
  `src/styles/asiste-ui/components.css`, reutilizando tokens ya existentes `--brand-cyan`/
  `--primary-soft` — sin paleta nueva). También se agregó `.ai-input:disabled` (fondo
  `--surface-200`, ya documentado en tokens.css como "campos deshabilitados", nunca antes usado).

Placeholder del selector ajustado a pedido del usuario a simplemente **"Elige salario"** (antes
describía cuántos sueldos había, se consideró innecesario). Verificado en el navegador: Asiste +
Ayudante de obra → selector con los 3 valores reales, elegir uno llena y bloquea el campo; Asiste +
Abogado laboral (1 solo valor) → autocompleta directo, sin selector, también bloqueado.

### 28.7 "Tipo cotizante" restringido a Dependiente/Independiente — migración `058`

El catálogo `tipo_cotizante` (migración 050) solo tenía sembrado "Dependiente". Migración
**`058_seed_tipo_cotizante_independiente.sql`** (`INSERT IGNORE`, respeta el `UNIQUE KEY` de la
050) agrega "Independiente". Efecto colateral esperado y aceptado: el autocompletado `unicoId()`
que preseleccionaba "Dependiente" al alta (por ser el único valor del catálogo) deja de aplicar
para este campo, porque ya hay 2 valores — ahora RRHH tiene que elegir explícitamente uno de los
dos. Aplicada en local (BD local queda hasta la **058**); pendiente en producción como el resto
desde la 043.

### 28.8 "Tarifa ARL (%)" — de campo numérico libre a selector de 5 clases de riesgo

Antes era un `<input type="number">` libre (0–100, step 0.00001). El usuario pidió un selector con
las 5 clases de riesgo ARL colombianas (tarifas fijas por decreto, **no un catálogo de BD** — se
definieron como constante `TARIFAS_ARL` en el propio `AgentForm.jsx`, con la descripción de
actividades de cada clase en el texto de la opción):

| Clase | Tarifa | Actividades (texto de la opción) |
|---|---|---|
| I | 0,522% | Oficinas, actividades administrativas y financieras |
| II | 1,044% | Comercio al por menor, manufactura ligera y restaurantes |
| III | 2,436% | Procesos industriales, manufactura y confecciones |
| IV | 4,350% | Transporte, vigilancia privada y manufactura pesada |
| V | 6,960% | Construcción y minería |

**Importante:** el `value` de cada `<option>` es únicamente el número (`"0.522"`, `"6.960"`, etc.) —
lo mismo que ya viajaba al backend con el input numérico anterior. `seguridad_social.tarifa_arl`
(`DECIMAL(8,5)`, migración 034/038) no cambió de tipo ni de validación (`validarObligatorios()` en
`userCompanyController.js` sigue exigiendo un número entre 0 y 100). Sin cambios de BD ni de
backend — cambio puramente de UI. Verificado en el navegador leyendo `select.value` tras elegir
"Clase III": queda exactamente `"2.436"`.

Nota: la descripción de la Clase V que trajo el usuario venía cortada a mitad de frase
("...trabajos en"); se dejó como "construcción y minería" en vez de inventar el resto —
pendiente que el usuario confirme/complete el texto si quiere el detalle completo.

**Sin cambios de BD en 28.1–28.6 y 28.8** (todo frontend); la única migración de esta sesión es la
`058` (28.7).

---

## 29. Sesión 2026-09-30/10-01 — Filtro de jefatura real, deploy de esquema a producción, carga de
los 389 empleados reales y un bug encontrado en el camino

Sesión larga que cerró el ciclo completo: filtro nuevo en el formulario → deploy del esquema
pendiente (043-058) a producción → bloqueo real al crear el primer usuario `recursosHumanos` en
producción (sin empleados) → carga de los 389 empleados reales vía `.sql` generado → bug
encontrado y corregido en el camino. Commit backend `6d2b858` ("Agregar módulo de Asistencia y
ampliar módulo de Recursos Humanos", `sebas-branch`, sin push por pedido explícito del usuario).
Commits frontend `69f39ab` (mismo alcance) y `ab8a39d` ("ajuste error", el fix de §29.7) — estos
dos **ya están pusheados** a `origin/sebas-branch` (el usuario los maneja directo, fuera de esta
sesión).

### 29.1 Mapeo exacto de columnas Jefe inmediato/Jefe de área/Director de área

Leído directo del header real de la hoja **"Nuevo Epleado"** de `Descargas/DATOS (1) (1).xlsx`
(`xlsx` contra el archivo, no por memoria): las tres columnas están contiguas, índices 31-33:

| Campo del formulario | Columna (índice 0-based) | Encabezado real |
|---|---|---|
| Director de área | 31 | `Director de Área` |
| Jefe de área | 32 | `Jefe de Área` |
| Jefe inmediato | 33 | `Jefe Inmediato` |

### 29.2 Filtro de Jefe inmediato/Jefe de área/Director de área por Campaña (+Cargo)

Pedido del usuario: que esos 3 selectores de `AgentForm.jsx` se filtren según la Campaña y el
Cargo ya elegidos del empleado que se está registrando (antes mostraban los 34/8/4 candidatos
reales sin importar a qué campaña pertenecían, ver §27). Antes de tocar código se verificó contra
la BD real (consultas SQL directas, no supuestos) cuál es la granularidad correcta:

- **Jefe inmediato** varía por **Campaña + Cargo** del subordinado (ej. T&T + Agente call center
  → 7 candidatos reales distintos; T&T + Coordinador Call → solo 1).
- **Jefe de área** y **Director de área** varían casi siempre solo por **Campaña** — una sola
  persona cubre toda la campaña sin importar el cargo del subordinado.

**Backend** (`models/UserCompany.js::getCatalogos()`): `empleadosPorRol()` ahora trae una fila por
cada `(persona, campaña)` real en la que figura como jefe/director (y para jefe inmediato, también
el `cargo_idcargo` de esa fila) — antes era una fila por persona, sin contexto. `jefes_inmediatos`
gana `campania_id`+`cargo_id`; `jefes_area`/`directores_area` ganan solo `campania_id`.

**Frontend** (`AgentForm.jsx`): nuevos helpers `dedupePorId()`, `filtrarPorCampania()` (jefe de
área/director) y `filtrarJefesInmediatos()` (jefe inmediato, por campaña+cargo con fallback a solo
campaña si esa combinación exacta no tiene candidatos). Sin Campaña elegida, o si la combinación no
tiene ningún candidato real, cae a mostrar la lista completa sin filtrar — mismo criterio que el
filtro de Cargo por Cliente (§26): mejor no bloquear el alta que dejar el selector vacío.

**Verificado con el caso real Claro+T&T+Agente call center**: Jefe inmediato → 7 opciones (Danny
Morales, Jesus Romero, Kevin Buitrago, Laura Acero, Maria Alarcon, Nicole Corredor, Yanira
Vasquez); Jefe de área → 2 (Kevin Buitrago, Nelson Acero); Director de área → 1 (Nelson Acero) —
coincide exacto con la consulta SQL directa contra la BD real. `node -c`, `eslint` sin errores.
**No probado en el navegador** (sesión verificó solo por consulta directa + lectura de código).

### 29.3 Deploy del esquema pendiente (043-058) a producción

Producción estaba aplicada solo hasta la **042** (ver CLAUDE.md). Se armó un archivo consolidado
(`migrations/059_ultima_migracion_pendiente_produccion.sql`, **no commiteado, solo de trabajo**,
borrado del working tree al terminar) con las migraciones realmente seguras para correr tal cual:
**043-048, 050-053, 055, 056, 058** (13 de 16).

**Excluidas a propósito — 049, 054 y 057**: las tres tienen IDs quemados (`idciudad` /
`Cliente_idCliente` / `cargo_idcargo`) resueltos contra el estado de la BD LOCAL, que ya tenía los
389 empleados importados y los catálogos que ese import generó (OBAMACARE, BEEMO, 61 cargos
reales, etc.). Producción nunca había corrido ese import — sus catálogos antes de esta sesión eran
literalmente solo el seed original de las migraciones 035/036 (3 clientes: Claro/Obama/Asiste, 3
campañas, 8 cargos, 20 ciudades, confirmado leyendo esos dos archivos). Correr 049/054/057 tal cual
ahí habría fallado por FK o, peor, tocado una fila que por coincidencia tuviera el mismo ID pero
fuera otra cosa. Quedan pendientes de resembrar a mano contra los IDs reales de producción (parte
de eso ya dejó de hacer falta, ver §29.6).

**Bug real encontrado en el camino — `salario_referencia` inexistente rompía TODO RRHH, no solo
el sueldo sugerido:** `UserCompany.js::getCatalogos()` hace `SELECT ... FROM salario_referencia`
**sin try/catch propio**, y ese único endpoint (`GET /users-company/catalogos`) alimenta 6
componentes del frontend (`AgentForm`, `EmpleadoDrawer`, `NovedadForm`, `TraspasoForm`,
`RetiroModal`, `ImportEmpleadosModal`). Sin la tabla, el endpoint completo devolvía 500 y dejaba
**todo** RRHH inoperable (no solo el autocompletado de sueldo). Fix: se agregó al archivo
consolidado el `CREATE TABLE salario_referencia` **vacío** (mismo esquema que la 054, sin su
`INSERT` de 59 filas con IDs locales) — el frontend ya maneja "sin coincidencias" sin romperse
(`salarioSugerido()` retorna `null`).

**Primer intento de correr el consolidado — error 1175 (MySQL Workbench "safe update mode")**:
se detuvo justo en `DELETE FROM tipo_novedad` (bloque 053) — ajuste del cliente Workbench, no un
problema del script (el `DELETE` sin `WHERE` es intencional, reemplaza el catálogo completo, sigue
protegido por `FK RESTRICT` si hubiera `novedad_rrhh` real apuntando a un tipo viejo). Como el
usuario confirmó que la ejecución se detuvo ahí (no siguió con el resto), **043-052 ya habían
quedado aplicados completos**. Se generó `migrations/059b_continuacion_desde_053.sql` (también de
trabajo, no commiteado) retomando exactamente desde el `DELETE` que falló, con
`SET SQL_SAFE_UPDATES=0` al inicio y restaurado al final — corrió limpio en el segundo intento.

**Estado final de producción tras esta sesión**: esquema completo hasta la 058 + el `CREATE TABLE
salario_referencia` vacío. **Pendiente**: 049 (ciudades DIVIPOLA), 054 (datos reales de
`salario_referencia`) y 057 (campaña OBAMACARE-LV) — las tres necesitan regenerarse contra los
catálogos reales de producción, que después de §29.6 ya existen (cliente/campaña/cargo ya no son
solo el seed de 035/036).

### 29.4 Bloqueo real al crear el primer usuario `recursosHumanos` en producción

El usuario intentó crear `Prueba.RRH` (rol `recursosHumanos`) desde `/users` en producción — el
selector "Empleado (ficha de RRHH)" (obligatorio para este rol desde §15, vía
`ROLES_VINCULADOS_A_EMPLEADO`) salió vacío: *"No hay fichas de RRHH sin vincular"*. Esperado:
producción tenía 0 empleados en `users_company` en ese momento.

**Hallazgo de paso, no resuelto esta sesión**: `RecursosHumanosRoute` en `App.jsx` (frontend) solo
deja pasar `isRecursosHumanos` — un `admin` no puede llegar a `/recursos-humanos` en el navegador
para usar "Cargar Excel" aunque el backend sí lo permite
(`verificarRecursosHumanos` en `routes/usersCompany.js` acepta `['recursosHumanos', 'admin']`).
Inconsistencia frontend/backend real, no se corrigió — se evitó con el camino de §29.6.

### 29.5 Decisión de alcance: cargar los 389 empleados reales a producción vía `.sql`, no vía la app

El usuario pidió explícitamente un archivo `.sql` para correr "como migración", no usar el botón
"Cargar Excel" (que hubiera sido la vía más simple pero exigía resolver primero el bloqueo de
§29.4, o pasar por la API directo con un script aparte — ambas opciones se ofrecieron y se
descartaron). Se advirtió del riesgo de dejar PII de 389 personas en un archivo — el usuario lo
asumió, pidiendo que el archivo **no se commiteara**.

### 29.6 Generación del `.sql` con los 389 empleados reales — metodología y validación

Dado que copiar los datos de local tal cual **no habría funcionado** (los IDs de cliente/campaña/
cargo de local ya incluyen todo lo creado por el import real, que no existía en producción antes
de esta sesión — exactamente el mismo problema de 049/054/057 de §29.3), se generó el archivo
corriendo el **import real** contra una base de datos temporal preparada para arrancar igual que
producción, no copiando datos a mano:

1. Clonado el esquema completo (sin datos) de la BD local a una BD temporal
   (`test_import_produccion_temp`).
2. Sembrado **solo** el catálogo base de las migraciones 035/036 + 039/047/050/052/056/053/055/058
   en su estado final (el mismo que producción ya tenía tras §29.3) — leído directo de cada
   archivo de migración, no de memoria.
3. Corrido `services/importEmpleadosService.js::confirmar()` (el mismo código del botón "Cargar
   Excel", invocado directo en Node con `DB_DATABASE` apuntando a la BD temporal) contra el Excel
   real: **389 creados, 0 errores** — mismo resultado que la carga original en local (§ sección 5
   / `project-rrhh-bulk-import`).
4. Exportado el resultado a SQL **sin IDs literales**: cada referencia a catálogo (cliente,
   campaña, cargo, ciudad, banco, EPS/ARL/AFP/CESANTIAS/CAJA, etc.) y cada relación entre
   empleados (jefe inmediato/área, director de área, analista encargado) se resuelve con
   subconsultas por nombre/NIT/cédula, no por ID — así el archivo no depende de que los
   auto_increment de producción coincidan exactamente con los de la BD temporal. Los catálogos
   abiertos (los que el import puede crear si faltan: `tipo_identificacion`, `ciudad`, `cliente`,
   `campania`, `centro_costo`, `cargo`, `tipo_contrato`, `banco`, `oleada`,
   `entidad_seguridad_social`) se exportan también, solo las filas nuevas (diff contra el seed
   base de 035/036), con `INSERT IGNORE`/`WHERE NOT EXISTS` según tengan o no `UNIQUE KEY`.
5. **Validado de verdad antes de entregarlo**: corrido contra una SEGUNDA BD temporal limpia (mismo
   catálogo base, 0 empleados) — sin errores, conteos consistentes (389 empleados, 389 contratos,
   1945 afiliaciones de seguridad social, etc.) y un empleado de muestra (Kevin Vargas, cédula
   1001294395) con los mismos datos exactos del Excel. Ambas BDs temporales borradas al terminar.

Archivo final: `empleados_produccion_NO_COMMITEAR.sql` (en la raíz del repo backend, **no
commiteado** — agregado a `.gitignore` junto con el patrón `*_NO_COMMITEAR.sql` para cualquier
futuro similar). Corrido por el usuario contra producción, exitoso.

**Nota para el futuro**: con esto, los catálogos de producción (`cliente`, `campania`, `cargo`,
`centro_costo`, `oleada`, `ciudad`, `entidad_seguridad_social`) ya tienen datos reales (no solo el
seed de 035/036) — las migraciones 049/054/057 pendientes (§29.3) se pueden regenerar ahora contra
esos IDs reales si se necesita avanzar con ellas.

### 29.7 Bug encontrado en producción: `nombre_propio` NULL rompía la pestaña "Equipo" de Asistencia

El usuario creó un usuario de prueba `director_operaciones` vinculado a Kevin Buitrago (mismo
empleado que en local) y, al entrar a la pestaña "Equipo" de Asistencia, la pantalla se rompía:
`TypeError: Cannot read properties of null (reading 'localeCompare')`.

**Causa — bug del generador del §29.6, no del código de la app**: el `INSERT INTO users_company`
armado a mano en el script de exportación **omitió la columna `nombre_propio`** — ese campo
normalmente lo calcula el backend solo (`nombrePropio()` en `models/UserCompany.js`, llamado desde
`camposPersonales()` dentro de `create()`/`update()`), pero como el script generador insertaba
directo por SQL sin pasar por ese código, la columna (nullable) quedó `NULL` para los 389. Local
nunca tuvo este problema porque ahí los empleados se cargaron por la ruta real de la app.

`services/asistencia/equipoService.js::equipo()` expone `nombre: empleado.nombre_propio` tal cual,
y `EquipoAsistencia.jsx` (frontend) lo usaba sin verificar null en dos sitios: el filtro de
búsqueda (`e.nombre.toLowerCase()`) y el `.sort()` (`a.nombre.localeCompare(b.nombre)`) — este
último es el que tumbaba toda la pantalla (useMemo que no captura el error).

**Fix de datos (producción, ya corrido por el usuario)**:
```sql
UPDATE users_company
SET nombre_propio = TRIM(CONCAT_WS(' ', primer_nombre, segundo_nombre, primer_apellido, segundo_apellido))
WHERE nombre_propio IS NULL OR nombre_propio = '';
```
Misma fórmula exacta que `nombrePropio()` en el backend. Tuvo que correrse con
`SET SQL_SAFE_UPDATES=0` (mismo ajuste de Workbench que en §29.3, no un problema real).

**Fix de código (defensivo, ya commiteado y pusheado — commit frontend `ab8a39d` "ajuste error")**:
`EquipoAsistencia.jsx` — los dos puntos sin guarda ahora usan `(e.nombre || '')`, para que un
nombre nulo por cualquier otro camino futuro no vuelva a tumbar la pantalla completa, solo ordene/
filtre como texto vacío. `eslint` sin errores.

**Alcance verificado**: grep confirmó que `EquipoAsistencia.jsx` es el único componente de
Asistencia que usa `.localeCompare` sobre un nombre de empleado sin guarda — el resto de consumos
de `nombre`/`nombre_propio` en ese módulo (helpers `nombrePropio()`/`iniciales()` de
`utils/formatoRRHH.js`) ya manejaban `null`/falsy de antes.

### 29.8 Pendiente

- **Confirmar** que el `UPDATE` de `nombre_propio` (§29.7) corrió exitosamente en producción y que
  la pestaña "Equipo" ya carga bien con Kevin Buitrago.
- Migraciones **049** (ciudades DIVIPOLA), **054** (datos reales de `salario_referencia`) y **057**
  (campaña OBAMACARE-LV) — regenerar contra los IDs reales de producción (ya hay catálogo real
  para apoyarse, ver nota de §29.6) si se quiere avanzar con ellas.
- Inconsistencia `RecursosHumanosRoute` (frontend) vs `verificarRecursosHumanos` (backend) sobre si
  `admin` puede entrar a `/recursos-humanos` (§29.4) — detectada, no corregida.
- `.gitignore` (backend) tiene el patrón `*_NO_COMMITEAR.sql` agregado pero **sin commitear
  todavía** — junto con `migrations/026_add_directivo_financiero_role.sql` (fix de otra sesión, ver
  conversación del commit `6d2b858`), quedan sueltos en el working tree del backend.
- Deploy de código a producción (backend `git pull` + `pm2 restart`; frontend `git pull` + 
  `npm install` + `npm run build` + reload nginx) — commits backend (`6d2b858`, sin push) y
  frontend (`69f39ab`/`ab8a39d`, ya pusheados) listos, pendiente confirmar que el deploy en el
  servidor ya recogió todo esto (el usuario ya estaba operando producción en vivo durante esta
  sesión, así que probablemente sí, pero no se verificó explícitamente).

## 30. Contratación desde Hydra (2026-10-01)

Los candidatos aprobados en Hydra (la app de selección) llegan a RRHH por API y se registran como
empleados desde **RRHH → "Contratación Hydra"** (`/recursos-humanos/contratacion-hydra`):
- Los candidatos esperan en tablas de staging (`hydra_*`, migraciones 059-061) y **no** tocan
  `users_company` hasta el registro.
- RRHH completa y marca con ☑ cada una de las 7 secciones de cada candidato.
- El lote se registra todo o nada, con `UserCompany.crearEnConexion`.
- Gestor avisa a Hydra para que el candidato pase a `contratado`.

Todo vive en [`conexionhydra.md`](../conexionhydra.md): el plan, el contrato de la API, las notas
de implementación (§13) y la guía de despliegue (§14).

Los diagramas están en [`docs/diagramas/conexion-hydra/`](../docs/diagramas/conexion-hydra/README.md):
- arquitectura;
- secuencia del envío de un lote;
- secuencia del registro y aviso;
- estados del candidato;
- flujo de datos.

**Estado**: implementado y probado en local. Sin desplegar a producción.

> **Actualización 2026-10-11:** Hydra quedó en producción. En Gestor se hizo pull del código y se
> configuró el `.env`. Las migraciones 059-061 se entregaron como `migrations/ultimos_cambios.sql`;
> falta confirmar que se corrieron. Ver `claude/contextoriginal.md` §12.1.

## 31. Sesión 2026-10-11 — Cuenta de empleado automática al registrar a alguien en RRHH

Desde la migración 063, **registrar un empleado le crea su usuario para ver su asistencia**:
- El usuario y la contraseña inicial son la cédula, con cambio obligatorio en el primer ingreso.
- Aplica a los tres caminos de alta:
  - el formulario manual;
  - el import por Excel;
  - el registro de un lote de Hydra.
- La crea `User.crearCuentaEmpleadoEnConexion`, llamada al final de `UserCompany.crearEnConexion`
  dentro de la misma transacción.
- **Nunca hace fallar el alta.** Si la cédula ya es el usuario de otra cuenta, o si la ficha ya tiene
  una cuenta vinculada, no la crea y sigue.

Efectos sobre lo que hace RRHH:
- **Retiro** (§16): si el contrato más reciente de la ficha queda `retirado` o `inactivo`, su cuenta
  vinculada no puede entrar. Al **reactivar**, vuelve a entrar sin hacer nada más.
- **Corregir la cédula** de una ficha no cambia el usuario de la cuenta, que sigue siendo la cédula
  vieja. Pendiente.
- **Las cuentas de RRHH** siguen vinculadas a su ficha, porque ese vínculo las registra como
  *analista encargado* en el alta. Por eso no reciben cuenta aparte; en cambio, `RecursosHumanosLayout`
  ganó la entrada **"Mi asistencia"**, que abre `/asistencia` con el layout de asistencia y un enlace
  de vuelta a RRHH.
- **Las fichas que ya existían** reciben su cuenta con `node scripts/crearCuentasEmpleados.js`. Por
  defecto solo simula; con `--aplicar`, la crea.

Detalle en `asistencia.md` §19. Estado: probado en local, sin commitear ni desplegar.

## 32. Sesión 2026-10-21 — Jefatura sugerida por Campaña + Cargo al registrar un empleado

Pedido: que al registrar un empleado nuevo los campos "Jefe inmediato", "Jefe de área" y
"Director de área" se filtren y se sugieran según la Campaña y el Cargo, con la cadena de mando
real (ej. HOGAR + Agente call center, como Samuel Abaunza: Julian Castro → Mayra Barbosa →
Andres Nuncira).

**Hallazgo en los datos reales** (corrige lo dicho en §29.2): los tres roles cambian por **cargo**
dentro de una campaña, no solo el jefe inmediato. Ej. T&T: Agente call center → jefe de área
Kevin Buitrago; Coordinador call → Nelson Acero. Además la cadena es casi siempre consistente: de
34 jefes inmediatos, solo 4 tienen más de un jefe de área en la misma campaña, y por pocos casos.

**Backend** (`UserCompany.js::getCatalogos()`):
- `jefes_area` y `directores_area` traen ahora también `cargo_id` (antes solo `jefes_inmediatos`).
- Catálogo nuevo `cadenas_jefatura`: `{campania_id, cargo_id, jefe_inmediato_id, jefe_area_id,
  director_area_id, total}`, agrupado por cadena y solo con contratos que no estén `retirado` ni
  `inactivo`.

**Frontend** — lógica en `src/utils/catalogosRRHH.js`, que ahora usan los dos formularios
(`AgentForm.jsx` y Contratación Hydra, `seccionesUI.js`):
- `jefesCandidatos()` reemplaza a `jefesInmediatos()`/`jefesPorCampania()` y los filtros locales de
  `AgentForm`: los tres selectores filtran por Campaña + Cargo → si no hay, por Campaña → si no hay,
  la lista completa.
- `sugerirJefatura()`: el jefe inmediato se sugiere solo si la combinación tiene uno solo (HOGAR +
  Agente tiene 5 equipos, ahí no se adivina). El jefe de área y el director salen del equipo del
  jefe inmediato (elegido o sugerido) o, sin él, de la cadena más común.
- `aplicarSugerenciaJefatura()`: solo llena campos vacíos o que todavía tienen la sugerencia
  anterior; **nunca pisa lo elegido a mano**. Al editar un empleado no se sugiere nada.
- `AgentForm` marca con la etiqueta "Sugerido" los campos que se llenaron solos. En Hydra, la
  sugerencia corre al cambiar Cliente/Campaña/Cargo/Jefe inmediato y al abrir la sección (solo
  llena jefes vacíos); `_jefatura_sugerida` es una clave de interfaz, no se envía.

**Verificado** con el catálogo real servido por el backend local (no por el navegador):
- HOGAR + Agente call center → candidatos JI: los 5 coordinadores reales (incluido Julian Castro);
  sugiere JA Mayra Barbosa y DIR Andres Nuncira.
- T&T + Coordinador call (como Laura Acero) → sugiere los tres: Kevin Buitrago / Nelson Acero /
  Nelson Acero.
- LEGALIZACION Y CALIDAD + Analista de calidad (como Nury Aldana) → JA y DIR Andres Nuncira.
- OPERACIÓN + Director de operaciones (como Nelson Acero) → sin cadena real (es la cima): no sugiere
  nada y muestra la lista completa.
- Cambiar campaña/cargo reemplaza lo sugerido y conserva lo elegido a mano.

`eslint` sin errores en los 3 archivos frontend; `node -c` en el modelo.

### 32.1 Prueba con un empleado temporal por cada Campaña + Cargo (misma sesión)

Para cada una de las 70 combinaciones reales Campaña + Cargo se creó un empleado temporal por la
API (`POST /users-company`, cédulas `7770000001`-`7770000070`, como `sharon.pardo`), con los jefes
que deja el formulario: el flujo de `AgentForm` simulado con las funciones reales de
`catalogosRRHH.js`; donde hay varios jefes inmediatos, se eligió a mano el del equipo más grande.
Lo guardado se comparó contra lo esperado calculado directo de los contratos en la BD, y después
se borró todo (conteos `users_company`/`contrato`/`cuenta_empleado` iguales a los de antes: 398/398/391).

**Primera corrida: 63/70.** Las 7 que fallaron eran cargos de la cima de su campaña (Director
financiero, Director de tecnología, Jefe de mantenimiento, etc.), que en la realidad no tienen
jefes: la sugerencia caía a nivel de campaña y le proponía al Director financiero como jefe
inmediato a alguien de su propio equipo. **Corregido:**
- `sugerirJefatura()` solo sugiere con la combinación Campaña + Cargo exacta (sin cargo o sin
  historia, no sugiere). Los selectores sí siguen cayendo a la campaña para no quedar vacíos.
- `cadenas_jefatura` incluye ahora también las cadenas vacías: "cargo sin jefes" deja de
  confundirse con "combinación sin historia".

**Segunda corrida: 70/70.**

**Bug encontrado de paso y corregido:** `DELETE /users-company/:id` respondía 500 para cualquier
empleado con cuenta por cédula (o sea, todos desde la 063): `fk_cuenta_empleado_ficha`
(migración 065) no tiene `ON DELETE` y `UserCompany.delete()` solo borraba `contrato` y
`users_company`. Falló en los 70 empleados de la primera prueba (se limpiaron borrando antes su
`cuenta_empleado` a mano). Mismo problema latente con `fk_horario_plantilla_dueno` (066): no se
podía borrar a un jefe dueño de una plantilla de horario.

Fix, sin migración, en `UserCompany.delete()` y dentro de la misma transacción:
- borra la `cuenta_empleado` de la ficha (lo que esa cuenta registró en asistencia queda, con su
  autor en NULL por los `SET NULL` de la 065);
- deja sin dueño (`dueno_users_company_id = NULL`) las plantillas del jefe en vez de borrarlas, para
  no tocar los horarios ya asignados con ellas (la 066 ya contempla plantillas sin dueño).

Verificado: corrida completa con borrado 100 % por la API (0 fallos, conteos iguales), y un caso
aparte de un empleado con cuenta por cédula y plantilla propia → 200, ficha y cuenta borradas,
plantilla conservada sin dueño. El resto de FKs hacia `users_company` ya eran `CASCADE`/`SET NULL`;
las de `contrato` (novedades, traspasos, vacaciones, retiro, historial salarial) son `CASCADE`.

## 33. Sesión 2026-10-21 — EPS, AFP, cesantías, cajas y ARL: solo la lista oficial en el alta

Fuente: hoja **"EPS AFP CESANTIAS"** de `Descargas/Criterios (1).xlsx` (idéntico a `Criterios.xlsx`):
19 EPS, 6 fondos de pensiones, 4 fondos de cesantías, 2 cajas de compensación y 1 ARL. Son las
únicas opciones que deben salir en los selectores al registrar un empleado nuevo.

**Migración `068_entidades_seguridad_social_vigentes.sql`** (aplicada en local, **pendiente en
producción**). No borra nada, porque hay empleados afiliados a entidades fuera de la lista
(Positiva, Colmena, Cafam, Compensar caja, ANAS WAYUU EPSI, y duplicados como "SURA",
"Compensar EPS", "FNA AHORRO"):
- columna nueva `entidad_seguridad_social.vigente`;
- renombra al nombre exacto del Excel las entidades que ya existían con otro nombre (ej. "Porvenir"
  → "PORVENIR S.A. AFPC", "Sanitas" → "SANITAS EPS", "Famisanar" → "FAMISANAR EPS CAFAM -
  COLSUBSIDIO"); son la misma entidad, así que los afiliados no cambian;
- inserta las 8 que faltaban (ASMET SALUD, ASOCIACION INDIGENA DEL CAUCA, CAJACOPI, COOMEVA,
  DUSAKAWI, EMSSANAR, FNA como pensión, COMFAMILIAR ATLANTICO);
- deja `vigente = 1` solo las de la hoja.
Va todo por (tipo, nombre), nunca por ID (los IDs de producción no coinciden con los de local,
§29.6), con `COLLATE` explícito contra la tabla temporal (error 1267, CLAUDE.md), y es idempotente.
"SKANDIA. AFPC" se dejó tal cual viene en el Excel (con el punto).

**Código:**
- `UserCompany.getCatalogos()` devuelve `vigente` en las entidades (siguen viniendo todas: la ficha
  y el drawer necesitan el nombre de una entidad no vigente).
- `entidadesVigentes()` en `src/utils/catalogosRRHH.js`: los 5 selectores de `AgentForm` y de
  Contratación Hydra ofrecen solo las vigentes, más la ya guardada del empleado si no lo es.
- Hydra: `catalogoRepository` resuelve EPS/AFP solo contra las vigentes (así "SURA" deja de ser
  ambiguo con "EPS SURA") y `resolverCatalogo` ignora "S.A." y "AFPC" en AFP, para que "Porvenir"
  siga encontrando "PORVENIR S.A. AFPC".
- Import masivo: `SINONIMOS_ENTIDAD_SS` ahora se busca por nombre normalizado y mapea los nombres
  viejos y los duplicados a la entidad oficial; una entidad que no esté en la lista se crea con
  `vigente = 0` (se guarda la afiliación, pero no aparece en los selectores).

**Verificado** (backend local, no en el navegador):
- Migración corrida dos veces: 19/6/4/2/1 vigentes, 0 de las 1987 afiliaciones cambiaron de
  entidad, 8 entidades insertadas.
- Los 5 selectores de un empleado nuevo coinciden exactamente con las columnas del Excel.
- Un empleado con ARL Positiva (no vigente) la sigue viendo al editar: el selector ofrece "ARL SURA" y "Positiva".
- Hydra resuelve "Porvenir", "PROTECCION", "Sanitas", "SURA", "Coomeva", etc. a la entidad oficial.
- Alta real con ASMET SALUD / FNA / COMFAMILIAR ATLANTICO guardada y borrada.
- Previsualización del import con `DATOS (1) (1).xlsx` (389 filas): 0 entidades nuevas.
- `npm test` 132/132, `eslint` sin errores.

**Para producción:** correr `068` antes o junto con el deploy del código. Si el frontend nuevo sale
sin la `068`, los selectores muestran todo como antes (sin `vigente` no se filtra); si el backend
nuevo sale sin la `068`, la consulta de Hydra a EPS/AFP falla por la columna inexistente.

**Ajuste posterior (mismo día, a pedido):** la `068` ahora también
- renombra "SKANDIA. AFPC" (así venía en la hoja) a **"SKANDIA S.A. AFPC"**, como las demás AFP;
- **unifica los 3 duplicados** (misma entidad con otro nombre) en la oficial: EPS "SURA" → "EPS SURA
  (ANTES SUSALUD)", EPS "Compensar EPS" → "COMPENSAR", cesantías "FNA AHORRO" → "FONDO NACIONAL DEL
  AHORRO". Pasa sus afiliaciones (`entidad_seguridad_social_id` y `entidad_anterior_id`) a la oficial
  y borra el duplicado si quedó sin referencias (paso 4b).
- No se tocan las entidades **distintas** fuera de la hoja (Positiva, Colmena, Cafam, Compensar caja,
  Anas Wayuu…): siguen con `vigente = 0`.
- Verificado en local (corrida dos veces): 1987 afiliaciones antes y después, 12 movidas (1 + 2 + 9),
  42 → 39 entidades; vigentes EPS 19/1, AFP 6/0, CESANTIAS 4/0, CAJA 2/3, ARL 1/3. El importador
  (`SINONIMOS_ENTIDAD_SS`) y el resolver de Hydra llevan "Skandia"/"SKANDIA. AFPC" a la oficial.

## 34. Sesión 2026-10-21 — Novedades: soportes documentales por tipo (PDF o imagen) y empleado buscable

**Pedido:** la hoja "Novedades" de `Criterios (1).xlsx` define los 15 tipos de novedad y, por cada
uno, qué soportes aplican ("SI"/"NO"). Al registrar una novedad solo deben pedirse los que aplican,
cada uno cargado como PDF o imagen. Además, el campo "Empleado" deja de ser un `<select>`: se
escribe el nombre o la cédula.

**Migración `069_novedades_soportes_documentales.sql`** (por nombre, idempotente, COLLATE explícito):
- `tipo_novedad.vigente`. Entran las 4 variantes por días: "Incapacidades origen comun 1- 2 días" /
  "3 días o mas" y "Incapacidades accidente de transito 1- 2 días" / "3 días o mas". Las 2 genéricas
  de la 053 quedan `vigente = 0` (no se borran: en producción puede haber novedades que las usan) y
  conservan como soportes la unión de sus variantes.
- `tipo_soporte_novedad`: los 10 soportes (columnas de la hoja), con `orden`.
- `tipo_novedad_soporte`: la matriz SI/NO (39 filas para los 15 vigentes + 5 de las genéricas).
- `novedad_rrhh_soporte`: un archivo por (novedad, soporte), `ON DELETE CASCADE` desde la novedad.
- Las columnas `tiene_*` de la 039 (6 checkboxes) siguen en la tabla, pero el formulario ya no
  las muestra (se conservan al editar).

**Archivos — privados.** Son certificados de incapacidad, historias clínicas, registros civiles:
NO van en `uploads/` (que `/api/files` sirve **sin login**) sino en `storage/novedades/` (en
`.gitignore`, se crea solo al arrancar). Nombre en disco generado por el servidor; el original
solo en BD. Se descargan únicamente por la API con sesión de RRHH/admin.
`middleware/uploadSoportesRrhh.js` (antes `uploadSoportesNovedad.js`; desde §35 lo comparten novedades y traspasos): PDF, JPG, PNG, WEBP (mime **y** extensión deben coincidir),
máx. 10 MB, errores → 400 con mensaje claro.

**Endpoints** (`verificarRecursosHumanos`):
- `GET    /api/users-company/novedades/:id/soportes` — los que aplican al tipo (`aplica = 1`, con
  archivo si lo hay) + los cargados que ya no aplican si se cambió el tipo (`aplica = 0`).
- `POST   /api/users-company/novedades/:id/soportes/:tipoSoporteId` — campo `archivo`; reemplaza
  el anterior (y lo borra del disco). 400 si el soporte no aplica al tipo de la novedad.
- `GET    /api/users-company/novedades/:id/soportes/:tipoSoporteId/archivo` — descarga (`inline`).
- `DELETE /api/users-company/novedades/:id/soportes/:tipoSoporteId`.
- Borrar la novedad borra también sus archivos del disco.
- `GET /catalogos`: `tipos_novedad` ahora trae `vigente` y `soportes` (ids), y hay
  `tipos_soporte_novedad`. El listado de novedades trae `soportes_requeridos`/`soportes_cargados`.

**Frontend:**
- `NovedadForm.jsx`: empleado con `ComboboxBuscable` (texto "Nombre — cédula", así se busca por
  cualquiera de los dos; deshabilitado al editar). El selector de tipo solo ofrece los vigentes (+ el
  ya guardado). La sección "Soportes documentales" muestra solo los que aplican al tipo elegido, con
  Cargar / Ver / Reemplazar / Eliminar. Los archivos se suben **después** de guardar la novedad
  (necesitan su id); si alguno falla, el modal queda abierto con el error y un segundo "Guardar"
  actualiza la misma novedad.
- **No se bloquea guardar sin soportes**: suelen llegar después (para eso está `fecha_recibido`).
- `NovedadesRRHH.jsx`: el contador pasa de "x/6" a "cargados/requeridos" (verde completo, ámbar
  parcial) y el detalle lista los soportes que aplican; los cargados se abren con un clic.
- `src/utils/soportesNovedad.js` (validación en el navegador y apertura con token vía blob) y
  `ComboboxBuscable` ganó `disabled` y `unidad` (el pie decía siempre "ciudades").

**Verificado** (backend local, no en el navegador):
- Migración corrida dos veces sin cambios; los 15 tipos vigentes y las 39 celdas "SI" coinciden
  exactamente con la hoja (comparación por script, 0 faltan, 0 sobran).
- Prueba de punta a punta por la API (26/26): PDF y PNG → 201; TXT, `.pdf` con mime de texto,
  `.exe` con mime PDF y PDF de 11 MB → 400; soporte que no aplica → 400; sin token → 401 (subida y
  descarga); el archivo no se sirve por `/api/files`; descarga devuelve los mismos bytes; reemplazo
  borra el archivo viejo; cambio de tipo deja los cargados como `aplica = 0` y el listado en 0/3;
  borrar la novedad deja el disco limpio.
- `npm test` 132/132, `eslint` del frontend sin errores, `vite build` ok.

**Para producción:** correr `069` antes o junto con el deploy del backend (sin ella, `/catalogos` y
el listado de novedades fallan por las tablas inexistentes). El proceso de pm2 necesita permiso de
escritura en `/root/gestor-tecnico-backend/storage/novedades/`, y ese directorio entra en los
respaldos del servidor (no está en git).


## 35. Sesión 2026-10-21 — Traspasos por tipo: campos, documentos y alertas (hoja "TRASPASOS")

**Pedido:** la hoja "TRASPASOS" de `Criterios (1).xlsx` define el flujo: 6 tipos de traspaso, qué
documentos aplican a cada uno ("SI"/"NO"), qué "información nueva" se llena en cada tipo y dos alertas.

| Tipo | Documento que aplica | Información nueva | Alerta |
|---|---|---|---|
| Encargo | — | cargo nuevo, BNP nuevo, fecha inicio, **fecha fin**, destino* | — |
| Ratificación | Formato de evaluación | cargo nuevo, salario nuevo, fecha inicio, destino* | al director: evaluación de desempeño del encargo |
| No ratificación | Formato de evaluación | ídem | ídem |
| Trabajo en casa | Formato de trabajo en casa | modalidad nueva, fechas inicio/fin de trabajo en casa, diadema, equipo de cómputo | 7 días antes del retorno |
| Cambio de cargo | Otro sí al contrato | cargo nuevo, salario nuevo, fecha inicio, destino* | — |
| Cambio de salario | Otro sí al contrato | cargo, salario nuevo, fecha inicio, destino* | — |

\*destino = área, campaña, centro de costo, cargo SuccessFactors, usuario SSFF, jefe de área, jefe
inmediato y modalidad. "Información actual" es igual para todos: tipo de contrato, ciudad donde labora,
fecha de ingreso, área, campaña, centro de costo, cargo SF y usuario SSFF anteriores, cargo, salario,
BNP, jefe de área, jefe inmediato y modalidad.

**Migración `070_traspasos_por_tipo.sql`** (por código, idempotente):
- `tipo_traspaso` (con `codigo`: ENCARGO, RATIFICACION, NO_RATIFICACION, TRABAJO_CASA, CAMBIO_CARGO,
  CAMBIO_SALARIO) y `traspaso.tipo_traspaso_id`.
- Campos que faltaban en `traspaso` para la información actual: `tipo_contrato_anterior_id`,
  `ciudad_anterior_id`, `fecha_ingreso_anterior`, `modalidad_anterior_id` (la `modalidad_idmodalidad`
  que ya existía es la nueva).
- `tipo_soporte_traspaso` (3) + `tipo_traspaso_soporte` (matriz) + `traspaso_soporte` (archivos en
  `storage/traspasos/`, privados igual que los de novedades, §34).
- `alerta_traspaso`: destinatario por ficha (`users_company`), `fecha_alerta` (Bogotá), `leida_en`,
  `resuelta_en`.

**Reglas** — `utils/camposTraspaso.js` (backend, con pruebas en `tests/rrhh/camposTraspaso.test.js`)
y su copia `src/utils/traspasos.js` (frontend; si cambia una, cambiar la otra):
- El backend exige el tipo y los obligatorios de cada tipo, y deja en NULL la información nueva que
  no aplica al tipo (p. ej. salario nuevo en un encargo).
- Trabajo en casa no tiene "fecha inicio" propia: `fecha_inicio`/`fecha_fin` = las del trabajo en casa.
- `ratificacion` sale del tipo (1 solo en Ratificación); ya no es un checkbox.
- No están en la hoja y se ocultan, pero se conservan al editar: `estado` y bono de cafetería.

**Alertas** (`models/Traspaso.js → sincronizarAlertas`, en la misma transacción del guardado):
- Ratificación / no ratificación: al guardar se crea una alerta para el **director de área** del
  contrato del empleado (si no tiene, el **jefe de área**). Sigue activa hasta que se carga el formato
  de evaluación (se resuelve sola; si se borra el formato, se reabre). RRHH puede "Reenviar
  recordatorio" (la vuelve a dejar sin leer).
- Trabajo en casa: una alerta para el **jefe inmediato** (el nuevo si se indicó, si no el actual)
  programada 7 días antes de `fecha_fin_trabajo_casa`; se reprograma si cambia la fecha y deja de
  mostrarse cuando pasa la fecha de retorno.
- Si el traspaso cambia de tipo, sus alertas pendientes que ya no corresponden se borran.
- **Dónde se ven:** el destinatario, en la **campana del portal de asistencia**
  (`CampanaAlertas.jsx`; `GET /api/asistencia/mis-alertas`, `POST /mis-alertas/:id/leida`, en capas:
  `alertaTraspasoRepository` → `alertaService` → `alertaController`), entre con su cédula o con su
  usuario. RRHH, en el panel "Alertas" de la pantalla Traspasos (`GET /users-company/traspasos/alertas`,
  con estado programada / enviada / leída). **No hay correo:** el backend no tiene SMTP configurado.
- La campana antes tenía un punto fijo decorativo; ahora el punto (`.ai-bell--con-alertas`) solo sale
  con alertas sin leer. La campana de `RecursosHumanosLayout` sigue sin función y ya no muestra punto.

**Endpoints nuevos** (RRHH): `GET /traspasos/alertas`, `POST /traspasos/:id/alertas/evaluacion`,
`GET|POST|DELETE /traspasos/:id/soportes[/:tipoSoporteId]`, `GET .../:tipoSoporteId/archivo`.
`/catalogos` trae `tipos_traspaso` (con `codigo` y `soportes`) y `tipos_soporte_traspaso`.

**Frontend:** `TraspasoForm.jsx` reescrito — empleado buscable por nombre o cédula, tipo de traspaso,
"Información actual" precargada del contrato, "Información nueva" solo con los campos del tipo
(jefes filtrados por campaña + cargo nuevos, como en el alta), aviso de a quién y cuándo llega la
alerta y la sección "Documentos". `Traspasos.jsx`: columna Tipo, contador de documentos, detalle con
la información actual y los documentos, y panel de alertas. La sección de soportes de novedades y
traspasos es un solo componente (`SoportesDocumentales.jsx`, con `SoportesResumen` para el detalle
de las tablas) y `src/utils/soportesRrhh.js` reemplaza a `soportesNovedad.js`.

**No hace (a propósito):** guardar un traspaso **no modifica el contrato** del empleado (cargo,
salario, campaña, jefes siguen igual en su ficha); es un registro. El traspaso existente sin tipo
(anterior a la 070) se lista como "Sin tipo" y al editarlo pide elegir uno.

**Verificado** (backend local, no en el navegador; el backend de desarrollo estaba apagado, así que la
prueba monta las rutas en un Express dentro del propio script):
- Migración corrida dos veces sin cambios; matriz igual a la hoja.
- Prueba de punta a punta (45/45): validación por tipo; NULL de lo que no aplica; alerta de
  ratificación al jefe de área (cuenta por cédula), invisible e intocable para otro empleado (404),
  leída/reenviada/resuelta al cargar el formato/reabierta al borrarlo; alerta de trabajo en casa
  programada 7 días antes, reprogramada al cambiar la fecha y borrada al cambiar de tipo; documentos
  (PDF/imagen sí, TXT no, documento que no aplica → 400, descarga con token y sin token 401); borrado
  en cascada y disco limpio; los soportes de novedades siguen funcionando.
- `npm test` 139/139, `eslint` sin errores nuevos, `vite build` ok.

**Para producción:** correr `070` (después de 068 y 069) junto con el deploy. El proceso de pm2 necesita
escribir en `storage/traspasos/` además de `storage/novedades/`.

## 36. Sesión 2026-10-23 — Botón "Traspasar" del drawer conectado al módulo de Traspasos

Cierra el pendiente de §16.1: el botón "Traspasar" de `EmpleadoDrawer.jsx` estaba deshabilitado
("Próximamente"). Ahora abre `TraspasoForm` con ese empleado ya elegido, sin salir de la pantalla de
Empleados. Solo frontend, sin cambios de backend ni migración.

- `EmpleadoDrawer.jsx`: prop nueva `onTraspaso(id)`. El botón se habilita solo si el empleado tiene
  contrato y no está `retirado`/`inactivo` (si no, lo explica en el `title`).
- `AgentManagement.jsx`: estado `traspasoEmpleadoId`; cierra el drawer y monta `TraspasoForm`
  (mismo patrón que `RetiroModal`). Al guardar solo cierra: un traspaso no cambia el contrato (§35),
  así que no hay que recargar la tabla.
- `TraspasoForm.jsx`: prop nueva `empleadoInicialId`. Al abrir un traspaso nuevo con ella, precarga
  la "Información actual" con el mismo `onSelectEmpleado` del selector y bloquea el campo Empleado.
  Desde la pantalla Traspasos se sigue usando igual (sin la prop).

Verificado: `eslint` sin errores nuevos (queda el falso positivo de `Icon` de §11.1), `vite build` ok.
**No probado en el navegador.**

## 37. Sesión 2026-10-23 — KPI "Gasto mensual en personal" solo para financiera/admin

Pedido: `recursosHumanos` solo ve información de contratación, nada de costos de salarios. El KPI
"Gasto mensual en personal" de la pantalla Empleados queda para `financiera` y `admin`.
- Backend: `GET /users-company/gasto-total` pasa de `verificarRecursosHumanos` a un middleware nuevo
  `verificarFinanciera` (`financiera`, `admin`) en `routes/usersCompany.js` → 403 para RRHH.
- Frontend: `AgentManagement.jsx` calcula `puedeVerGasto` (`isFinanciera || isAdmin`); sin él no
  pide el endpoint, no pinta el KPI y la franja de KPIs pasa a 3 columnas.
- **Solo el KPI.** Los salarios siguen visibles para RRHH en el formulario de alta (`AgentForm`),
  el drawer, Traspasos y Contratación Hydra.

## 38. Sesión 2026-10-26 — Prueba en el navegador del alta completa, Tarifa ARL al editar y `tipo_contrato` duplicado

**Prueba:** con la cuenta `sharon.pardo` se registró desde `/recursos-humanos` un empleado con **todos**
los campos de los dos pasos de `AgentForm` ("Prueba Navegador Completo Claude", CC `7770000999`,
`users_company.id` 669; Claro + HOGAR + Agente call center, contrato Fijo). `POST /users-company` →
201, sin errores de consola. Verificado:
- automatismos: Cargo filtrado por Cliente (16 de Claro), salario sugerido 1.750.905 y bloqueado, fin
  de periodo de prueba a +2 meses, "Fin de contrato" visible por ser Fijo, jefatura sugerida (jefe de
  área y director con etiqueta "Sugerido"), analista encargado tomado del login;
- el drawer de perfil muestra cada campo con el valor capturado;
- `cuenta_empleado` creada (usuario = cédula, `debe_cambiar_password = 1`);
- al editar, el formulario precarga todos los valores (salvo la tarifa ARL, ver abajo).
El empleado de prueba **quedó en la BD local** para revisión.

**Bug corregido — Tarifa ARL vacía al editar** (`AgentForm.jsx`): se guardaba bien, pero la BD
devuelve el DECIMAL con todos sus ceros (`"0.52200"`) y el `id` de la opción es `"0.522"`, así que el
selector quedaba en "Sin especificar". Nuevo helper `tarifaArlDelSelector()` que, al cargar el
empleado, busca la opción por valor numérico (si no coincide con ninguna clase, conserva el valor tal
cual). Verificado en el navegador: ahora precarga "Clase I".

**`tipo_contrato` duplicado — migración `081_tipo_contrato_sin_duplicados.sql`** (aplicada en local,
**pendiente en producción**, sin dependencias). El selector "Tipo de contrato" mostraba cada opción dos
veces: la tabla (034) no tiene UNIQUE en `nombre` y el seed de la 035 se corrió dos veces (IDs 1-5 y
6-10; los 389 del import masivo usaban el 6). La migración, por nombre y nunca por ID fijo:
- deja por cada nombre la fila de menor ID y le pasa todo lo que apuntaba a una repetida:
  `contrato.tipo_contrato_idtipo_contrato`, `traspaso.tipo_contrato_anterior_id` (070, sin FK) y
  `hydra_candidato.datos_empleado → $.contrato.tipo_contrato_id` (JSON del staging de Hydra; puede
  venir como número, texto, vacío o null de JSON — solo se reasigna si son dígitos);
- borra las repetidas y agrega `UNIQUE KEY uq_tipo_contrato_nombre (nombre)`;
- es idempotente; si producción no tiene duplicados, solo agrega el UNIQUE.

Verificado: en una BD temporal con casos sintéticos (contratos, traspasos y candidatos de Hydra
apuntando a repetidas, un nombre con espacios, JSON con id texto/null/vacío) los resultados coinciden
con lo esperado, la segunda corrida no cambia nada y el UNIQUE rechaza un duplicado nuevo. En local:
10 → 5 tipos, los 399 contratos conservan el mismo tipo **por nombre** antes y después, y el selector
del alta muestra 5 opciones. `npm test` 221/221, `eslint` sin errores en `AgentForm.jsx`.

**Antes de correrla en producción**, ver si allá hay duplicados:
`SELECT nombre, COUNT(*) FROM tipo_contrato GROUP BY nombre HAVING COUNT(*) > 1;`

**Visto y no tocado:** el catálogo de ciudades tiene "Bogotá" y "BOGOTÁ D.C" como opciones separadas
en los buscadores de ciudad (ver §12.4).

## 39. Sesión 2026-10-26 — Prueba de punta a punta del módulo y fallas corregidas

Se probó todo el módulo contra el backend y la BD local con un script de 107 verificaciones por API
(no commiteado: permisos, validaciones del alta, alta y lectura de la ficha, edición, novedades con
soportes, los 6 tipos de traspaso con alertas y documentos, pasivo vacacional, retiro/reactivación,
previsualización del Excel y borrado). Los empleados de prueba usaron cédulas `777000099x` y se
borraron al final. También se probó en el navegador: Contratación Hydra, Novedades (con soporte),
Traspasos (Ratificación → alerta al director de área) y Pasivo vacacional, sin errores de consola.
La primera corrida dio 88/107; tras las correcciones queda en **105/107**, y las 2 fallas restantes
son reglas de negocio sin definir (abajo). `npm test`: 221/221.

**Fallas corregidas (backend, todas en el patrón de dos capas):**

| Falla | Corrección |
|---|---|
| Borrar un empleado dejaba huérfanos en disco los archivos de sus novedades y traspasos (las filas caen por CASCADE, los archivos no) | `NovedadRrhh.archivosDeEmpleado` / `Traspaso.archivosDeEmpleado`: el controller los lee antes del `DELETE` y los borra del disco después |
| ID de catálogo inexistente (campaña, cargo, EPS…) en alta/edición de empleado, novedad o vacaciones → **500** | Violación de FK (`ER_NO_REFERENCED_ROW*`) y `clienteDeCampania` (ahora con `status = 400`) responden **400** con mensaje |
| La API aceptaba fechas al revés: fin de periodo de prueba / fin de contrato antes del ingreso, fecha final o de retorno de novedad antes de la inicial, periodos de vacaciones invertidos | `utils/validarEmpleado.js` (compartido con Hydra), `validarNovedad` y `validarVacaciones` en el controller |
| La API aceptaba negativos: bonos, número de hijos, total de días, días/pasivo de vacaciones | Mismas validaciones |
| Retiro: la API no exigía la justificación de los tipos con `requiere_justificacion` ni que el retiro fuera posterior al ingreso (solo lo hacía el modal) | `validarRetiro` en `models/Retiro.js`, en `registrar` y `actualizar`; error `status = 400` |
| Un Excel corrupto o de otra plantilla en "Cargar Excel" se tomaba como "0 empleados" sin aviso | Preview y commit responden 400 si no hay filas ni errores de parseo |
| La dirección llegada sin `tipo_direccion_id` (API directa) se descartaba en silencio | `guardarDireccion` toma "Residencia" por defecto, igual que el formulario, el import y Hydra |

Todos los formularios (`AgentForm`, `NovedadForm`, `TraspasoForm`, `VacacionesForm`, `RetiroModal`)
ya muestran `err.response.data.message`, así que los mensajes nuevos llegan al usuario.

**Para decidir con el negocio (no se tocó):**
- A un empleado **retirado** se le pueden registrar novedades y traspasos (API y UI: los selectores
  listan a todos). Una novedad de fechas anteriores al retiro es legítima; un traspaso no parece.
- 3 contratos tienen fin de periodo de prueba **un día antes** del ingreso (cédulas 1030582520,
  1007134962 —del Excel real— y 10056566565, de prueba). Con la validación nueva, **editar su ficha
  pide corregir esa fecha** antes de guardar.
- `tipo_retiro` "Renuncia" trae `motivo_sugerido` "Proceso disciplinario".
- El teléfono es obligatorio en el formulario pero no en la API.
- La previsualización del Excel real propone crear la ciudad "BOGOTÁ D.C D.C." (duplicados de
  ciudad, §38).
- Detalle menor de UI: el contador del menú "Novedades" no se actualiza al crear una hasta recargar.

## 40. Sesión 2026-10-26 — Alta de empleado: obligatorio todo lo que aplica a cualquier empleado

En `AgentForm.jsx`, **solo al crear** (al editar no, para no bloquear fichas importadas incompletas):

- **Paso 1, ahora obligatorios:** fecha y ciudad de expedición, fecha y ciudad de nacimiento,
  género, estado civil, grupo sanguíneo, número de hijos (acepta 0), correo, y la dirección
  completa (dirección, barrio, ciudad, zona, tipo de vivienda).
- **Paso 2, ahora obligatorios:** empresa, periodo de pago, tipo cotizante, EPS, ARL, tarifa ARL,
  cuenta bancaria (banco, tipo y número), contacto de emergencia (nombre, teléfono, parentesco),
  fin de contrato cuando el tipo lo muestra y las tallas cuando aplica dotación. AFP, cesantías y
  caja son obligatorias salvo en Aprendizaje y Prestación de servicios, que no cotizan.
- **Siguen opcionales** porque no todos los tienen: segundo nombre y apellido, RUT, libreta
  militar, documento secundario, piso, jefe inmediato/de área/director, cargo y usuario SSFF, fin
  del periodo de prueba, bonos, fechas de afiliación y recursos (diadema, locker, carnet).

Es validación del formulario: la API (`utils/validarEmpleado.js`) no cambió, porque la comparten la
carga del Excel y Contratación Hydra, que traen datos incompletos.

## 41. Sesión 2026-10-27 — HeadCount: ingresos desde el 18-sep y jefaturas que no estaban vinculadas

**Fuente:** `Descargas/HeadCount.xlsx`, enviado por RRHH. "TOTAL PERSONAL" son los 389 ya cargados, todos
activos, con ingreso hasta el 2026-09-15. "Personal pend" son los 67 ingresos desde el 2026-09-18, 7 de
ellos ya son bajas. Contratación borró 26 columnas de "Personal pend", entre ellas *Tipo de contrato* y
*Ciudad donde labora*, que el import exige, y el resto quedó corrido. El import por posición no la puede
leer, y además siempre toma la hoja "TOTAL PERSONAL", así que subir el archivo tal cual habría
re-actualizado los 389 sin crear ninguno.

**Comparación de los 389 contra la BD:** campaña, centro de costo, salario, fecha de ingreso, teléfono y
correo, iguales. Lo que no cuadraba eran los vínculos de jefatura y analista, vacíos porque el nombre del
Excel no coincidía letra por letra con la ficha, o porque la persona no tiene ficha.

**Decisiones de RRHH:**
- Tipo de contrato Indefinido y ciudad Bogotá para los 67. Las bajas se cargan y se les registra el retiro.
- Alias confirmados: "GISETHE RODRIGUEZ" = Angie Gisethe Rodriguez Franco; "SHARON PARDO" = Sharon Disley
  Pardo Sanchez; "STEFANY VELASQUEZ" = Stefany Julieth Velasquez Rodriguez; "AZAEL ... BETANCURT" =
  Betancourt; "LAIDY NATHALY" = Nathali; "DIANA MILENA SASTRE" = Diana Marcela.
- **German Stiven Arias Rojas** (dueño, "jefe de los jefes"): ficha mínima sin contrato, CC `0123456789`.
  Aparece en la tabla de Empleados sin estado de contrato. No recibe cuenta ni usuario de AsisLock, porque
  ambos piden contrato vigente. Quién gestiona la asistencia de su equipo está en `asistencia.md` §44.
- Miguel Angel Bautista Leguizamon y Nicolas David Flor Bernal ya no están. Los 3 de workforce de Miguel
  pasan a **Manuel Andres Quintero Barbosa**, nuevo jefe de workforce que viene en "Personal pend".
- Los analistas sin ficha (Sebastian Sanchez, Maria Reyes, Cristian Ortiz, Karen Avila, Juan David Aguirre,
  Brian Lopez, Nathalia Timote; 120 empleados) ya no están: se asigna el **director de área** del empleado.

**`scripts/headcountRRHH.js`** (lee por posición y valida los encabezados antes de leer):
- `excel <HeadCount> <salida>` arma "Personal pend" con el formato de "TOTAL PERSONAL", con los alias
  aplicados, y deja sin diadema ni locker a las bajas.
- `sincronizar <HeadCount> [--aplicar]` hace tres cosas:
  - crea la ficha de German;
  - llena los campos vacíos de jefe inmediato, jefe de área, director, analista y gestor de asistencia
    (082) de las dos hojas, y reporta sin tocar los que ya tienen otra persona;
  - registra el retiro de las 7 bajas con `Retiro.registrar`, con su fecha, tipo, motivo y justificación.

  Es idempotente.

**Aplicado en local:**
- import de los 67 sin errores; se crearon los cargos PROFESIONAL SST y JEFE DE WORKFORCE, los centros de
  costo CBAH VENTA CRUZADA y CBAP WHATSAPP, y las oleadas OLD 38-40;
- sincronizar: 394 contratos completados (42 jefes inmediatos, 53 jefes de área, 52 directores,
  389 analistas, 53 gestores) y 7 retiros. La segunda corrida no cambia nada.

**Aplicado en producción el 2026-10-27**, en el orden de `asistencia.md` §44:
- carga de `PersonalPend_para_cargar.xlsx` por "Cargar Excel";
- `sincronizar --aplicar`, con el mismo resultado que en local: ficha de German, 394 contratos y 7 retiros;
- la segunda corrida quedó en 0.

El HeadCount tiene datos personales reales: no se commitea; se borró del servidor después de usarlo (confirmado el 2026-10-27).
Producción queda con 389 + 67 fichas de empleado (60 activas y 7 retiradas), más la ficha sin contrato de
German.

## 42. Sesión 2026-10-30 — Documentación del empleado y contrato y anexos (migración 088)

Después de registrar un empleado (a mano, por Excel o desde Hydra) RRHH carga dos PDF unificados:
**Documentación del empleado** y **Contrato y anexos**. No bloquean nada: quedan como pendiente visible.

- **Tabla `empleado_documento`** (088, idempotente): un archivo por empleado y `tipo`
  (`documentacion_empleado` | `contrato_anexos`, `UNIQUE(users_company_id, tipo)`), `ON DELETE CASCADE`.
  Subir otro lo reemplaza y borra el archivo anterior después del commit.
- **Archivos** en `storage/empleados/` (privado, `crearSoportesRrhh('empleados', { maximoMb: 50, tipos: PDF })`).
  El servidor exige además la firma `%PDF-` del archivo: un `.pdf` que no lo es se rechaza (400).
- **API** (`routes/usersCompany.js`, `verificarRecursosHumanos`):
  `GET /:id/documentos`, `PUT /:id/documentos/:tipo` (multipart, campo `archivo`),
  `GET /:id/documentos/:tipo/archivo`, `DELETE /:id/documentos/:tipo`. Borrar la ficha borra sus archivos.
- **Listado**: `SELECT_EMPLEADO` trae `documentos_cargados` (subconsulta a `empleado_documento`), por eso
  **la 088 tiene que estar aplicada antes de subir el código** o el listado de empleados falla.
- **Frontend**: pestaña "Documentos" siempre visible en la ficha (`EmpleadoDrawer`, ahora de 520px) con
  `DocumentosEmpleado` arriba y, si llegó de Hydra, los documentos de contratación (087) debajo; badge
  "Faltan documentos (n)" en la cabecera; subida sin timeout con barra de avance y tope de 50 MB del lado del
  cliente; "Ver" abre el modal `PrevisualizacionDocumento` (compartido con Hydra, hook `usePrevisualizacion`).
  En el listado, filtro "Documentos: Completos/Pendientes". Al crear un empleado a mano se abre su ficha
  directamente en Documentos.
- **Despliegue**: nginx debe permitir cuerpos de 50 MB en `/api/users-company`
  (`client_max_body_size 50m;`), o la subida falla con 413 antes de llegar a Express.

Probado en local 2026-10-30: subida de 0,4 KB / 30 MB / 40 MB, reemplazo, rechazo de 51 MB (cliente y
servidor), de un HTML con extensión `.pdf`, de una imagen y de un tipo inválido; 401 sin sesión;
previsualización, eliminación y filtro en el navegador. No se probó en el navegador el alta completa
(solo que `AgentForm` pasa el empleado creado a `onSuccess`).

## 43. Sesión 2026-10-30 — Plantilla de cargue masivo con los campos de "Personal pend"

**Pedido.** La plantilla descargable ("Descargar plantilla" en "Cargar Excel") traía las ~100
columnas de "TOTAL PERSONAL", muchas en desuso, y confundía. Se rehízo con los campos de la hoja
"Personal pend" del HeadCount, que es como RRHH arma hoy los ingresos (§41).

**Plantilla** (`ImportEmpleadosModal.jsx::COLUMNAS_PLANTILLA`, `plantilla_empleados.xlsx`):
- **Hoja "Empleados"**: 58 columnas. Son los campos de "Personal pend" que el import guarda, más:
  - **Tipo De Contrato** y **Ciudad Donde Labora**: el import los exige (`CAMPOS_CONTRATO_OBLIGATORIOS`) y "Personal pend" no los trae. En el último cargue se rellenaron con CTI y Bogotá (§41).
- **Hoja "Instrucciones"**: dice qué columnas son obligatorias y cómo llenar cada una.
- **Identificación**: con nombres únicos, "Número De Identificación" y "Tipo/Número De Identificación Secundaria". Antes había 4 "Tipo De Identificación" repetidas.
- **Se quitaron**:
  - de "Personal pend": las dos columnas "Estado", "Nombre Propio" (se calcula) y las de retiro (fechas, tipo, motivo, justificación). El import no las lee; los retiros se registran aparte.
  - de "TOTAL PERSONAL", porque ya no se usan: Cargo/Usuario SSFF, Bono cafetería, Tipo de dirección, fechas de afiliación, traslados y Tarifa ARL, vacuna COVID, piso, certificación laboral y los campos de nómina de la 050.

**Lector** (`utils/importEmpleadosExcel.js`):
- `detectarColumnas` decide cómo se lee el archivo:
  - si trae "Numero de cuenta Correcta", es el **Excel viejo de "TOTAL PERSONAL"** y se sigue leyendo **por posición** (`COL`, sin cambios);
  - cualquier otro se lee **por nombre de columna** (`COLUMNAS_POR_NOMBRE`), en cualquier orden.
- Con "Tipo De Identificación" repetida (las hojas del HeadCount), el bloque de identificación va por posición. Así la hoja "Personal pend" también se puede subir tal cual.
- Cada fila lleva `campos_ausentes`: los campos cuya columna no trae el archivo.

**Sin borrar datos al actualizar** (`importEmpleadosService::conservarAusentes`):
- Antes, actualizar un empleado existente reescribía todos sus campos con lo del archivo.
- Ahora, si la columna **no viene** en el archivo, se conserva el valor actual: SSFF, piso, fechas de contrato, bonos, tarifa y fechas de afiliación, zona de dirección y campos de nómina. Mapa en `CONSERVAR_SI_FALTA`.
- Una celda vacía de una columna que **sí** viene sigue vaciando el campo, como antes.

**Probado (local):**
- "TOTAL PERSONAL" del HeadCount: 389 filas, idénticas al lector anterior.
- "Personal pend" leída por nombre coincide con el Excel convertido de §41. Solo cambian diadema y locker en las 7 bajas, que el script vació a propósito.
- La plantilla llenada con los 67 empleados de "Personal pend":
  - todas las columnas reconocidas y ningún obligatorio vacío;
  - la vista previa del import dio 0 errores.
- Al confirmar un empleado existente con la plantilla, se actualizó el teléfono (columna presente) y se conservaron usuario y cargo SSFF, piso, fin de contrato, tarifa ARL y fecha de afiliación EPS (columnas ausentes). El salario no abrió un historial nuevo. Los datos de prueba se revirtieron.
- Pruebas en `tests/importEmpleadosExcel.test.js`; `npm test` pasa con 271.

## 44. Sesión 2026-10-30 — Formulario de nuevo empleado igual a la plantilla, jefes y salario

**Decisión del usuario:** el formulario manual (`AgentForm.jsx`) queda con los mismos campos que la
plantilla de cargue masivo (§43). Esto **reemplaza la regla de §18** (campos solo de las hojas
"Nuevo Epleado" y "EJEMPLO").

**Campos del formulario:**
- **Quitados de la vista:** libreta militar, zona, tipo de vivienda, cargo SSFF, usuario SSFF, piso, fin de contrato, empresa, periodo de pago, tipo cotizante, bono cafetería, tarifa ARL y las fechas de afiliación EPS/ARL/AFP/caja.
  - Siguen en el estado del formulario: al editar se reenvían tal cual y no se borran.
  - Aprendizaje sigue calculando el fin de contrato a 6 meses aunque el campo no se vea.
  - Sin tarifa propia, el costo de nómina usa el porcentaje general de ARL.
  - Empresa, periodo de pago, tipo cotizante, zona, vivienda y tarifa ARL ya no son obligatorios al crear (el backend nunca los exigió).
- **Agregados en "Otros":** Analista encargado y Observaciones.
  - Al crear, el analista se muestra como informativo ("Se asigna a quien registra al empleado"): el backend lo toma del login y no del formulario (§18).
  - Al editar, el analista es un buscador sobre todos los empleados.
- Ciudad de residencia y RUT se quedan: la plantilla trae RUT, y la ciudad completa la dirección.

**Filtros validados contra los 458 contratos activos.** Cada empleado se simuló como nuevo, quitándolo de las cadenas de mando.

Jefes, filtrados por campaña + cargo:

| Rol | Su jefe real aparece | Sugerencia que acierta |
|---|---|---|
| Jefe inmediato | 426/454 | 62 (solo se sugiere cuando hay uno) |
| Jefe de área | 439/455 | 386 |
| Director | 445/450 | 387 |

- Los casos que fallan son equipos nuevos o cambios de jefe.
- **Cambio:** debajo de los sugeridos aparece un grupo "Otros jefes" con las 44 personas que ya son jefe o director de alguien. Esas 44 cubren a todos los jefes reales.

Salario sugerido por cliente + cargo:
- 420 coinciden con el salario real;
- 8 distintos (por ejemplo, salarios negociados);
- 3 ambiguos que incluyen el real;
- 27 sin referencia.

**Corrección del salario sugerido:**
- Al cambiar de una combinación con salario único (por ejemplo Claro + Agente call center, $1.750.905) a una sin salario único (por ejemplo Asiste + Ayudante de obra, que tiene 3), el campo conservaba el salario anterior y quedaba desbloqueado.
- Ahora, si el salario lo había puesto la sugerencia, el campo se vacía; uno escrito a mano se respeta.

**Prueba en el navegador (local, 2026-10-30), con la cuenta de prueba `prueba.rrhh` (clave del seed):**
- **Filtros:** Claro dejó 9 campañas y 16 cargos. T&T + Agente call center sugirió el salario $1.750.905 bloqueado, 12 jefes inmediatos sugeridos + 32 en "Otros jefes", y dejó prellenados jefe de área y director.
- **Jefe de "Otros jefes":** al elegirlo se mantiene, sin pisar el resto de la jefatura.
- **Alta completa:** se guardó sin los campos quitados.
- **Edición:** se actualizaron el teléfono y el analista; piso, empresa, usuario SSFF y tarifa ARL, puestos a mano en la BD, se conservaron, y no se abrió un historial salarial nuevo.
- El empleado de prueba (cédula 9000000099) se borró después, junto con su aviso a AsisLock.

**Migración 090 `salario_referencia_por_nombre`:**
- Carga en producción las 58 filas de `salario_referencia`, buscando cliente y cargo por nombre con `COLLATE utf8mb4_0900_ai_ci` en los dos lados.
- En producción la tabla estaba vacía desde §29.3, así que no había salario sugerido ni filtro de cargo por cliente.
- Es idempotente. Al final lista las filas cuyo cliente o cargo no existe con ese nombre (debe salir vacío).
- Se probó en local con la tabla vacía y con dos corridas seguidas.
- Efecto en local: el `CREATE TABLE IF NOT EXISTS` hace commit implícito, así que la prueba renumeró los IDs locales a 59–116. Son los mismos datos y nada referencia esos IDs.
- **Pendiente en producción.** Sin dependencias; puede ir antes o después del código.
