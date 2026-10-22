# CLAUDE.md

Backend del **Gestor Técnico** (Asiste Ingeniería): soporte técnico, inventario de activos,
empleados/RRHH, diseños y chat, para un call center con sedes en Bogotá, Barranquilla y
Villavicencio.

## Stack

Node.js 24 · **Express 5** · MySQL vía `mysql2` (pool de 10, **sin ORM**) · JWT en header
`x-auth-token` (expira 5 h) · Socket.IO 4 · multer · bcryptjs.
Puerto **5001**. Base de datos **`call_center_support`**.

```bash
npm run dev     # nodemon, NODE_ENV=development
npm start       # NODE_ENV=production
```

`npm test` corre `node --test tests/**/*.test.js` — hoy cubre el dominio puro del módulo de
asistencia, de la conexión con Hydra y de la integración AsisLock, más las reglas de campos por tipo de traspaso y de la pantalla gris de AsisLock y del reporte de horas extras y de la clasificación automática de la hora extra y de las pausas de AsisLock y del relato de hora extra en la trazabilidad y del resumen mensual del equipo (196 tests, sin servidor ni base de datos). `npm run test:e2e` es la prueba de punta a punta de asistencia contra el backend y la BD local (127 checks, ver `asistencia.md` §20, §23-§26 y §30). El resto del repo
sigue sin pruebas.

## Arquitectura

Patrón vigente en los 13 módulos existentes, de dos capas:

```
routes/<modulo>.js  →  controllers/<modulo>Controller.js  →  models/<Modelo>.js  →  MySQL
```

- `models/` son clases con métodos **estáticos async** que escriben SQL directo.
- Los controllers mezclan validación, reglas y respuesta HTTP, cada método con su propio
  `try/catch → console.error → res.status(500)`.
- Las transacciones se hacen a mano con `db.getConnection()` + `beginTransaction()`
  (ver `models/Incident.js` y `models/UserCompany.js`).
- Un módulo nuevo **no existe** hasta que se registra en `index.js` con `app.use('/api/...')`.

**Excepción — módulo de asistencia**: está implementado (backend y frontend completos) en
cuatro capas (`domain/` → `repositories/` → `services/` → `controllers/asistencia/`), montado
en `app.use('/api/asistencia', ...)`. Ver [`asistencia.md`](asistencia.md) (incluye notas de
implementación al final de cada fase) y la skill `.claude/skills/arquitectura-asistencia/`.
No apliques el patrón de dos capas ahí, ni el de cuatro capas en los módulos viejos.

## Reglas que hay que conocer antes de tocar nada

### Migraciones

- **No hay runner.** Los `.sql` de `migrations/` se aplican **a mano** en orden numérico.
  Nada registra cuáles ya corrieron.
- **Collation distinto en producción:** `users` y `users_company` son `utf8mb4_unicode_ci` en
  producción y una tabla nueva toma el default del servidor (`utf8mb4_0900_ai_ci`). Comparar texto
  entre ellas da el error 1267 (pasó con la 065, `asistencia.md` §26): en migraciones, comparar con
  `BINARY` o `COLLATE` explícito. En local todo es `0900`, así que no se ve.
- **Hay números duplicados** por merges con repos personales: `015` (×3), `016`, `026`, `027`
  y `028`. Antes de crear una migración, revisa `ls migrations/` y toma el siguiente número
  realmente libre.
