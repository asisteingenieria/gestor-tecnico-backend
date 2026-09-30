# Contexto Original del Proyecto — Gestor Técnico

> Documento generado explorando ambos repositorios (backend + frontend) para dar contexto completo a futuras sesiones de trabajo con Claude Code.

## 1. Qué es el sistema

Sistema interno de gestión técnica para un call center / institución educativa (jdc.edu.co). Cubre:

- Soporte técnico: incidentes sobre estaciones de trabajo (workstations), asignación a técnicos, supervisión y aprobación.
- Inventario de activos tecnológicos (equipos, componentes, historial de cambios, bajas).
- Gestión de empleados (antes "agentes") con datos personales, laborales, contractuales y de seguridad social, y asignación de activos a empleados.
- Control de asistencia: marcaje de entrada/salida, pausas de baño/almuerzo con contador en vivo, horarios asignados por un director de operaciones, horas extra con aprobación y trazabilidad diaria (ver §5.1).
- Solicitudes de diseño gráfico con flujo de estados y entrega de archivos.
- Chat interno + chat anónimo ("Hanny") en tiempo real vía Socket.IO.
- Analítica avanzada de incidentes (solo admin) y vista ejecutiva de inventario (directivo financiero).

## 2. Repositorios

| Repo | Ruta local | Rama activa |
|---|---|---|
| Backend | `C:\Users\juan.acosta\Desktop\BackGestor\gestor-tecnico-backend` | `sebas-branch` |
| Frontend | `C:\Users\juan.acosta\Desktop\FrontGestor\gestor-tecnico-frontend` | (verificar rama actual al trabajar) |

No son un monorepo: son dos carpetas/repos git independientes, hermanas bajo `Desktop`.

---

## 3. Backend

**Stack:** Node.js · Express 5 (RC) · MySQL (`mysql2`, pool máx. 10) · JWT (`x-auth-token` header, expira 5h) · Socket.IO 4 · Multer (uploads) · bcryptjs.

**Puerto:** 5001 · **Base de datos:** `call_center_support`.

### Estructura

```
gestor-tecnico-backend/
├── config/db.js                 # Pool MySQL
├── controllers/                 # Lógica de negocio por dominio
├── models/                      # Acceso a datos (clases estáticas async)
├── routes/                      # Definición de endpoints Express
├── middleware/                  # auth (JWT+RBAC), validar, asyncHandler, errorHandler, upload*
├── migrations/                  # SQL numerado (hasta 045, sin runner automático — ver §8.3)
├── scripts/                     # Setup/fix de datos puntuales + cierre diario de asistencia
├── uploads/                     # incidents/, activos/, disenos/, disenos/entregas/
├── errors/AppError.js           # Errores de dominio tipados (módulo de asistencia)
├── validators/asistenciaSchemas.js
├── utils/fechaBogota.js         # UTC ↔ Bogotá (único lugar con aritmética de zona horaria)
├── domain/asistencia/           # Motor de cálculo puro (§8.2) — sin acceso a BD ni HTTP
├── repositories/asistencia/     # Único lugar con SQL del módulo de asistencia
├── services/asistencia/         # Reglas, transacciones, autorización del módulo de asistencia
├── controllers/asistencia/      # Adaptadores HTTP del módulo de asistencia
├── routes/asistencia.js         # Monta /api/asistencia
├── tests/asistencia/            # node --test, dominio puro (26 tests)
├── database/gestor.sql          # Dump/esquema de referencia
├── context/CONTEXT.md           # Documentación previa (algo desactualizada, ver notas abajo)
├── claude/                      # Este documento + notas por módulo (sin trackear en git)
├── CLAUDE.md                    # Punto de entrada para Claude Code (ver §8.1)
├── asistencia.md                # Plan del módulo de asistencia — implementado (ver §8.2 y §9)
├── .claude/skills/              # Skills del proyecto (ver §8.1)
└── index.js                     # Entry point: Express + Socket.IO + registro de rutas
```

### Rutas registradas en `index.js` (fuente de verdad de lo que está vivo)

```
/api/auth              /api/incidents        /api/users
/api/workstations      /api/chat              /api/analytics
/api/activos           /api/activos-tecnico   /api/inventario-directivo
/api/auto-activos      /api/script-parser     /api/users-company
/api/disenos           /api/asistencia
```

⚠️ **`routes/agentes.js`, `controllers/agenteController.js` y `models/Agente.js` existen en disco pero NO están registrados en `index.js`.** Son el módulo legacy "agentes" que fue reemplazado por el módulo de empleados (`users_company`, ver §5). No usar como referencia de comportamiento actual; considerar candidatos a limpieza si se confirma que nada más los referencia.

### Roles de usuario

`admin`, `coordinador`, `supervisor`, `technician`, `jefe_operaciones`, `administrativo`, `gestorActivos`, `tecnicoInventario`, `directivoFinanciero`, `disenador`, `recursosHumanos`, `anonimo` (chat con Hanny), `director_operaciones`, `empleado` (migración `043`, módulo de asistencia — ver §8.2).

