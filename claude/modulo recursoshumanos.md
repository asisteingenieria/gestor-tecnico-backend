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