- **`026_add_directivo_financiero_role.sql` es obsoleta — no la ejecutes.**
- La BD local va aplicada hasta la **077** (077 = `hora_extra.creado_en`: marca de cuándo se solicitó la hora extra, para el relato de la trazabilidad —fase 2 de §34: la traza muestra la solicitud/aprobación, la hora real de ingreso al tiempo extra y el desborde; un login tras la salida dentro de una franja de hora extra aprobada reabre la jornada como `inicio_extra` en vez de ignorarse—; `asistencia.md` §34, **pendiente en producción, después de 074**; 076 = pausas de AsisLock: el Gestor interpreta los estados `Break`, `Almuerzo`, `Capacitación`, `Baño` que AsisLock manda en `estado_conexion` —antes solo Conectado/Desconectado y las pausas se marcaban en el portal—; agrega los tipos de evento `inicio_break/fin_break` e `inicio_capacitacion/fin_capacitacion` y las columnas `jornada.minutos_break`/`minutos_capacitacion`; baño/break/almuerzo descuentan del tiempo trabajado, **capacitación cuenta como laborada**; `asistencia.md` §34, **pendiente en producción, va después de 071**; 075 = usuarios de pantalla gris de AsisLock sin cambio de contraseña obligatorio: la clave por defecto = cédula se queda y no se pide cambiarla —`debe_cambiar_password` DEFAULT 0 y apagada en los ya creados—, para que el agente no quede bloqueado si la olvida; no toca `cuenta_empleado`; `asistencia.md` §31, **pendiente en producción**; 074 = clasificación automática de la hora extra: el agente ingresa la franja —hora inicio/fin— y el servidor determina la clase según turno, umbral nocturno con vigencia —reforma Ley 2466/2025 a las 7 p.m.— y festivos; agrega `hora_extra.hora_inicio/hora_fin`, la tabla de tramos `hora_extra_tramo`, `festivo_colombia` 2025-2030 y `ventana_nocturna`; `asistencia.md` §32, **pendiente en producción, va DESPUÉS de 072+073**; 073 = `hora_extra.clase` y reporte de horas extras automático —el jefe ya no lo envía, financiera lo ve en vivo con el dinero por campaña— que elimina las tablas de la 072, `asistencia.md` §32, **pendiente en producción**; 072 = rol `financiera` (ENUM de `users.role`; sus tablas las borra la 073), `asistencia.md` §32, **pendiente en producción, y 072+073 deben correr ANTES de subir el código**: sin el valor en el ENUM no se puede crear el usuario; 071 = usuarios de la pantalla gris de AsisLock y outbox de avisos a AsisLock, `asistencia.md` §31, **aplicada en producción el 2026-10-21** con el backfill de 390 usuarios; 070 = traspasos por tipo con documentos y alertas a la campana del portal de asistencia, `claude/modulo recursoshumanos.md` §35, **pendiente en producción**; 069 = tipos de novedad oficiales y soportes documentales por tipo, archivos en `storage/novedades/`, `claude/modulo recursoshumanos.md` §34, **pendiente en producción**; 068 = EPS/AFP/cesantías/cajas/ARL oficiales con columna `vigente` y duplicados unificados, `claude/modulo recursoshumanos.md` §33, **pendiente en producción**; 065 = cuentas de empleado en su propia tabla `cuenta_empleado`, fuera de `users` — `asistencia.md` §24; 066 = plantillas de horario con dueño, cada jefe ve solo las suyas — §25; 067 = `users.activo` y desactivación de las cuentas `director_operaciones`, los jefes entran con su cédula — §26; **las tres aplicadas en producción el 2026-10-20** junto con el código — ver el final de §26). Antes, hasta la **064** (062 = integración AsisLock → asistencia, §18; 063 = cuentas de empleado automáticas, §19; 064 = copia de `login_biometrico` de AsisLock, §21 de `asistencia.md`; **las tres aplicadas en producción el 2026-10-19** vía `migraciones_produccion_062_064.sql` — la 062 ya estaba, 063 y 064 entraron ese día; el código —backend `4cfc7e6`, frontend `9bb3f2f`— se desplegó también ese día y AsisLock ya registra jornadas en producción. **Pendientes vigentes de asistencia/AsisLock: `asistencia.md` §28**). Antes iba hasta la **061** (módulo de asistencia + campos/catálogos de RRHH —
  ver `claude/modulo recursoshumanos.md`; 059-061 son el staging de la conexión con Hydra, ver
  [`conexionhydra.md`](conexionhydra.md), **todavía no aplicadas en producción**). **Producción, desde el 2026-10-01, también tiene
  043-058 aplicadas** (043-048, 050-053, 055, 056, 058 corridas tal cual + un `CREATE TABLE
  salario_referencia` vacío agregado a mano porque `getCatalogos()` la consulta sin try/catch —
  ver `claude/modulo recursoshumanos.md` §29.3) — **excepto 049, 054 y 057**, que tienen IDs
  quemados contra el estado de la BD local y siguen pendientes de resembrar contra los IDs reales
  de producción. Producción también recibió los 389 empleados reales vía un `.sql` generado
  aparte (nunca commiteado, PII real — ver §29.5-29.6), así que sus catálogos (`cliente`,
  `campania`, `cargo`, `centro_costo`, `oleada`, `ciudad`, `entidad_seguridad_social`) ya no son
  solo el seed genérico de 035/036.

### Roles

Viven en el `ENUM` de `users.role`. **MySQL no permite agregar un valor suelto**: para
sumar un rol hay que **reescribir el ENUM completo** con todos los valores anteriores —
ver `migrations/037_add_recursos_humanos_role.sql` como plantilla.

Roles vigentes: `admin`, `supervisor`, `coordinador`, `jefe_operaciones`, `technician`,
`administrativo`, `anonimo`, `gestorActivos`, `tecnicoInventario`, `directivoFinanciero`,
`disenador`, `recursosHumanos`, `director_operaciones`, `empleado` (estos dos últimos,
migración 043, módulo de asistencia), `financiera` (migración 072: todo RRHH, reportes de horas
extras de los jefes y trazabilidad por campaña, `asistencia.md` §32). **`director_operaciones` ya no se crea** (§26): sus cuentas
quedaron desactivadas (`users.activo = 0`, migración 067) y los jefes gestionan su equipo con su
cuenta por cédula.