`recursosHumanos` (agregado 2026-07-21, migración `037`): dueño exclusivo del módulo de Empleados (antes vivía dentro de `gestorActivos`, ver §5 actualizado). `gestorActivos` conserva solo lectura de `GET /users-company` para el selector de "agente asignado" en `AssetForm`.

Jerarquía aproximada: `admin` > `jefe_operaciones` > `supervisor/coordinador` > `technician/tecnicoInventario` > `administrativo` > `anonimo`.

### Módulos y endpoints

El detalle completo (endpoints de incidentes, workstations, activos, activos-tecnico, chat, analytics, diseños, inventario-directivo, modelos de datos, reglas de visibilidad por rol, flujo de estados de incidentes y de diseños, carga de archivos por contexto) está documentado en **`context/CONTEXT.md`**, que sigue siendo válido salvo:

- No incluye el módulo de **empleados** (`users-company`), que reemplazó a `agentes` — ver §5.
- No lista los endpoints de `/api/auto-activos` y `/api/script-parser` — ver §6.
- La lista de roles ahí no incluye `disenador` de forma explícita en la tabla de roles (sí en el flujo de diseños).
- No incluye el módulo de **asistencia** (`/api/asistencia`), implementado 2026-09-15 — el detalle completo vive en `asistencia.md` (plan + §14 con las notas de implementación), no en `CONTEXT.md`.

Tratar `context/CONTEXT.md` + este documento como complementarios: éste cubre lo nuevo/lo que cambió; aquél cubre el detalle estable (incidentes, activos, analíticas).

#### 5. Empleados — `/api/users-company` (reemplaza a "agentes")

**Actualizado 2026-07-21:** el módulo pasó de `gestorActivos` a ser propiedad exclusiva de `recursosHumanos` (+ `admin`). Middleware dividido en `routes/usersCompany.js`: `verificarLecturaEmpleados` (`gestorActivos`, `recursosHumanos`, `admin` — solo en `GET /`, para no romper el selector de `AssetForm`) y `verificarRecursosHumanos` (`recursosHumanos`, `admin` — todo lo demás). Ya no existe el middleware único `verificarGestorActivos`.

