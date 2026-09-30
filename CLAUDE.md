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

`npm test` corre `node --test tests/**/*.test.js` — hoy solo cubre el dominio puro del módulo
de asistencia (26 tests, sin servidor ni base de datos). El resto del repo sigue sin pruebas.

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
- **Hay números duplicados** por merges con repos personales: `015` (×3), `016`, `026`, `027`
  y `028`. Antes de crear una migración, revisa `ls migrations/` y toma el siguiente número
  realmente libre.
- **`026_add_directivo_financiero_role.sql` es obsoleta — no la ejecutes.**
- La BD local va aplicada hasta la **058** (módulo de asistencia + campos/catálogos de RRHH —
  ver `claude/modulo recursoshumanos.md`). Ninguna migración desde la 043 está aplicada en
  producción todavía.

### Roles

Viven en el `ENUM` de `users.role`. **MySQL no permite agregar un valor suelto**: para
sumar un rol hay que **reescribir el ENUM completo** con todos los valores anteriores —
ver `migrations/037_add_recursos_humanos_role.sql` como plantilla.

Roles vigentes: `admin`, `supervisor`, `coordinador`, `jefe_operaciones`, `technician`,
`administrativo`, `anonimo`, `gestorActivos`, `tecnicoInventario`, `directivoFinanciero`,
`disenador`, `recursosHumanos`, `director_operaciones`, `empleado` (estos dos últimos,
migración 043, módulo de asistencia).

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

`node scripts/seedEmpleadosAsistencia.js` crea 1 director y 5 empleados a su cargo con todas
las tablas del módulo de empleados pobladas (cédulas `9000000001`–`9000000006`,
`users_company.id` 7–12), más sus cuentas de login (`director.operaciones`, `empleado1`…
`empleado5`, clave `Prueba123*`) ya vinculadas vía `users.users_company_id`. Es idempotente.

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
- ⚠️ **El `dist/` del frontend está commiteado.** Un `git pull` en producción **sin**
  `npm install && npm run build` deja servida una versión vieja. Ya causó un bug real con el
  rol `disenador`. Todo pull al frontend va seguido de rebuild, sin excepción.

## Documentación del proyecto

| Archivo | Contenido |
|---|---|
| [`asistencia.md`](asistencia.md) | Plan del módulo de asistencia — **implementado** (backend Fases 0-4 y 6, frontend Fase 5) |
| [`claude/contextoriginal.md`](claude/contextoriginal.md) | Contexto completo de ambos repos, módulos, despliegue |
| [`claude/modulo recursoshumanos.md`](claude/modulo%20recursoshumanos.md) | Detalle del módulo de empleados/RRHH |
| `context/CONTEXT.md` | Detalle estable de incidentes, activos y analíticas (algo desactualizado) |
| `database/gestor.sql` | Dump de referencia del esquema |