**Para asistencia no se crean roles:** quién gestiona un equipo sale de `contrato.jefe_area_id`
(middleware `canDirigirEquipo`, §23) y cada empleado entra con su cuenta por cédula de
`cuenta_empleado` (§24), no de `users`.

Un rol nuevo toca **cinco lugares**, y si falta uno el rol queda a medias:
1. el ENUM en una migración,
2. un middleware en `middleware/auth.js` (patrón `verifyRole([...])`),
3. la lista blanca `validRoles` en `controllers/userController.js` (`createUser` y
   `updateUser`) — sin esto el ENUM ya lo acepta pero el admin no puede crear el usuario desde
   `/users`. **Se nos olvidó con `director_operaciones`/`empleado`** (vivieron desde la
   migración 043 sin poder crearse desde el panel, hasta corregirlo el 2026-09-16 — ver
   `asistencia.md` §15),
4. el frontend: flag en `AuthContext.jsx`, layout y guard en `App.jsx`,
5. el selector de rol en `UserManagement.jsx` (array `roles` + `<option>` del filtro), o el
   admin tampoco puede elegirlo al crear/editar un usuario.

Si además el rol necesita quedar vinculado a una ficha de RRHH (como `director_operaciones`/
`empleado`, vía `users.users_company_id`), agregarlo también a `ROLES_VINCULADOS_A_EMPLEADO`
en `userController.js` y en `UserManagement.jsx` — así el admin elige la ficha desde un
selector al crear la cuenta, en vez de crearla huérfana y tener que correr
`scripts/vincularUsuariosEmpleados.js` después. Detalle en `asistencia.md` §15.

### Zona horaria

`config/db.js` fuerza `timezone: '+00:00'` y cada conexión ejecuta `SET time_zone = '+00:00'`.
**La BD está en UTC; el negocio opera en Colombia (UTC-5, sin horario de verano).**
`NOW()` y `CURDATE()` devuelven UTC: entre las 19:00 y las 23:59 hora local, `CURDATE()` ya
está en el día siguiente. Cualquier lógica con fechas de negocio debe convertir explícitamente.

### Seguridad

- `.env` tiene `DB_PASSWORD` y `JWT_SECRET` en claro. Está en `.gitignore`; **no lo edites ni
  vuelques su contenido.**
- Todo SQL va **parametrizado con `?`**. Nunca interpoles valores en la cadena de la consulta,
  tampoco al armar filtros dinámicos.

### Módulo legacy

`routes/agentes.js`, `controllers/agenteController.js` y `models/Agente.js` **no están
registrados en `index.js`**. Son el módulo "agentes" que reemplazó `users_company`
(empleados). No los uses como referencia.

## Datos de prueba

`node scripts/seedEmpleadosAsistencia.js` crea 1 jefe de área y 5 empleados a su cargo con todas
las tablas del módulo de empleados pobladas (cédulas `9000000001`–`9000000006`,
`users_company.id` 7–12), más sus logins con clave `Prueba123*`: el jefe entra con su cuenta por
cédula `9000000001` (`cuenta_empleado`, §26) y los empleados con `empleado1`…`empleado5` (en
`users`, vinculados vía `users.users_company_id`). La antigua `director.operaciones` quedó
desactivada por la 067. Es idempotente.

`node scripts/crearCuentasEmpleados.js [--aplicar]` crea la cuenta de empleado (usuario y clave inicial = cédula, cambio obligatorio al primer ingreso) de cada ficha vigente sin cuenta; los empleados nuevos la reciben solos al registrarse — ver `asistencia.md` §19. **Desde la 065 esas cuentas viven en `cuenta_empleado`, no en `users`** (§24): su sesión lleva `tipo_cuenta: 'empleado'`, su `id` no es un `users.id` y `verifyToken` la limita a `/api/auth` y `/api/asistencia`. No escribas cuentas de empleado en `users`. Todo empleado con gente a cargo (`contrato.jefe_area_id`) gestiona su equipo sin importar su rol (§23).

`node scripts/vincularUsuariosEmpleados.js` hace el backfill de `users.users_company_id` por
nombre normalizado para usuarios ya existentes; reporta los que no matchean para resolver a
mano. Sigue sirviendo para backfill masivo, pero desde el 2026-09-16 ya no es el único camino:
crear un usuario `director_operaciones`/`empleado` desde `/users` (admin) pide elegir la ficha
de RRHH en el momento y lo vincula directo — ver `asistencia.md` §15.
`node scripts/cerrarJornadasDelDia.js` (cron 23:30 Bogotá) y
`node scripts/recalcularJornadas.js` son del cierre diario de asistencia — ver `asistencia.md` §10.