Además del CRUD de empleados, el router ahora expone 3 sub-módulos nuevos bajo el mismo `/api/users-company` (mismo controller, sin router separado): **Novedades RRHH** (`/novedades`), **Traspasos** (`/traspasos`) y **Pasivo Vacacional** (`/vacaciones`), cada uno con GET/POST/PUT/DELETE. Modelos: `models/NovedadRrhh.js`, `models/Traspaso.js`, `models/Vacaciones.js`. Todo esto ya está commiteado y **mergeado a `main`** (commit `f944c7e "modulo recursos humanos"`, PR #9) — no es un WIP suelto.

```
GET    /                          getAll (incluye datos del último contrato: campaña, cargo, estado, salario vigente)
                                   ?sin_usuario=true → solo fichas sin cuenta de login vinculada (users.users_company_id),
                                   usado por el selector de creación de usuarios director_operaciones/empleado (ver §10)
GET    /catalogos                 getCatalogos (~20 catálogos, incluye lista de empleados para "jefe inmediato")
GET    /gasto-total                getGastoTotal
GET    /:id                       getById → getByIdCompleto (empleado con todos sus datos anidados)
GET    /:id/activos                getActivos
POST   /                          create (payload anidado transaccional)
PUT    /:id                       update (mismo payload anidado)
PUT    /:id/activos/:activoId     assignActivo
DELETE /:id                       delete (borra contratos primero por FK RESTRICT, resto cae por CASCADE)
DELETE /:id/activos/:activoId     unassignActivo
```

Payload de `create`/`update` es **un formulario único transaccional** con secciones anidadas: `contrato`, `salario`, `seguridad_social` ({eps, arl, afp, cesantias, caja}), `cuenta_bancaria`, `direccion`, `contacto_emergencia`. El modelo usa `db.getConnection()` + transacción manual (no hay ORM). El cliente del contrato se deriva de la campaña. Un cambio de salario cierra la vigencia actual en `historial_salarial` e inserta una fila nueva.

**Origen del esquema:** migración `034 create gestion empleados tables.sql` (DROP+CREATE, 32 tablas, catálogos incluidos: `tipo_identificacion`, `estado_civil`, `grupo_sanguineo`, `genero`, `ciudad`, `tipo_direccion`, etc.). `users_company` quedó solo con datos personales; lo laboral vive en `contrato` (campaña, cargo, estado, fecha_ingreso) y `historial_salarial` (salario).

**Migraciones de seed relacionadas (manuales, no hay runner automático):**
- `035_seed_catalogos_empleados_y_fk_activos.sql` — seeds de identificación/personales + re-apunta la FK `activos.agente_id` de la tabla `agentes` (legacy) a `users_company`, anulando asignaciones viejas.
- `036_seed_catalogos_laborales.sql` — seeds laborales: clientes (NIT provisional), campañas, áreas, cargos, EPS/ARL/AFP/cesantías/cajas, bancos, parentescos, etc.

**Asignación de activos** se conservó igual que en el módulo viejo: `PUT/DELETE /users-company/:id/activos/:activoId`; `models/Activo.js` soporta filtro `?sin_agente=true` para listar activos sin empleado asignado.

**Frontend correspondiente:** `AgentForm.jsx` (formulario único por secciones, carga catálogos + empleado completo al editar), `AgentManagement.jsx` (tabla con info laboral), `AssetForm.jsx` (selector de empleado por `nombre_completo`). Ruta en frontend: `/activos/empleados` (dentro del layout de `gestorActivos`), a pesar de que el componente se sigue llamando `AgentManagement`.

**Why:** RRHH requiere datos de empleado normalizados (catálogos con FK) en lugar de texto libre.

#### 6. Auto-activos y Script-parser

Dos rutas públicas (sin `verifyToken` a nivel de router) usadas para creación asistida/automática de activos, probablemente desde un script/agente externo que corre en los equipos:

```
POST /api/auto-activos/create    receiveEquipmentData   # crea activo desde datos automáticos del equipo
POST /api/auto-activos/preview   previewEquipmentData   # preview sin persistir (testing)

POST /api/script-parser/parse    parseScriptText         # parsea texto de un script y crea/preview un activo
```

Frontend: `ScriptParser.jsx`, ruta pública `/activos/script-parser` (fuera de `ProtectedRoute` en `App.jsx`).

### Variables de entorno (`.env`)

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=<password>
DB_DATABASE=call_center_support
JWT_SECRET=<secreto>
PORT=5001
FRONTEND_URL=http://localhost:5173
NODE_ENV=development | production
```

CORS dinámico: en dev permite `localhost:5173`/`5174`; en producción usa `FRONTEND_URL` + IPs hardcodeadas (`31.97.138.23:5173/5174`) en `index.js`.

### Notas técnicas importantes

1. Express 5 (no v4) — cuidado con manejo de promesas/errores en middlewares.
2. Tolerancia de escáner de pistola en placas: `Activo` maneja variantes `ECC-XXX` y `ECC'XXX`.
3. Autoasignación: un técnico puede asignarse a sí mismo un incidente.
4. Trabajo remoto Barranquilla: técnicos de Bogotá y Villavicencio también atienden incidentes de esa sede.
5. `User.deleteWithDependencies()` y el `delete` de `users-company` usan transacciones para no romper FKs.
6. No hay migration runner: las migraciones SQL se aplican manualmente en orden numérico.
7. Socket.IO: autenticación por JWT en la conexión, mapa global `authenticatedUsers` (userId → socketId) en `index.js`, helper global `sendMessageToUser(userId, event, data)`.

---

## 4. Frontend

**Stack:** React 18 + Vite 7 + React Router 6 + Tailwind CSS 3 + Axios + Socket.IO client + Chart.js/react-chartjs-2 + jsPDF + xlsx + lucide-react.

**Scripts:** `npm run dev` (modo development), `npm run build` (producción), `npm run lint`.

### Estructura (`src/`)

```
src/
├── App.jsx              # Definición de rutas, layouts por rol, route guards
├── main.jsx
├── context/AuthContext.jsx   # Login/logout, token, flags de rol (isAdmin, isGestorActivos, ...)
├── services/api.js           # Instancia axios + interceptores + todos los "*Service" por dominio
├── hooks/                    # useNotifications, useReturnedIncidents, useJornada (asistencia)
├── utils/                    # incidentAlerts, soundAlerts, fecha.js (formateo de DATE sin bug de TZ)
└── components/
    ├── incidents/             # CreateIncident, PendingIncidents, MyIncidents, IncidentsSupervision, ...
    ├── AssetManagement.jsx, AssetInventory.jsx, AssetCharts.jsx, AssetForm.jsx, AssetDetailModal.jsx, AssetHistoryPanel.jsx, AssetComponentHistory.jsx, AssetLayout.jsx
    ├── AgentForm.jsx, AgentManagement.jsx, EmpleadoPerfilModal.jsx   # módulo de empleados (users_company)
    ├── TecnicoInventarioLayout.jsx, TecnicoInventarioEdicion.jsx
    ├── DirectivoFinancieroLayout.jsx, DirectivoDashboard.jsx
    ├── Disenos.jsx                              # módulo de diseños
    ├── asistencia/            # EmpleadoLayout, DirectorOperacionesLayout, MiJornada, ContadorJornada,
    │                          # BotonesPausa, MiHorario, MiTrazabilidad, TrazabilidadView (compartido),
    │                          # MisEstadisticas, HorasExtra, EquipoAsistencia, TrazabilidadEmpleado,
    │                          # GestionHorarios — ver asistencia.md §14 (Fase 5)
    ├── AnonymousLayout.jsx, AnonymousChat.jsx, ChatBox.jsx
    ├── Layout.jsx, Dashboard.jsx, Login.jsx
    ├── UserManagement.jsx, WorkstationManagement.jsx, Analytics.jsx, Tecnicos.jsx
    ├── ScriptParser.jsx
    └── NotificationBell.jsx, AlertsDropdown.jsx, AlertBanner.jsx, IntrusiveAlerts.jsx, IncidentAlert.jsx, StarRating.jsx, TechnicianRatings.jsx, TechniciansRankingPanel.jsx, CopyableId.jsx
```

### Configuración de API

`VITE_API_BASE_URL` (env de Vite) o fallback `http://localhost:5001/api`. Axios con interceptor que:
- agrega `x-auth-token` desde `localStorage` en cada request,
- en un 401 borra el token y redirige a `/login`.

`services/api.js` expone servicios agrupados por dominio: `userService`, `workstationService`, `incidentService`, `chatService`, `analyticsService`, `assetHistoryService`, `userCompanyService`, `disenoService`, `asistenciaService`. (No existe un servicio para `agentes` — confirma que el frontend ya migró por completo a `userCompanyService`.)

### Enrutamiento por rol (`App.jsx`)

- `AuthProvider` envuelve toda la app; `AuthContext` expone flags booleanos por rol (`isAdmin`, `isGestorActivos`, `isTecnicoInventario`, `isDirectivoFinanciero`, `isDisenador`, `isAnonimo`, `isEmpleado`, `isDirectorOperaciones`, etc.) derivados de `user.role`.
- `LayoutWrapper` elige el layout según rol: `AnonymousLayout` (anonimo), `AssetLayout` (gestorActivos), `TecnicoInventarioLayout` (tecnicoInventario), `DirectivoFinancieroLayout` (directivoFinanciero), `EmpleadoLayout` (empleado), `DirectorOperacionesLayout` (director_operaciones), o `Layout` por defecto.
- `RedirectByRole` / `DashboardRoute` deciden a dónde va cada rol al entrar: `anonimo`→`/chat`, `gestorActivos`→`/activos`, `tecnicoInventario`→`/inventario-tecnico`, `directivoFinanciero`→`/directivo`, `disenador`→`/disenos`, `empleado`→`/asistencia`, `director_operaciones`→`/operaciones`, resto→`/dashboard`.
- Route guards: `ProtectedRoute` (autenticado), `AdminRoute`, `GestorActivosRoute`, `TecnicoInventarioRoute`, `DirectivoFinancieroRoute`, `EmpleadoRoute`, `DirectorOperacionesRoute`, `NonAnonymousRoute` (bloquea anónimos), `AnonymousRoute` (solo anónimos).
- Rutas de asistencia: `/asistencia/*` (empleado: jornada, horario, trazabilidad, estadísticas, horas extra) y `/operaciones/*` (director: las mismas + equipo, horarios, bandeja de horas extra) — ver `asistencia.md` §14 (Fase 5).
- Ruta pública sin auth: `/activos/script-parser` → `ScriptParser` (coincide con `POST /api/script-parser/parse` público en backend).
- Ruta de empleados vive en `/activos/empleados` → `AgentManagement` (dentro del guard `GestorActivosRoute`), aunque el componente conserva el nombre histórico "Agent*".

---

## 5. Estado de la migración "Agentes" → "Empleados" (para tener en cuenta)

Esto es lo más importante a recordar al tocar este módulo:

- El modelo de dominio **ya no es "agente"** (cédula + nombres + apellidos + campaña, tabla `agentes`), sino **"empleado"** sobre `users_company` con datos normalizados vía catálogos (identificación, estado civil, género, grupo sanguíneo, ciudad) + tablas relacionadas de contrato, salario, seguridad social, cuenta bancaria, dirección y contacto de emergencia.
- El código legacy de `agentes` (`routes/agentes.js`, `agenteController.js`, `models/Agente.js`, tabla `agentes`) sigue en el repo pero **desconectado del router principal**. No confundir con el módulo activo.
- Los nombres de componentes/rutas del frontend (`AgentForm`, `AgentManagement`, ruta `/activos/empleados`) son herencia del nombre viejo pero ya apuntan al nuevo backend (`userCompanyService` → `/api/users-company`).
- Si se necesita extender (nuevos tipos de contrato, novedades, retiros, etc.), las tablas base ya existen en la migración `034` con FKs definidas; sumar seeds en migraciones nuevas siguiendo el patrón de `035`/`036`.

---

## 6. Cómo se relacionan ambos repos

- El frontend consume el backend exclusivamente vía HTTP (`axios`, base URL configurable por `VITE_API_BASE_URL`) y WebSocket (`socket.io-client`) para notificaciones en tiempo real.
- No hay tipos compartidos ni contratos formales (OpenAPI/GraphQL) entre ambos — la única fuente de verdad de la forma del payload son los controllers del backend y los `*Service` de `src/services/api.js` en el frontend.
- Roles definidos en el backend (columna `role` de `users`) deben coincidir exactamente con los strings usados en `AuthContext.jsx` (`user?.role === 'gestorActivos'`, etc.) y en los middlewares de rutas (`verificarRecursosHumanos`/`verificarLecturaEmpleados` en empleados, checks de roles en cada controller/route).

---

## 7. Topología de despliegue a producción (descubierto 2026-07-21)

**Servidor:** `srv845606` (root SSH).

- **Backend:** `/root/gestor-tecnico-backend`, corre bajo **pm2** como proceso `gestor-backend` (modo fork). Deploy = `git pull origin main` + pm2 detecta el reinicio o hay que forzarlo manualmente (verificar `pm2 restart gestor-backend` si el proceso no recoge cambios solo).
- **Frontend:** `/var/www/gestor-tecnico-frontend`, servido como archivos estáticos vía **nginx** directamente desde `dist/`. **No hay build en el servidor por defecto** — `dist/` está commiteado en el repo del frontend y es lo que nginx sirve tal cual. Deploy correcto = `git pull origin main` → **`npm install && npm run build`** (obligatorio, el pull por sí solo NO reconstruye `dist/`) → `nginx -t && systemctl reload nginx`.

**⚠️ Bug ya diagnosticado y corregido una vez por esta causa:** si se hace `git pull` en el frontend de producción sin correr `npm run build` después, el `dist/` servido queda desactualizado respecto al código fuente — pasó con el rol `disenador` (los ítems de menú no aparecían porque el `dist/` en producción era de marzo 2026, anterior a que existiera ese rol en el código). **Regla:** todo pull al frontend de producción debe ir seguido de rebuild, sin excepción.

### Repos personales paralelos (`davidzaratecamp`)

Existe un desarrollador (David Zarate) que en algún punto **pusheó cambios a repos personales propios en vez de al repo de la organización**:
- `https://github.com/davidzaratecamp/gestor-backend.git` (remoto local: `davidzarate`)
- `https://github.com/davidzaratecamp/gestor-frontend.git` (remoto local: `davidzarate`)

Ambos repos son clones/forks funcionalmente equivalentes al repo oficial (`asisteingenieria/gestor-tecnico-backend` y `-frontend`) pero con historia divergente propia. Contienen features que **no están en el repo de la empresa**: teletrabajo (`workstations.modalidad`), catálogo de puestos Site 1/Site 2 en Bogotá (`workstations.site`), eliminación de la sede Villavicencio, ajustes a roles/sedes/departamentos en `userController.js`, y (en frontend) cambios equivalentes en `UserManagement.jsx`, `WorkstationManagement.jsx`, `Analytics.jsx`, `Dashboard.jsx`, incidentes.

**Confirmado en producción (2026-07-21):** ambos servidores (backend y frontend) ya tenían commits de estos repos personales **mergeados directamente en su `main` local** (vía `git pull https://github.com/davidzaratecamp/...` corrido a mano en el servidor, evidenciado por commits `"Merge branch 'main' of https://github.com/davidzaratecamp/..."` en el log). Es decir, producción llevaba tiempo divergiendo silenciosamente de lo que hay documentado como "oficial" en `asisteingenieria`. Ese mismo día se hizo el pull final que trajo también `origin/main` de la empresa (incluyendo el módulo RRHH) y mergeó ambas historias sin conflictos de git en ninguno de los dos repos.

**Colisión de numeración de migraciones detectada:** David numeró migraciones propias reusando números ya ocupados en el repo oficial — `027_add_teletrabajo_fields.sql`/`028_bogota_site_catalog.sql` (suyas, tabla `workstations`) contra `027_add_tipo_to_activos.sql`/`028_create_agentes_and_add_fk_to_activos.sql` (oficiales, activos/agentes). No colisionan en contenido SQL (tablas distintas) pero sí en nombre de archivo — antes de aplicarlas contra una BD limpia hay que renumerar las de David a continuación de la `040` (ej. `041`/`042`) para mantener el orden claro. Pendiente confirmar si esas migraciones de teletrabajo/site ya corrieron contra la BD real de producción (probablemente sí, dado que el código ya estaba desplegado).

**Implicación para el futuro:** antes de asumir que "lo que está en `origin/main` de la empresa" es todo el código real, verificar si el servidor de producción tiene remotos/commits adicionales de repos personales — el `git log --oneline --graph` en el servidor es la fuente de verdad, no el repo local de ningún desarrollador individual.

---

## 8. Sesión 2026-09-15 — Configuración de Claude Code, plan de asistencia y datos de prueba

### 8.1 Configuración de Claude Code (nueva)

Antes de esta sesión el repositorio no tenía **ninguna** configuración de Claude Code. Ahora existe:

| Archivo / recurso | Qué es |
|---|---|
| `CLAUDE.md` (raíz del backend) | Punto de entrada que se carga solo en cada sesión. Resume stack, arquitectura de 2 capas y las trampas de uso diario: migraciones duplicadas, cómo se agrega un rol, UTC vs UTC-5, `.env` con credenciales, módulo `agentes` legacy, `dist/` commiteado. Enlaza a este documento en vez de duplicarlo. |
| `.claude/skills/arquitectura-asistencia/SKILL.md` | Skill con `user-invocable: false` (solo la invoca Claude). Se carga sola al tocar archivos del módulo de asistencia e impone la arquitectura de 4 capas, que **contradice** el patrón del resto del repo. |
| Plugin `frontend-design` | Instalado en scope **user** (aplica también al repo del frontend). Para los componentes React de la fase 5 del plan de asistencia. |
| MCP `context7` | Instalado en scope user (`npx -y @upstash/context7-mcp`). Documentación viva de Express 5, mysql2, socket.io y multer. |
| Plugin `claude-code-setup` | Ya estaba instalado desde 2026-09-10. Aporta la skill `claude-automation-recommender`. |

**Recomendado y NO aplicado:** un MCP de MySQL en solo lectura (requiere decidir credenciales; nunca apuntarlo a producción), un hook `PreToolUse` que bloquee ediciones a `.env`, un hook que valide la numeración de migraciones, una skill `nueva-migracion` y los subagentes `revisor-sql` y `sincronizador-api`.

### 8.2 Plan del módulo de asistencia — `asistencia.md`

Documento de ~1000 líneas en la raíz del backend. **Implementado en su totalidad el mismo
2026-09-15** (backend Fases 0-4 y 6, frontend Fase 5) — ver §9 para el resumen de la sesión de
implementación y `asistencia.md` §14 para el detalle línea por línea de cada fase.

Qué cubre: dos roles nuevos (`director_operaciones`, `empleado`), horarios, marcaje de entrada y salida, pausas de baño y almuerzo con contador en vivo, horas extra con aprobación, y trazabilidad diaria por empleado y por equipo.

**Decisiones de diseño que afectan a todo el repo:**

1. **`users.users_company_id`** — columna FK nueva que por fin vincula la cuenta de login con la ficha de RRHH. Hoy `users` y `users_company` están **desconectadas**. La agrega la migración `043`.
2. **La jerarquía sale de `contrato.jefe_inmediato_id`**, no de una tabla propia. Un director ve a quienes lo tengan como jefe inmediato en su contrato activo.
3. **Arquitectura en 4 capas solo para este módulo** (`domain/` → `repositories/` → `services/` → `controllers/asistencia/`), porque el patrón de 2 capas del resto del repo no aguanta la lógica de cálculo de tiempos. Los módulos viejos **no se tocan**; conviven las dos convenciones.
4. **Fuente de verdad = eventos**, no acumulados. La tabla `jornada_evento` es append-only con `NOW(3)` del servidor; los totales de `jornada` son caché derivada recalculable.
5. **Zona horaria**: la BD corre en UTC y el negocio en UTC-5. La "fecha laboral" se calcula en `America/Bogota`, nunca con `CURDATE()`.

Migraciones que introduce: `043` (roles + vínculo), `044` (tablas del módulo), `045` (parámetros).

Al final del documento hay **8 puntos pendientes de definir** con el negocio; los dos que pueden cambiar el esquema son si existen turnos que cruzan medianoche y si las horas extra necesitan clasificación de recargo para nómina.

### 8.3 Estado real de las migraciones (verificado contra la BD local)

- **La BD local va aplicada hasta la `045`** (módulo de asistencia: roles + vínculo, tablas, parámetros — aplicadas y verificadas en la sesión de implementación, ver §9).
- Hay **5 números duplicados** por los merges con los repos personales de David: `015` (x3), `016`, `026`, `027` y `028` (x2 cada uno).
- **`026_add_directivo_financiero_role.sql` es obsoleta — no ejecutarla.**
- Sigue sin haber runner ni tabla de control de migraciones aplicadas.

Antes de crear una migración nueva hay que mirar `ls migrations/` y tomar el siguiente número **realmente** libre, no asumir que el mayor + 1 está disponible.

### 8.4 Datos de prueba para asistencia — `scripts/seedEmpleadosAsistencia.js`

Script idempotente (si el empleado existe lo actualiza, no lo duplica) que reutiliza `UserCompany.create`/`update` y `User.create` en vez de escribir SQL propio, para que el alta pase por la misma transacción que usa la app.

Crea 1 director y 5 empleados a su cargo, con **todas** las tablas del módulo pobladas: `users_company`, `contrato`, `historial_salarial`, las 5 afiliaciones de `seguridad_social`, `cuenta_bancaria`, `direccion` y `contacto_emergencia`.

| users_company.id | Cédula | Nombre | Cargo | Jefe inmediato |
|---|---|---|---|---|
| 7 | 9000000001 | Marta Lucía Rondón Vega | Coordinador | — |
| 8 | 9000000002 | Andrés Felipe Cárdenas Mejía | Agente | 7 |
| 9 | 9000000003 | Laura Gutiérrez Osorio | Agente | 7 |
| 10 | 9000000004 | Julián David Moreno | Agente | 7 |
| 11 | 9000000005 | Daniela Sepúlveda Rojas | Agente | 7 |
| 12 | 9000000006 | Camilo Esteban Villamil Pardo | Agente | 7 |

Las cédulas van en el rango `90000000xx` para identificar y borrar fácil los datos de prueba.

Las cuentas de login (`director.operaciones`, `empleado1`…`empleado5`, clave `Prueba123*`)
**ya existen** y quedaron vinculadas vía `users.users_company_id` — se crearon en la sesión de
implementación del §9, una vez aplicada la migración `043`. El script sigue detectando si los
roles del ENUM existen antes de intentar crear los logins, para poder correrse también contra
una BD sin la `043` aplicada (crea solo las fichas de RRHH y avisa).

Nota: cada empleado quedó con **2 filas** en `historial_salarial` y 1 vigente, porque el script se corrió dos veces con salarios distintos y el modelo interpretó (correctamente) un cambio salarial, cerrando la vigencia anterior.

### 8.5 Bug encontrado: `contrato.piso` y `users_company.rut` no se guardan

Las migraciones `038`/`039` agregaron estas dos columnas, pero **`models/UserCompany.js` nunca las cableó**: no aparecen ni en `camposPersonales()` ni en el `INSERT`/`UPDATE` de `insertarContrato()`.

Consecuencia: aunque se envíen en el payload, siempre quedan en `NULL`. Afecta al formulario real de RRHH, no solo al script de pruebas. Detectado al verificar los empleados sembrados. **Sin corregir** — tocarlo implica modificar el módulo de empleados.

### 8.6 Frontend — modal "Ver perfil del empleado"

**Nuevo:** `src/components/EmpleadoPerfilModal.jsx` — modal de solo lectura con toda la información del empleado en 8 secciones: datos personales, dirección, información laboral (incluido jefe inmediato), salario vigente, seguridad social, cuenta bancaria, contacto de emergencia y tabla de activos asignados.

**Modificado:** `src/components/AgentManagement.jsx` — botón de ojo "Ver perfil" como primera acción de cada fila.

Detalle importante: `GET /users-company/:id` (`getByIdCompleto`) devuelve **IDs de catálogo, no nombres**, porque está pensado para alimentar el formulario de edición. El modal carga en paralelo empleado + `/catalogos` + `/:id/activos` y resuelve cada ID contra su catálogo, igual que hace `AgentForm.jsx`. No hizo falta ningún endpoint nuevo.

Ojo con los nombres de columna de `activos`: son `numero_placa`, `marca_modelo`, `numero_serie_fabricante` — no `placa`/`marca`/`modelo`.

**Estado de verificación:** `vite build` compila. El lint reporta `Icon is defined but never used`, que es un falso positivo del `eslint.config.js` del repo (no incluye el plugin de React, así que no ve los componentes usados en JSX); `AssetDetailModal.jsx:141` y `Tecnicos.jsx:486` tienen el mismo error con el mismo patrón, y el repo arrastra 53 errores de esa clase. **El modal no se ha probado en el navegador.**

Recordatorio operativo confirmado en esta sesión: correr `vite build` **modifica `dist/`, que está commiteado**. Tras compilar para verificar, hubo que revertirlo con `git checkout -- dist/ && git clean -fd dist/` para no dejar un build de desarrollo en el directorio que sirve nginx.

### 8.7 Estado de git al cierre de la sesión (planificación)

Rama `sebas-branch`. Sin commitear:

```
Backend:   CLAUDE.md, asistencia.md, .claude/, claude/,
           scripts/seedEmpleadosAsistencia.js,
           migrations/026_add_directivo_financiero_role.sql (modificado de antes)
Frontend:  src/components/EmpleadoPerfilModal.jsx (nuevo),
           src/components/AgentManagement.jsx (modificado)
```

---

## 9. Sesión 2026-09-15 (continuación) — Implementación completa del módulo de asistencia

Sesión posterior a la de §8, que tomó el plan de `asistencia.md` y lo implementó de punta a
punta: backend (Fases 0-4 y 6) y frontend (Fase 5). El detalle línea por línea de cada fase
—incluidas las desviaciones concretas respecto al plan— vive en **`asistencia.md` §14**, para
no duplicarlo aquí. Este apartado resume lo esencial para orientarse rápido.

**Backend — archivos nuevos:** `errors/AppError.js`, `middleware/{asyncHandler,errorHandler,
validar}.js`, `validators/asistenciaSchemas.js`, `utils/fechaBogota.js`,
`domain/asistencia/` (motor de cálculo + reglas + máquina de estados),
`repositories/asistencia/` (7 repos), `services/asistencia/` (7 servicios, incluido
`jornadaCalculo.js` compartido — no estaba en el plan), `controllers/asistencia/` (5
controllers), `routes/asistencia.js`, `tests/asistencia/` (26 tests, `node --test`),
`migrations/043-045`, `scripts/vincularUsuariosEmpleados.js`,
`scripts/cerrarJornadasDelDia.js`, `scripts/recalcularJornadas.js`.

**Backend — archivos modificados:** `index.js` (monta `/api/asistencia` + `errorHandler`),
`middleware/auth.js` (+3 middlewares de rol), `controllers/authController.js`
(`users_company_id` en el JWT), `package.json` (`test`, `cerrar-jornadas`,
`recalcular-jornadas`), `scripts/seedEmpleadosAsistencia.js` (bug corregido: pasaba
`departamento: 'Operaciones'`, valor inválido para el ENUM `users.departamento`).

**Frontend — archivos nuevos:** `src/hooks/useJornada.js`, `src/utils/fecha.js`,
`src/components/asistencia/` (13 componentes, incluido `TrazabilidadView.jsx` compartido —
tampoco estaba en el plan).

**Frontend — archivos modificados:** `src/services/api.js` (+`asistenciaService`),
`src/context/AuthContext.jsx` (+`isEmpleado`, `isDirectorOperaciones`), `src/App.jsx`
(+rutas `/asistencia/*` y `/operaciones/*`, +2 route guards).

**Bugs reales encontrados y corregidos durante la verificación** (no solo con los tests del
dominio — probando contra el servidor y el navegador reales):

1. Un evento posterior a la `salida` (p. ej. una corrección manual del director) generaba
   `minutos_pausa_bano` negativo — `calcularJornada` no defendía contra eventos fuera de la
   ventana `[entrada, fin]`.
2. La alerta `sin_marcar_salida` (prevista en el plan §7) nunca se generaba — el dominio no
   distinguía una `salida` real de una sintética del cierre automático.
3. `new Date(fechaPura).toLocaleDateString()` en el frontend mostraba el día anterior para
   campos `DATE` sin hora (MySQL los serializa como medianoche UTC; el navegador los
   reconvierte a su zona horaria local antes de formatear) — se vio en vivo en la bandeja de
   horas extra (una solicitud de "hoy" se mostraba fechada "ayer").
4. `scripts/seedEmpleadosAsistencia.js` fallaba al crear los logins de prueba: pasaba
   `departamento: 'Operaciones'`, que no existe en el ENUM `users.departamento`
   (`claro`/`majority`/`obama`) — bug preexistente al script, no de la migración 043.

**Verificado en vivo, no solo con tests:** ciclo completo entrada → baño → almuerzo → salida
contra el servidor real (curl/fetch); asignación masiva de horarios excluyendo el fin de
semana correctamente; aprobación/rechazo de horas extra con el estado reflejándose del lado
del empleado; cierre perezoso cerrando sola una jornada de un día anterior con la hora de
salida programada; y clicks reales en Chrome logueado como `empleado1` y
`director.operaciones` recorriendo las 9 pantallas del frontend.

**Decisión de negocio confirmada en esta sesión** (antes eran puntos abiertos en
`asistencia.md` §13): no existen turnos nocturnos por ahora, y las cuentas de login de
`empleado` las crea el admin a mano (no un flujo automático desde RRHH).

---

## 10. Sesión 2026-09-16 — Roles nuevos faltaban en la creación de usuarios del admin

El usuario reportó que, al crear un usuario `empleado` desde `/users` (admin), el módulo de
asistencia respondía `"Tu usuario no está vinculado a una ficha de RRHH"`. Causa: la
implementación del 2026-09-15 (§9) cubrió el ENUM de roles y los middlewares de
`middleware/auth.js`, pero **no agregó `director_operaciones`/`empleado` a la lista blanca
`validRoles` de `controllers/userController.js`** ni al selector de roles de
`UserManagement.jsx` — el admin ni siquiera podía elegir esos roles hasta que se corrigió esto
en la sesión. Detalle completo, línea por línea, en `asistencia.md` §15 (no se duplica aquí).

**Resumen de lo hecho:**
1. `director_operaciones`/`empleado` habilitados en `validRoles` (backend) y en el selector de
   `UserManagement.jsx` (frontend) — el gap que causaba el síntoma.
2. A pedido del usuario, se agregó además un flujo de vinculación directa: al crear/editar un
   usuario con esos roles, el admin elige la ficha de RRHH desde un selector nuevo
   (`GET /users-company?sin_usuario=true`, empleados aún sin cuenta vinculada) y la cuenta
   queda vinculada (`users.users_company_id`) en el mismo paso — ya no depende de correr
   `scripts/vincularUsuariosEmpleados.js` después, aunque el script sigue sirviendo para
   backfill masivo.

**Regla de `CLAUDE.md` corregida:** "un rol nuevo toca tres lugares" pasó a **cinco** —
además del ENUM, el middleware y el frontend (flag/layout/guard), hay que tocar la lista
blanca `validRoles` del backend y el selector de roles del admin en `UserManagement.jsx`. Es
el mismo gap que ya se había dado con `recursosHumanos` (`claude/modulo recursoshumanos.md`
§1.2), repetido porque la regla documentada no cubría esos dos lugares.

**Archivos tocados:** `controllers/userController.js`, `models/User.js`,
`models/UserCompany.js`, `controllers/userCompanyController.js` (backend);
`src/components/UserManagement.jsx`, `src/services/api.js` (frontend). Ninguno se registró
como nuevo — todos ya existían y se modificaron.

**Verificado:** `node -c` en los 4 archivos backend; `eslint` y `vite build --mode
development` en frontend sin errores nuevos (`dist/` restaurado tras el build, como exige
`CLAUDE.md`). **No probado en Chrome contra el backend real** — pendiente crear un `empleado`
de prueba end-to-end y confirmar que el error original ya no aparece.