## Frontend

Repo hermano, **no es un monorepo**:
`C:\Users\juan.acosta\Desktop\FrontGestor\gestor-tecnico-frontend`
React 18 + Vite 7 + Tailwind 3 + axios + socket.io-client.

El contrato entre ambos repos es **manual**: no hay OpenAPI ni tipos compartidos. Un endpoint
nuevo en `routes/` exige su `*Service` correspondiente en `src/services/api.js`.

Ojo al mostrar datos de empleado: `GET /users-company/:id` devuelve **IDs de catálogo, no
nombres** (está pensado para el formulario de edición). Para mostrarlos hay que cargar también
`GET /users-company/catalogos` y resolverlos, como hacen `AgentForm.jsx` y
`EmpleadoPerfilModal.jsx`.

## Git y despliegue

- Remotos: `origin` (`asisteingenieria/gestor-tecnico-backend`) y `davidzarate`
  (repo personal con historia divergente, origen de las migraciones duplicadas).
- Producción: servidor `srv845606`. Backend en `/root/gestor-tecnico-backend` bajo **pm2**
  (`gestor-backend`); frontend en `/var/www/gestor-tecnico-frontend` servido por **nginx**
  desde `dist/`.
- ⚠️ **El `dist/` del frontend YA NO se versiona** (desde el 2026-10-22, frontend `9bcc5a6`, aún
  pendiente de merge/despliegue): está en `.gitignore` y lo genera `npm run build`. Esto quitó el
  choque de cada despliegue (`local changes to dist/index.html would be overwritten by merge`).
  **Todo pull al frontend sigue yendo seguido de `npm install && npm run build`, sin excepción**: sin
  el rebuild, nginx sirve el `dist/` viejo que quedó en el server (antes el pull sin build ya causó
  un bug real con el rol `disenador`). En el primer despliegue de este cambio, el server todavía
  tiene el `dist/` viejo trackeado y con cambios locales: hacer `git reset --hard HEAD` antes del
  pull, luego el pull (que borra el `dist/` versionado) y `npm run build` (que lo regenera). De ahí
  en adelante el pull no vuelve a tocar `dist/`.

## Documentación del proyecto

| Archivo | Contenido |
|---|---|
| [`asistencia.md`](asistencia.md) | Plan del módulo de asistencia — **implementado** (backend Fases 0-4 y 6, frontend Fase 5) |
| [`conexionhydra.md`](conexionhydra.md) | Plan de la conexión Hydra → RRHH (contratación) — **desplegado el 2026-10-11: Hydra completo; en Gestor, pull y `.env` hechos, falta confirmar las migraciones 059-061 y la verificación, ver §14.8** (Fases 1-8.5: backends de Gestor e Hydra, pantallas de RRHH en `src/components/contratacionHydra/` con la ruta `/recursos-humanos/contratacion-hydra`, y la pantalla "Contratación" en el frontend de Hydra; despliegue (Fase 9): guía en §14, estado en §14.8; antes de activar en un servidor: `npm run verificar-hydra`). Las reglas de catálogos de `AgentForm.jsx` están copiadas en `src/utils/catalogosRRHH.js` del frontend: si cambia una, hay que cambiar la otra. Las pruebas entre las dos apps se hacen primero en local con ambos backends corriendo (§13.6). API de RRHH en `/api/contratacion-hydra`; API máquina-a-máquina en `/api/integraciones/hydra/v1`, montada antes de `express.json()`; requiere `HYDRA_API_KEY`/`HYDRA_HMAC_SECRET` en `.env` (sin ellas responde 503). Avisos a Hydra por outbox: `node scripts/despacharEnviosHydra.js` (cron cada minuto; usa `HYDRA_CALLBACK_URL`/`_API_KEY`/`_HMAC_SECRET`). `UserCompany.create` ahora envuelve `crearEnConexion(conn, data)` y `validarObligatorios` vive en `utils/validarEmpleado.js`. Prueba local de Gestor solo: `node scripts/simularEnvioHydra.js` |
| [`claude/contextoriginal.md`](claude/contextoriginal.md) | Contexto completo de ambos repos, módulos, despliegue |
| [`claude/modulo recursoshumanos.md`](claude/modulo%20recursoshumanos.md) | Detalle del módulo de empleados/RRHH |
| [`docs/asislock/API_AsisLock.md`](docs/asislock/API_AsisLock.md) | Contrato de la API AsisLock → asistencia, para el equipo de AsisLock (`asistencia.md` §18) |
| `context/CONTEXT.md` | Detalle estable de incidentes, activos y analíticas (algo desactualizado) |
| `database/gestor.sql` | Dump de referencia del esquema |
