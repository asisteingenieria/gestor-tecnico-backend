# Módulo de Asistencia — Plan de implementación

Estado: **implementado y en producción**. Backend (Fases 0-4 y 6) y frontend (Fase 5) completos y
probados contra el servidor real. Mapa de las sesiones posteriores al plan:
- §14 qué se construyó y en qué se desvió del plan · §15 creación de `director_operaciones`/`empleado`
  desde el admin (2026-09-16) · §16 la jerarquía es `jefe_area_id` (2026-09-23) · §17 rediseño
  "Opción C", endpoint `mis-jornadas` y dos bugs (2026-09-24/25).
- §18 integración AsisLock (062) · §19 cuentas de empleado por cédula (063) · §20 prueba E2E ·
  §21 copia de `login_biometrico` e id opcional (064) · §22 despliegue del 2026-10-19 y ficha 1010.
- **2026-10-20:** §23 todo jefe de área gestiona su equipo sin rol · §24 cuentas de empleado en su
  propia tabla `cuenta_empleado` (065) · §25 plantillas por jefe (066) y tres arreglos de interfaz ·
  §26 fin de las cuentas `director_operaciones` (067) y **despliegue en producción** · §27
  "Seleccionar todos" y asignación masiva en una transacción.
- **Pendientes vigentes: §28** (reemplaza la lista de §22).
Fecha del plan: 2026-09-15 · Fecha de implementación: 2026-09-15
Repos involucrados:
- Backend: `C:\Users\juan.acosta\Desktop\BackGestor\gestor-tecnico-backend`
- Frontend: `C:\Users\juan.acosta\Desktop\FrontGestor\gestor-tecnico-frontend`

---

## 1. Objetivo

Módulo de control de asistencia con dos roles nuevos:

- **`director_operaciones`**: crea horarios para los empleados a su cargo, aprueba o asigna
  horas extra, ve la trazabilidad completa de su equipo y **registra su propia asistencia**
  igual que un empleado.
- **`empleado`**: al iniciar sesión marca su entrada según el horario asignado, ve un contador
  en vivo del tiempo laborado, pausa con los botones **Baño** y **Almuerzo**, cierra el turno
  con el botón **Salida** (habilitado 10 min antes del fin de turno) y al final del día
  consulta la trazabilidad completa de su jornada.

---

## 2. Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Vínculo login ↔ empleado | Nueva columna `users.users_company_id` (FK nullable a `users_company`) |
| Jerarquía director → empleados | Se lee de `contrato.jefe_area_id` del contrato activo (corregido 2026-09-23, ver §16 — la decisión original de esta fila era `jefe_inmediato_id`) |
| Fuente de verdad del contador | **Backend**, a partir de eventos con timestamp de servidor; el total se recalcula en cada consulta, nunca se guarda un acumulado mutable |
| Alcance | Backend + frontend |

### 2.1 Zona horaria (crítico)

`config/db.js` fuerza `timezone: '+00:00'` y cada conexión ejecuta `SET time_zone = '+00:00'`.
Colombia es **UTC-5 sin horario de verano**.

Regla del módulo:
- Todo `DATETIME` de evento se guarda en **UTC**.
- La **fecha laboral** (`jornada.fecha`, `horario_asignado.fecha`) es un `DATE` calculado en
  **America/Bogota** — nunca `CURDATE()` del servidor, porque entre 19:00 y 23:59 hora Bogotá
  el UTC ya está en el día siguiente.
- Las horas de horario (`hora_entrada`, `hora_salida`) se guardan como `TIME` **en hora local
  de Bogotá** y se combinan con `fecha` para producir el instante UTC comparable.
- Helper único: `utils/fechaBogota.js`. Ningún controller hace aritmética de fechas a mano.

---

## 3. Arquitectura en capas

### 3.1 Punto de partida

El repositorio hoy tiene **dos capas**: `routes → controllers → models`, donde el modelo es
una clase con métodos estáticos que escribe SQL directo, y el controller mezcla validación de
entrada, reglas de negocio, acceso a datos y armado de la respuesta HTTP. El resultado son
controllers de 400–1300 líneas (`controllers/incidentController.js` tiene 1347) con el mismo
bloque `try/catch → console.error → res.status(500)` repetido en cada método.

Asistencia tiene más lógica de dominio que cualquier módulo existente (cálculo de tiempos,
máquina de estados de la jornada, autorización jerárquica, zona horaria). Replicar el patrón
actual produciría otro controller inmanejable e imposible de probar.

**Decisión: este módulo se implementa en cuatro capas**, dentro de sus propias carpetas, sin
tocar la estructura de los módulos existentes. Convive con la convención actual en lugar de
imponer una refactorización global.

### 3.2 Las capas

```
HTTP
 │
 ▼
routes/asistencia.js ──────────── Capa 1 · Enrutamiento
 │   · define rutas y las encadena con middlewares
 │   · verifyToken + verifyRole + validador del DTO
 │   · NO contiene lógica
 ▼
controllers/asistencia/*.js ───── Capa 2 · Controlador (adaptador HTTP)
 │   · traduce req → argumentos de dominio
 │   · invoca UN método de servicio
 │   · traduce el resultado → código HTTP + JSON
 │   · NO tiene SQL, NO tiene reglas de negocio, NO tiene try/catch propio
 ▼
services/asistencia/*.js ──────── Capa 3 · Servicio (reglas de negocio)
 │   · orquesta el caso de uso completo
 │   · aplica las reglas de §7 y la autorización jerárquica
 │   · abre y cierra las transacciones
 │   · lanza errores de dominio tipados
 │   · NO conoce req/res, NO escribe SQL
 ▼
repositories/asistencia/*.js ──── Capa 4 · Repositorio (acceso a datos)
 │   · único lugar con SQL del módulo
 │   · recibe opcionalmente una `connection` para participar de una transacción
 │   · devuelve objetos planos, sin lógica
 ▼
MySQL
```

Transversal a todas, sin dependencias hacia arriba:

```
domain/asistencia/     · motor de cálculo puro y reglas sin E/S (§6)
utils/fechaBogota.js   · conversión de zona horaria
errors/                · clases de error de dominio
```

**Regla de dependencia**: cada capa solo conoce la que tiene debajo. El dominio no conoce a
nadie. Esto es lo que permite probar el cálculo de tiempos sin base de datos ni servidor.

### 3.3 Responsabilidad de cada capa, en concreto

| Capa | Sí hace | No hace |
|---|---|---|
| **Ruta** | Declarar verbo, path, middlewares de auth y validación | Lógica, acceso a datos |
| **Controller** | Extraer `req.user`, `req.params`, `req.body`; llamar al servicio; elegir el código HTTP | SQL, cálculos, validación de negocio, `try/catch` (lo cubre el manejador central) |
| **Servicio** | Reglas, autorización, transacciones, emisión de eventos de socket | Tocar `req`/`res`, escribir SQL |
| **Repositorio** | `SELECT`/`INSERT`/`UPDATE` parametrizados, mapeo fila → objeto | Decidir nada |
| **Dominio** | Cálculo puro, máquina de estados, validación de invariantes | E/S de cualquier tipo |

### 3.4 Ejemplo: `POST /api/asistencia/mi-jornada/pausa`

```js
// routes/asistencia.js — Capa 1
router.post('/mi-jornada/pausa',
    canRegistrarAsistencia,
    validar(iniciarPausaSchema),
    asyncHandler(marcajeController.iniciarPausa)
);

// controllers/asistencia/marcajeController.js — Capa 2
async function iniciarPausa(req, res) {
    const jornada = await marcajeService.iniciarPausa({
        usersCompanyId: req.user.users_company_id,
        tipo: req.body.tipo,
        contexto: { ip: req.ip, userAgent: req.get('user-agent'), io: req.io }
    });
    res.json(jornada);
}

// services/asistencia/marcajeService.js — Capa 3
async function iniciarPausa({ usersCompanyId, tipo, contexto }) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // bloqueo de fila: evita que un doble clic genere dos pausas
        const jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, conn);
        if (!jornada) throw new ConflictoJornadaError('No hay una jornada iniciada');

        const eventos = await eventoRepo.findByJornada(jornada.idjornada, conn);
        const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, jornada.fecha, conn);

        // la decisión la toma el dominio, no el servicio
        const estado = calcularJornada(eventos, horario, new Date());
        assertPuedeIniciarPausa(estado, tipo);   // lanza ReglaAsistenciaError

        await eventoRepo.insertar({ jornadaId: jornada.idjornada, tipo: `inicio_${tipo}` }, conn);
        await jornadaRepo.actualizarTotales(jornada.idjornada, estado, conn);

        await conn.commit();
        notificarDirector(contexto.io, usersCompanyId, `inicio_${tipo}`);
        return await consultaService.estadoDeHoy(usersCompanyId);
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

// repositories/asistencia/jornadaEventoRepository.js — Capa 4
async function insertar({ jornadaId, tipo, origen = 'empleado', ... }, conn = db) {
    const [r] = await conn.query(
        `INSERT INTO jornada_evento (jornada_id, tipo, ocurrido_en, origen, registrado_por_user_id, ip, user_agent)
         VALUES (?, ?, NOW(3), ?, ?, ?, ?)`,
        [jornadaId, tipo, origen, registradoPor, ip, userAgent]
    );
    return r.insertId;
}
```

Nótese que el `NOW(3)` vive en el repositorio (es un detalle de persistencia), el bloqueo
transaccional en el servicio (es una decisión de consistencia) y la regla "no puede haber dos
pausas abiertas" en el dominio (es una invariante del negocio).

### 3.5 Manejo de errores

Se introducen errores de dominio con código HTTP asociado, y **un solo** manejador central.
Esto elimina los ~40 bloques `try/catch` idénticos que el patrón actual habría exigido.

```js
// errors/AppError.js
class AppError extends Error {
    constructor(mensaje, statusCode = 400, codigo = 'ERROR') { ... }
}
class NoAutorizadoError    extends AppError { /* 403 */ }
class NoEncontradoError    extends AppError { /* 404 */ }
class ConflictoJornadaError extends AppError { /* 409 */ }
class ReglaAsistenciaError extends AppError { /* 422 */ }
```

```js
// middleware/errorHandler.js  (montado al final de index.js)
module.exports = (err, req, res, next) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({ success: false, codigo: err.codigo, message: err.message });
    }
    console.error('[asistencia]', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
};
```

`asyncHandler(fn)` envuelve cada controller para que un `await` rechazado llegue al manejador
en vez de colgar la petición — necesario porque Express 5 sí propaga promesas rechazadas pero
el módulo no debe depender de ese detalle.

> El `errorHandler` se monta después de todas las rutas existentes. Como los demás módulos ya
> responden sus propios errores, no cambia su comportamiento; solo captura lo que hoy quedaría
> sin manejar.

### 3.6 Validación de entrada

La validación de forma (tipos, requeridos, rangos, formato de fecha) se declara por endpoint
y se aplica como middleware, **antes** del controller. La validación de negocio (¿puede pausar
ahora?) vive en el dominio. Son cosas distintas y no se mezclan.

```js
// validators/asistenciaSchemas.js
const iniciarPausaSchema = {
    body: { tipo: { requerido: true, enum: ['bano', 'almuerzo'] } }
};
const asignarHorarioSchema = {
    body: {
        empleados:   { requerido: true, tipo: 'array', minimo: 1 },
        desde:       { requerido: true, tipo: 'fecha' },
        hasta:       { requerido: true, tipo: 'fecha' },
        dias_semana: { tipo: 'array', valores: [1,2,3,4,5,6,7] },
        plantilla_id:{ tipo: 'entero' }
    }
};
```

Se implementa con un validador propio de ~60 líneas (`middleware/validar.js`) para no agregar
dependencias al `package.json`. Si más adelante se acepta una librería, `zod` o `joi` sustituyen
el archivo sin tocar rutas ni controllers.

### 3.7 Por qué esta arquitectura y no la actual

| Problema del patrón vigente | Cómo lo resuelve el de capas |
|---|---|
| El cálculo de tiempos quedaría enterrado en un controller y sería imposible de probar | Vive en `domain/`, es una función pura y se prueba sin servidor |
| La misma regla se duplicaría en el endpoint en vivo y en el cierre nocturno | Ambos llaman a la misma función de dominio |
| El script de cierre nocturno necesitaría re-implementar la lógica o simular un `req` | Llama directo al servicio; el servicio no conoce HTTP |
| `try/catch` + `res.status(500)` repetido en cada método | Un manejador central y errores tipados |
| Cambiar una consulta obliga a buscar SQL disperso entre controller y modelo | Todo el SQL del módulo está en `repositories/` |
| La autorización jerárquica se olvidaría en algún endpoint | Un único `assertEmpleadoACargo` en el servicio, invocado por todos los casos de uso del director |

---

## 4. Buenas prácticas aplicadas

**Diseño**
1. **Responsabilidad única por archivo**: un servicio por área funcional (`marcajeService`,
   `horarioService`, `horaExtraService`, `consultaService`), no un archivo con todo.
2. **Dominio sin E/S**: el motor de cálculo no importa `db`, ni `Date.now()` implícito — el
   instante de corte se le pasa como parámetro. Eso lo hace determinista y probable.
3. **Una sola definición de cada regla**. "Tiempo laborado", "llegada tarde" y "puede marcar
   salida" se calculan en un único lugar; el frontend nunca los recalcula, solo los muestra.
4. **Inyección de la conexión**: todo repositorio acepta `conn = db`, de modo que el mismo
   método sirve dentro y fuera de una transacción.
5. **Eventos inmutables**: `jornada_evento` no se actualiza ni se borra nunca; una corrección
   es un evento nuevo con autor y nota. La auditoría es una propiedad del modelo, no un extra.

**Corrección**
6. **Consultas siempre parametrizadas** (`?`), nunca interpolación de strings. Aplica también
   a los filtros dinámicos de los reportes, que se arman como lista de condiciones + arreglo
   de parámetros.
7. **Transacciones donde hay más de una escritura**: marcar un evento y actualizar los totales
   de la jornada ocurren juntos o no ocurren.
8. **Bloqueo optimista/pesimista en el marcaje**: `SELECT ... FOR UPDATE` sobre la fila de
   `jornada`, para que un doble clic o dos pestañas abiertas no generen dos eventos `entrada`.
9. **Idempotencia** en `POST /mi-jornada/entrada`: llamarlo dos veces no duplica el marcaje.
10. **Autorización en el servidor, siempre**. Ningún endpoint confía en que el front escondió
    un botón. El flag `puede_marcar_salida` es una ayuda visual; la validación real está en §7.
11. **Timestamps del servidor exclusivamente** (`NOW(3)`). El cliente nunca envía la hora.
12. **Zona horaria centralizada** en `utils/fechaBogota.js`; prohibido hacer aritmética de
    fechas en controllers o servicios.

**Mantenibilidad**
13. **Convenciones del repositorio**: español, `snake_case` en base de datos, `camelCase` en
    JavaScript, mensajes de error en español, respuestas con la forma
    `{ success, message, ...datos }` que ya usan los demás módulos.
14. **Sin números mágicos**: los 10 minutos del botón de salida, la tolerancia de entrada y
    los límites de pausa salen de la tabla `asistencia_parametro` (§5), no de literales
    dispersos por el código.
15. **Migraciones idempotentes y versionadas**, con la sección `-- UP` y el `DROP TABLE IF
    EXISTS` correspondiente, igual que la 034.
16. **Índices declarados desde el inicio** para los patrones de consulta reales (por empleado
    y rango de fechas, por estado, por jornada).
17. **Pruebas del dominio**: casos borde del motor de cálculo (turno que cruza medianoche,
    pausa sin cerrar, salida anticipada, extra sin aprobar, doble pausa) como archivos
    ejecutables bajo `tests/`. Hoy `npm test` no existe; se agrega para este módulo con el
    runner nativo de Node (`node --test`), sin dependencias nuevas.
18. **Contrato de API documentado** en §8 antes de escribir el frontend, para que ambos lados
    avancen en paralelo.

---

## 5. Modelo de datos

### Migración `043_add_asistencia_roles_y_vinculo_empleado.sql`

```sql
-- 1. Reescribir el ENUM de roles (MySQL no permite agregar un valor suelto).
--    Se conserva la lista completa vigente tras la migración 037.
ALTER TABLE users MODIFY COLUMN role ENUM(
    'admin','supervisor','coordinador','jefe_operaciones','technician',
    'administrativo','anonimo','gestorActivos','tecnicoInventario',
    'directivoFinanciero','disenador','recursosHumanos',
    'director_operaciones','empleado'
) NOT NULL DEFAULT 'technician';

-- 2. Vincular la cuenta de login con la ficha de RRHH.
ALTER TABLE users
  ADD COLUMN users_company_id INT NULL AFTER departamento,
  ADD CONSTRAINT fk_users_users_company
    FOREIGN KEY (users_company_id) REFERENCES users_company(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD UNIQUE KEY uq_users_users_company (users_company_id);
```

> **Backfill**: script `scripts/vincularUsuariosEmpleados.js` que cruza por
> `users.full_name` ↔ `users_company.nombre_propio` / número de identificación y deja un
> reporte de los que no hicieron match para resolverlos a mano. La columna es nullable, así
> que los usuarios existentes (técnicos, coordinadores, etc.) no se rompen.

### Migración `044_create_asistencia_tables.sql`

#### `horario_plantilla` — turnos reutilizables

| Columna | Tipo | Notas |
|---|---|---|
| `idhorario_plantilla` | INT PK AI | |
| `nombre` | VARCHAR(80) | "Turno mañana 7-16" |
| `hora_entrada` | TIME NOT NULL | hora Bogotá |
| `hora_salida` | TIME NOT NULL | |
| `minutos_almuerzo` | SMALLINT NOT NULL DEFAULT 60 | |
| `hora_almuerzo_inicio` | TIME NULL | hora exacta de almuerzo, si aplica |
| `tolerancia_entrada_min` | SMALLINT NOT NULL DEFAULT 5 | |
| `creado_por_user_id` | INT FK users(id) | |
| `activo` | TINYINT(1) DEFAULT 1 | |

#### `horario_asignado` — el horario de un empleado en una fecha

| Columna | Tipo | Notas |
|---|---|---|
| `idhorario_asignado` | INT PK AI | |
| `users_company_id` | INT NOT NULL FK | el empleado |
| `fecha` | DATE NOT NULL | fecha laboral (Bogotá) |
| `horario_plantilla_id` | INT NULL FK | origen, si vino de plantilla |
| `hora_entrada` / `hora_salida` | TIME NOT NULL | copiadas de la plantilla, editables |
| `minutos_almuerzo` | SMALLINT DEFAULT 60 | |
| `hora_almuerzo_inicio` | TIME NULL | **si está definida, el almuerzo tiene hora exacta** |
| `tolerancia_entrada_min` | SMALLINT DEFAULT 5 | |
| `es_descanso` | TINYINT(1) DEFAULT 0 | día libre programado |
| `creado_por_user_id` | INT FK users(id) | el director |
| `notas` | VARCHAR(255) NULL | |

`UNIQUE KEY (users_company_id, fecha)` — un horario por empleado por día.

#### `jornada` — cabecera del día (cache derivado, recalculable)

| Columna | Tipo | Notas |
|---|---|---|
| `idjornada` | INT PK AI | |
| `users_company_id` | INT NOT NULL FK | |
| `horario_asignado_id` | INT NULL FK | puede no haber horario |
| `fecha` | DATE NOT NULL | |
| `estado` | ENUM('pendiente','en_curso','en_pausa','finalizada','ausente') | |
| `hora_entrada_real` / `hora_salida_real` | DATETIME(3) NULL | UTC |
| `minutos_tarde` | SMALLINT DEFAULT 0 | |
| `minutos_trabajados` | INT DEFAULT 0 | neto, sin pausas |
| `minutos_pausa_bano` | INT DEFAULT 0 | |
| `minutos_pausa_almuerzo` | INT DEFAULT 0 | |
| `minutos_extra` | INT DEFAULT 0 | solo tiempo con hora extra aprobada |
| `minutos_salida_anticipada` | INT DEFAULT 0 | |
| `desviacion_almuerzo_min` | INT DEFAULT 0 | vs. `hora_almuerzo_inicio` |
| `cerrada_automaticamente` | TINYINT(1) DEFAULT 0 | |
| `ajustada_por_user_id` | INT NULL FK users(id) | corrección manual del director |

`UNIQUE KEY (users_company_id, fecha)`.

> Estos totales son **derivados**: siempre se pueden reconstruir desde `jornada_evento`.
> Se persisten para que los reportes históricos y los rankings no tengan que reprocesar
> eventos. El endpoint de "mi jornada de hoy" recalcula al vuelo.

#### `jornada_evento` — append-only, **la fuente de verdad**

| Columna | Tipo | Notas |
|---|---|---|
| `idjornada_evento` | INT PK AI | |
| `jornada_id` | INT NOT NULL FK ON DELETE CASCADE | |
| `tipo` | ENUM('entrada','inicio_bano','fin_bano','inicio_almuerzo','fin_almuerzo','salida','inicio_extra','fin_extra') | |
| `ocurrido_en` | DATETIME(3) NOT NULL | **siempre `NOW(3)` del servidor**, jamás un timestamp del cliente |
| `origen` | ENUM('empleado','director','sistema') DEFAULT 'empleado' | |
| `registrado_por_user_id` | INT NULL FK users(id) | quién lo registró si no fue el propio empleado |
| `nota` | VARCHAR(255) NULL | motivo de ajuste manual |
| `ip` | VARCHAR(45) NULL | |
| `user_agent` | VARCHAR(255) NULL | |

Índice `(jornada_id, ocurrido_en)`. **Nunca se borran ni se editan**: una corrección se
registra como un evento nuevo con `origen='director'` y su nota.

#### `hora_extra`

| Columna | Tipo | Notas |
|---|---|---|
| `idhora_extra` | INT PK AI | |
| `users_company_id` | INT NOT NULL FK | |
| `fecha` | DATE NOT NULL | |
| `tipo` | ENUM('solicitada','asignada') | solicitada = la pide el empleado; asignada = la impone el director |
| `minutos_estimados` | INT NOT NULL | |
| `minutos_aprobados` | INT NULL | lo que realmente se autoriza |
| `minutos_ejecutados` | INT DEFAULT 0 | lo efectivamente trabajado, calculado desde eventos |
| `estado` | ENUM('pendiente','aprobada','rechazada','cancelada') DEFAULT 'pendiente' | |
| `motivo` | VARCHAR(255) | |
| `solicitado_por_user_id` | INT FK users(id) | |
| `aprobado_por_user_id` | INT NULL FK users(id) | |
| `fecha_decision` | DATETIME NULL | |
| `comentario_director` | VARCHAR(255) NULL | |

Índice `(users_company_id, fecha)`, `(estado)`.

#### `asistencia_parametro` — configuración, no constantes en el código

| Columna | Tipo | Notas |
|---|---|---|
| `clave` | VARCHAR(60) PK | |
| `valor` | VARCHAR(60) NOT NULL | |
| `tipo_dato` | ENUM('entero','decimal','booleano','texto') | |
| `descripcion` | VARCHAR(160) | |
| `actualizado_por_user_id` | INT NULL FK users(id) | |
| `updated_at` | DATETIME ON UPDATE CURRENT_TIMESTAMP | |

Semilla — migración `045_seed_asistencia_parametros.sql`:

| clave | valor | significado |
|---|---|---|
| `minutos_habilitar_salida` | 10 | ventana previa para el botón Salida |
| `tolerancia_entrada_min` | 5 | valor por defecto si el horario no lo define |
| `limite_bano_min_por_pausa` | 15 | umbral de alerta |
| `limite_bano_min_por_dia` | 30 | umbral de alerta |
| `desviacion_almuerzo_alerta_min` | 15 | vs. hora programada |
| `dias_edicion_retroactiva` | 7 | hasta cuántos días atrás puede ajustar el director |

Se lee una vez por proceso y se cachea en memoria con invalidación al escribir. Ningún
literal de estos valores aparece en el código.

---

### 5.1 Normalización

El esquema cumple **3FN**, y las tres tablas principales también **BCNF**. El análisis:

| Tabla | Clave | Dependencias funcionales | Forma |
|---|---|---|---|
| `horario_plantilla` | `idhorario_plantilla` | todos los atributos dependen solo de la PK | BCNF |
| `horario_asignado` | `idhorario_asignado`, con candidata `(users_company_id, fecha)` | los atributos dependen de la candidata completa; ninguno depende de otro no-clave | BCNF |
| `jornada` | `idjornada`, candidata `(users_company_id, fecha)` | atributos de identificación dependen de la candidata; los totales son derivados (ver excepción 2) | 3FN |
| `jornada_evento` | `idjornada_evento` | `jornada_id`, `tipo`, `ocurrido_en`, autor e IP dependen solo de la PK | BCNF |
| `hora_extra` | `idhora_extra` | idem; `minutos_ejecutados` es derivado (excepción 2) | 3FN |
| `asistencia_parametro` | `clave` | `valor`, `tipo_dato`, `descripcion` dependen de la clave | BCNF |

**Qué se evitó deliberadamente**

- **Nada de datos del empleado duplicados.** `jornada` y `horario_asignado` guardan solo
  `users_company_id`; nombre, cédula, cargo, área y jefe se leen de `users_company` y
  `contrato` por JOIN. No hay un `nombre_empleado` copiado en ninguna tabla del módulo.
- **La jerarquía no se duplica.** "Quién está a cargo de quién" existe una sola vez, en
  `contrato.jefe_area_id` (antes `jefe_inmediato_id`, corregido en §16). El módulo la
  consulta, no la copia — era el motivo para descartar la alternativa de una tabla
  `asistencia_equipo` propia.
- **No hay tabla `jornada_pausa`.** Una pausa es el par de eventos `inicio_x`/`fin_x` y se
  deriva de `jornada_evento`. Guardarla además como fila propia significaría mantener el
  mismo hecho en dos lugares, con el riesgo clásico de que diverjan. Si las consultas de
  reportes lo piden, se agrega una **VISTA** `v_jornada_pausa`, que no almacena nada.
- **Sin campos multivaluados.** Nada de listas separadas por comas; las alertas del día son
  calculadas, no un campo de texto.
- **Sin grupos repetitivos.** No existe `pausa1_inicio`, `pausa2_inicio`…; las pausas son
  filas, no columnas.

**Dos desnormalizaciones controladas, y su justificación**

1. **`horario_asignado` copia los valores de `horario_plantilla`** (`hora_entrada`,
   `hora_salida`, `minutos_almuerzo`, `tolerancia`) en vez de solo referenciarla.
   No es redundancia: es un **snapshot histórico**. Si el director edita la plantilla
   "Turno mañana" en octubre, los horarios de septiembre —y las jornadas calculadas contra
   ellos— no pueden cambiar retroactivamente. El `horario_plantilla_id` se conserva solo como
   trazabilidad del origen. Es el mismo criterio con el que una factura copia el precio del
   producto.
2. **`jornada` guarda totales derivables de `jornada_evento`** (`minutos_trabajados`,
   `minutos_tarde`, etc.), y `hora_extra.minutos_ejecutados` igual.
   Es una **caché derivada**, no una fuente de verdad. Las reglas que la mantienen honesta:
   - se recalcula siempre con la **misma** función de dominio que usa el endpoint en vivo;
   - se actualiza dentro de la misma transacción que inserta el evento;
   - existe `scripts/recalcularJornadas.js` que la reconstruye desde cero para cualquier
     rango, de modo que un total corrupto es reparable sin pérdida de información;
   - ninguna regla de negocio lee estos campos para decidir; solo los reportes los leen.

   La alternativa —recorrer todos los eventos de todos los empleados en cada reporte mensual—
   haría inviables las estadísticas de §9.

**Sobre los `ENUM`**

`jornada_evento.tipo`, `jornada.estado` y `hora_extra.estado` son `ENUM` y no tablas de
catálogo. Es intencional: son conjuntos **cerrados y acoplados al código** —agregar un valor
exige escribir la lógica que lo interpreta, así que una tabla editable daría una falsa
sensación de extensibilidad. Además es la convención del repositorio (`activos.estado`,
`users.role`). En cambio, lo que sí es **parametrizable por el negocio** —tolerancias y
límites— vive en `asistencia_parametro`, que es una tabla precisamente porque debe cambiarse
sin desplegar código.

**Índices**

```sql
-- patrones de consulta reales del módulo
UNIQUE (users_company_id, fecha)              -- en horario_asignado y en jornada
INDEX  (jornada_id, ocurrido_en)              -- reconstrucción de la línea de tiempo
INDEX  (users_company_id, fecha)              -- historial por empleado y rango
INDEX  (estado)                               -- bandeja de horas extra pendientes
INDEX  (fecha, estado)                        -- tablero del director "hoy"
```

---

## 6. Motor de cálculo

Archivo: **`domain/asistencia/calcularJornada.js`** — función pura, sin acceso a base de datos, para que
sea testeable y para que el mismo código sirva al endpoint en vivo y al cierre del día.

```js
/**
 * @param {Array}  eventos  ordenados por ocurrido_en ASC
 * @param {Object} horario  horario_asignado (puede ser null)
 * @param {Date}   ahora    instante de corte (NOW del servidor)
 * @returns {Object} totales + flags de UI
 */
calcularJornada(eventos, horario, ahora)
```

Devuelve:

```js
{
  estado: 'en_curso' | 'en_pausa' | 'finalizada' | 'pendiente',
  minutosTrabajados,        // contador principal
  minutosPausaBano,
  minutosPausaAlmuerzo,
  pausaActiva: null | { tipo: 'bano'|'almuerzo', desde, minutosTranscurridos },
  minutosTarde,
  minutosExtra,
  minutosSalidaAnticipada,
  desviacionAlmuerzoMin,
  puedeMarcarSalida: bool,  // ahora >= hora_salida - 10 min
  segundosParaHabilitarSalida,
  alertas: [ 'llegada_tarde', 'bano_excedido', 'almuerzo_fuera_de_horario', ... ]
}
```

**Algoritmo del contador principal**

1. Si no hay evento `entrada` → `minutosTrabajados = 0`, estado `pendiente`.
2. `fin = evento salida ?? ahora`.
3. `bruto = fin - entrada`.
4. Recorrer los eventos emparejando `inicio_*` con su `fin_*`. Una pausa sin cierre se cierra
   contra `fin`. Acumular por tipo.
5. `minutosTrabajados = bruto - (pausaBano + pausaAlmuerzo)`.
6. Si `fin > hora_salida` y existe una `hora_extra` aprobada para esa fecha:
   `minutosExtra = min(fin - hora_salida, minutos_aprobados)`.
   Si no hay aprobación, el excedente **no** cuenta como extra y se levanta la alerta
   `extra_sin_aprobar`.

**Por qué eventos y no un acumulado**: si el empleado refresca, cierra la pestaña, se le va
el internet o cambia el reloj de su PC, el total sigue siendo correcto porque se recalcula
desde marcas de tiempo del servidor.

---

## 7. Reglas de negocio

| Regla | Detalle |
|---|---|
| **Marcaje de entrada** | El front llama `POST /mi-jornada/entrada` al cargar la pantalla tras el login. El backend crea la `jornada` (si no existe) y el evento `entrada`. Idempotente: un segundo llamado el mismo día devuelve la jornada existente sin duplicar. |
| **Llegada tarde** | `minutos_tarde = max(0, entrada_real − (hora_entrada + tolerancia))`. Tolerancia por horario, default 5 min. |
| **Una pausa a la vez** | El servidor rechaza `inicio_bano` si hay una pausa abierta (422 `REGLA_ASISTENCIA`; el plan decía 409, ver §20). Igual para `inicio_almuerzo`. |
| **Almuerzo con hora exacta** | Si `hora_almuerzo_inicio` está definida, se calcula `desviacion_almuerzo_min = abs(inicio_real − hora_programada)`. **No se bloquea** el marcaje; se registra la desviación y se levanta alerta si supera 15 min. Si es NULL, el almuerzo es libre. |
| **Exceso de almuerzo** | Si la pausa de almuerzo supera `minutos_almuerzo`, el excedente descuenta del tiempo laborado (ya lo hace el cálculo) y genera alerta `almuerzo_excedido`. |
| **Baño** | Sin bloqueo. Alerta si una pausa supera 15 min o si el acumulado del día supera 30 min. Ambos configurables. |
| **Botón Salida** | Habilitado solo cuando `ahora >= hora_salida − 10 min`. **Validado en el servidor** (422 `REGLA_ASISTENCIA` si se intenta antes; el plan decía 403, ver §20); el front solo refleja el flag `puedeMarcarSalida`. |
| **Salida anticipada** | Entre −10 min y la hora de salida cuenta como salida anticipada: se registra `minutos_salida_anticipada` con alerta, pero se permite (es la ventana que pidió el negocio). |
| **Horas extra** | Solo cuentan tras la hora de salida y solo con un registro `hora_extra` en estado `aprobada`. El empleado puede pedirlas (`tipo='solicitada'`) y el director aprueba; o el director las asigna directamente (`tipo='asignada'`, ya nace `aprobada`). |
| **Jornada sin marcar** | Un empleado con horario y sin evento `entrada` al terminar el día queda `ausente`. Se resuelve de forma perezosa al consultar y con un cierre nocturno (ver §10). |
| **Turno sin marcar salida** | Cierre automático a la `hora_salida` con `cerrada_automaticamente = 1` y alerta `sin_marcar_salida`, para que el contador no crezca indefinidamente. |
| **Autorización** | Un director solo opera sobre empleados cuyo contrato activo tenga `jefe_area_id` = su `users_company_id` (corregido 2026-09-23, ver §16 — antes `jefe_inmediato_id`). Se valida en **cada** endpoint con un helper compartido, nunca solo en el front. |
| **Director como empleado** | El director usa exactamente los mismos endpoints `/mi-jornada/*`. Si tiene horario asignado, aplica igual. |

---

## 8. API — `/api/asistencia`

Todas las rutas pasan por `verifyToken`. Montaje en `index.js`:
`app.use('/api/asistencia', require('./routes/asistencia'));`

### 8.1 Empleado (y director sobre sí mismo)

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/mi-horario?desde=&hasta=` | Horarios asignados del rango (default: semana actual) |
| `GET` | `/mi-jornada/hoy` | Estado en vivo: contadores calculados, pausa activa, flags de botones |
| `POST` | `/mi-jornada/entrada` | Marca entrada (idempotente) |
| `POST` | `/mi-jornada/pausa` | Body `{ tipo: 'bano' \| 'almuerzo' }` |
| `POST` | `/mi-jornada/pausa/fin` | Cierra la pausa activa |
| `POST` | `/mi-jornada/salida` | 422 si faltan más de 10 min |
| `GET` | `/mi-jornada/:fecha/trazabilidad` | Línea de tiempo del día + totales + alertas |
| `GET` | `/mis-jornadas?desde=&hasta=` | Filas crudas de `jornada` del rango (default: semana actual) — agregada 2026-09-25, ver §17 |
| `GET` | `/mis-estadisticas?desde=&hasta=` | Agregados del periodo (§9) |
| `POST` | `/horas-extra/solicitar` | `{ fecha, minutos_estimados, motivo }` |
| `GET` | `/mis-horas-extra?estado=` | Historial propio |

**Respuesta de `/mi-jornada/hoy`** (contrato para el front):

```json
{
  "jornada_id": 42,
  "fecha": "2026-09-15",
  "estado": "en_curso",
  "servidor_ahora": "2026-09-15T14:32:10.123Z",
  "horario": {
    "hora_entrada": "08:00:00",
    "hora_salida": "17:00:00",
    "hora_almuerzo_inicio": "12:30:00",
    "minutos_almuerzo": 60
  },
  "hora_entrada_real": "2026-09-15T13:07:42.000Z",
  "minutos_tarde": 2,
  "minutos_trabajados": 84,
  "minutos_pausa_bano": 6,
  "minutos_pausa_almuerzo": 0,
  "pausa_activa": null,
  "minutos_extra": 0,
  "puede_marcar_salida": false,
  "segundos_para_habilitar_salida": 9470,
  "alertas": ["llegada_tarde"]
}
```

El front arranca su contador local desde `minutos_trabajados` usando `servidor_ahora` como
referencia (evita depender del reloj del cliente) y resincroniza cada 60 s.

### 8.2 Director de operaciones

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/equipo` | Empleados a cargo con su estado de hoy en vivo |
| `GET` | `/equipo/:empleadoId/jornadas?desde=&hasta=` | Historial de jornadas |
| `GET` | `/equipo/:empleadoId/jornada/:fecha/trazabilidad` | Trazabilidad completa del día |
| `GET` | `/equipo/estadisticas?desde=&hasta=` | Consolidado del equipo |
| `GET` | `/horarios/plantillas` · `POST` · `PUT /:id` · `DELETE /:id` | CRUD de plantillas |
| `GET` | `/horarios?empleadoId=&desde=&hasta=` | Consultar horarios asignados |
| `POST` | `/horarios` | Asignación **masiva**: `{ empleados: [id], desde, hasta, dias_semana: [1..5], plantilla_id }` o valores sueltos |
| `PUT` | `/horarios/:id` · `DELETE /:id` | Editar/eliminar una asignación |
| `GET` | `/horas-extra?estado=pendiente` | Bandeja de aprobación |
| `PUT` | `/horas-extra/:id/aprobar` | `{ minutos_aprobados, comentario }` |
| `PUT` | `/horas-extra/:id/rechazar` | `{ comentario }` |
| `POST` | `/horas-extra/asignar` | `{ empleados: [id], fecha, minutos, motivo }` → nace aprobada |
| `POST` | `/equipo/jornada/:id/evento` | Registro manual con `origen='director'` y nota obligatoria |

### 8.3 Socket.IO

Reutilizando `global.sendMessageToUser` y `req.io` del `index.js` actual:

- Cada marcaje de un empleado emite `asistencia:evento` al socket de su director →
  el panel de equipo se actualiza sin polling.
- Una solicitud de hora extra emite `asistencia:hora_extra_solicitada` al director.
- Una aprobación/rechazo emite `asistencia:hora_extra_resuelta` al empleado.

---

## 9. Estadísticas

**Empleado — "mi trazabilidad del día"**
- Línea de tiempo de eventos con hora local (entrada 08:02, baño 10:15–10:21, almuerzo…, salida).
- Hora programada vs. hora real de entrada y los minutos de retraso.
- Tiempo laborado neto vs. tiempo esperado del turno, con el % de cumplimiento.
- Desglose de pausas: total baño, total almuerzo, desviación frente a la hora programada.
- Horas extra ejecutadas y su estado de aprobación.
- Alertas del día.

**Empleado — periodo (semana/mes)**
- Días trabajados, ausencias, descansos.
- Puntualidad: % de días a tiempo, minutos de retraso acumulados, hora promedio de entrada.
- Horas laboradas acumuladas vs. esperadas.
- Promedio diario en pausas, tendencia por día de la semana.
- Horas extra aprobadas vs. ejecutadas.
- Racha actual de días puntuales.

**Director — equipo**
- Tablero en vivo: quién está trabajando, en pausa, sin marcar, ausente.
- Ranking de puntualidad y de cumplimiento horario.
- Empleados con alertas activas (baño excedido, extra sin aprobar, sin marcar salida).
- Consolidado de horas extra del periodo por empleado y total.
- Exportación a Excel/PDF (el front ya tiene `xlsx` y `jspdf`).

---

## 10. Cierre del día

Se necesita cerrar jornadas sin `salida` y marcar ausencias. Dos mecanismos complementarios:

1. **Perezoso** (siempre activo): cualquier consulta a una jornada de una fecha pasada que
   siga `en_curso`/`pendiente` la normaliza antes de responder. No depende de ningún proceso
   externo.
2. **Programado**: `scripts/cerrarJornadasDelDia.js`, ejecutable por cron a las 23:30 Bogotá
   (04:30 UTC) en el servidor de despliegue. Recalcula y persiste los totales del día.

El mecanismo 1 hace que el módulo sea correcto aun si el cron no está configurado; el 2
mantiene los reportes rápidos.

---

## 11. Archivos a crear / modificar

### Backend

La estructura sigue las capas de §3. Cada carpeta nueva agrupa por módulo (`asistencia/`)
para que el módulo sea legible y removible como una unidad.

**Nuevos**
```
migrations/
  043_add_asistencia_roles_y_vinculo_empleado.sql
  044_create_asistencia_tables.sql
  045_seed_asistencia_parametros.sql

domain/asistencia/                    ← Capa transversal · sin E/S, 100% probable
  calcularJornada.js                  // motor de cálculo (§6)
  reglasJornada.js                    // assertPuedeIniciarPausa, assertPuedeMarcarSalida, ...
  estadosJornada.js                   // máquina de estados y transiciones válidas
  index.js                            // fachada del dominio

repositories/asistencia/              ← Capa 4 · único lugar con SQL del módulo
  horarioPlantillaRepository.js
  horarioAsignadoRepository.js
  jornadaRepository.js                // incluye findHoyParaActualizar (SELECT ... FOR UPDATE)
  jornadaEventoRepository.js
  horaExtraRepository.js
  equipoRepository.js                 // empleados a cargo vía contrato.jefe_area_id (§16)
  parametroRepository.js

services/asistencia/                  ← Capa 3 · reglas, transacciones, autorización
  marcajeService.js                   // entrada, pausas, salida
  consultaService.js                  // estado de hoy, trazabilidad, estadísticas
  horarioService.js                   // plantillas y asignación masiva
  horaExtraService.js                 // solicitud, aprobación, asignación
  equipoService.js                    // vistas del director + assertEmpleadoACargo
  cierreService.js                    // normalización de jornadas vencidas (§10)
  notificacionService.js              // emisión de eventos Socket.IO

controllers/asistencia/               ← Capa 2 · adaptadores HTTP, sin lógica
  marcajeController.js
  consultaController.js
  horarioController.js
  horaExtraController.js
  equipoController.js

routes/asistencia.js                  ← Capa 1

validators/asistenciaSchemas.js       // DTOs por endpoint (§3.6)
middleware/validar.js                 // validador genérico, ~60 líneas, sin dependencias
middleware/asyncHandler.js
middleware/errorHandler.js
errors/AppError.js                    // + NoAutorizado, NoEncontrado, ConflictoJornada, ReglaAsistencia

utils/fechaBogota.js                  // UTC ↔ Bogotá, fecha laboral, TIME+DATE → instante

scripts/vincularUsuariosEmpleados.js  // backfill de users.users_company_id
scripts/cerrarJornadasDelDia.js       // invoca cierreService, no reimplementa nada
scripts/recalcularJornadas.js         // reconstruye totales desde eventos (§5.1)

tests/asistencia/
  calcularJornada.test.js             // node --test
  reglasJornada.test.js
```

**Modificados**
```
index.js                       // app.use('/api/asistencia', ...) + app.use(errorHandler) al final
middleware/auth.js             // isDirectorOperaciones, isEmpleado, canRegistrarAsistencia
models/User.js                 // incluir users_company_id en los SELECT
controllers/authController.js  // users_company_id en el payload del JWT (evita un JOIN por request)
package.json                   // scripts "cerrar-jornadas", "recalcular-jornadas", "test"
```

`middleware/auth.js` — añadir junto a los middlewares existentes, respetando el patrón
`verifyRole` que ya existe:

```js
const isDirectorOperaciones  = verifyRole(['director_operaciones', 'admin']);
const isEmpleado             = verifyRole(['empleado', 'admin']);
const canRegistrarAsistencia = verifyRole(['empleado', 'director_operaciones', 'admin']);
```

La autorización jerárquica **no** es un middleware: depende del `empleadoId` del path o del
body y necesita consultar la base de datos, así que vive en el servicio, donde toda la capa
la comparte:

```js
// services/asistencia/equipoService.js
async function assertEmpleadoACargo(directorUsersCompanyId, empleadoId, conn) {
    const aCargo = await equipoRepo.esSubordinado(directorUsersCompanyId, empleadoId, conn);
    if (!aCargo) throw new NoAutorizadoError('El empleado no está a su cargo');
}
```

Todos los casos de uso del director la invocan como primera línea. Al estar en una sola
función, agregar un endpoint nuevo sin protección es un error visible en revisión de código.

### Frontend

**Nuevos**
```
src/components/asistencia/EmpleadoLayout.jsx          // nav del rol empleado
src/components/asistencia/DirectorOperacionesLayout.jsx
src/components/asistencia/MiJornada.jsx               // pantalla principal del empleado
src/components/asistencia/ContadorJornada.jsx         // reloj grande + estado
src/components/asistencia/BotonesPausa.jsx            // Baño / Almuerzo / Salida
src/components/asistencia/MiHorario.jsx               // calendario semanal
src/components/asistencia/MiTrazabilidad.jsx          // timeline del día
src/components/asistencia/MisEstadisticas.jsx
src/components/asistencia/EquipoAsistencia.jsx        // tablero en vivo del director
src/components/asistencia/GestionHorarios.jsx         // asignación individual y masiva
src/components/asistencia/HorasExtra.jsx              // bandeja aprobar/asignar
src/components/asistencia/TrazabilidadEmpleado.jsx    // vista del director
src/hooks/useJornada.js                               // estado + tick local + resync
```

**Modificados**
```
src/App.jsx                    // rutas nuevas, LayoutWrapper, RedirectByRole, DashboardRoute
src/context/AuthContext.jsx    // isDirectorOperaciones, isEmpleado
src/services/api.js            // asistenciaService
```

`src/services/api.js`:

```js
export const asistenciaService = {
  getMiJornadaHoy: () => api.get('/asistencia/mi-jornada/hoy'),
  marcarEntrada:   () => api.post('/asistencia/mi-jornada/entrada'),
  iniciarPausa:    (tipo) => api.post('/asistencia/mi-jornada/pausa', { tipo }),
  finPausa:        () => api.post('/asistencia/mi-jornada/pausa/fin'),
  marcarSalida:    () => api.post('/asistencia/mi-jornada/salida'),
  getMiHorario:    (params) => api.get('/asistencia/mi-horario', { params }),
  getTrazabilidad: (fecha) => api.get(`/asistencia/mi-jornada/${fecha}/trazabilidad`),
  // ... director
};
```

**`useJornada.js` — comportamiento del contador**

1. Al montar: `marcarEntrada()` (idempotente) y luego `getMiJornadaHoy()`.
2. Guarda `offset = Date.now() − servidor_ahora` para no confiar en el reloj local.
3. Tick de 1 s que **interpola** el contador; no llama a la API.
4. Resync con el servidor cada 60 s y después de cada marcaje.
5. Al recuperar el foco de la pestaña (`visibilitychange`), resync inmediato.

---

## 12. Fases de trabajo

| Fase | Contenido | Entregable verificable | Estado |
|---|---|---|---|
| **0. Andamiaje de capas** | `errors/`, `middleware/asyncHandler.js`, `middleware/errorHandler.js`, `middleware/validar.js` y el esqueleto de carpetas de §3 | Un endpoint trivial devuelve 422 con error tipado y 400 con error de validación | ✅ Hecho |
| **1. Base de datos y vínculo** | Migraciones 043, 044 y 045, script de backfill, `users_company_id` en el JWT | Roles creados, un usuario de prueba vinculado a su ficha de RRHH | ✅ Hecho |
| **2. Dominio** | `utils/fechaBogota.js` y `domain/asistencia/` (cálculo, reglas, máquina de estados) + pruebas de los casos borde (pausa sin cerrar, salida anticipada, extra sin aprobar) | `npm test` en verde, sin servidor ni base de datos | ✅ Hecho (26 tests; turno nocturno fuera de alcance, ver §13.1) |
| **3. API del empleado** | Repositorios de jornada/evento/horario, `marcajeService`, `consultaService`, controllers y rutas de marcaje y trazabilidad | Ciclo completo entrada → baño → almuerzo → salida probado | ✅ Hecho (probado con curl/fetch contra el servidor real, no Postman) |
| **4. API del director** | `horarioService` (plantillas + asignación masiva), `horaExtraService`, `equipoService` con `assertEmpleadoACargo` | El director crea horarios y aprueba extras; recibe 403 al consultar un empleado ajeno | ✅ Hecho |
| **5. Frontend** | Layouts y rutas de los dos roles, `useJornada`, pantalla de jornada con contador y botones, trazabilidad, estadísticas, tablero del director | Flujo end-to-end en el navegador | ✅ Hecho (probado en Chrome real, login empleado y director) |
| **6. Cierre y reportes** | Cierre perezoso + script nocturno, estadísticas agregadas | Reportes del periodo consistentes | ✅ Hecho (backend). Exportación Excel/PDF queda para cuando se aborde en el frontend — no es responsabilidad de este repo |

Ver §14 para el detalle línea por línea de cada fase (deviaciones del plan y bugs encontrados).

---

## 13. Puntos pendientes de definir

1. **Turnos nocturnos**: ¿existen turnos que cruzan medianoche (ej. 22:00–06:00)? El esquema
   los soporta (la jornada se ancla a la fecha de entrada), pero hay que confirmar si aplican
   antes de invertir en las pruebas de ese caso.
   **Resuelto (2026-09-15):** no existen por ahora. El dominio no tiene pruebas para ese caso;
   si se necesitan en el futuro, revisar primero `calcularJornada` (usa `fin = salida ??
   ahora` y compara contra `hora_salida` del mismo `fecha` — no contempla que `hora_salida`
   caiga al día siguiente de `hora_entrada`).
2. **Límites de pausa**: los valores por defecto propuestos son 15 min por visita al baño,
   30 min acumulados al día y almuerzo según horario. Falta confirmar con el negocio si se
   bloquea o solo se alerta. *(La propuesta actual: solo alerta.)*
3. **Geolocalización / IP**: ¿se restringe el marcaje a la red de la oficina? Hoy solo se
   guarda la IP como evidencia. Relevante para teletrabajo.
4. **Días festivos y vacaciones**: existe el módulo `Vacaciones` y `novedad_rrhh`. Hay que
   decidir si una jornada sin marcar se contrasta contra esas tablas antes de marcarla
   `ausente`. *(Recomendado para la fase 6, no bloquea el MVP.)*
5. **Recargos**: ¿las horas extra se clasifican en diurna/nocturna/dominical/festiva para
   nómina? Si sí, `hora_extra` necesita una columna `tipo_recargo` y su catálogo.
6. **Quién crea los usuarios `empleado`**: ¿RRHH desde el módulo de empleados genera la
   cuenta de login automáticamente, o el admin la crea a mano y la vincula?
   **Resuelto (2026-09-15):** el admin la crea a mano (`POST /users` o el script de seed) y
   `scripts/vincularUsuariosEmpleados.js` hace el backfill de `users_company_id` por nombre.
   No se tocó el flujo de creación de empleados de RRHH.
   **Actualizado (2026-09-16):** el admin ya no depende del backfill posterior — el panel
   `/users` deja elegir la ficha de RRHH al crear la cuenta y la vincula en el mismo paso.
   El script sigue vivo para backfill masivo. Ver §15.
7. **Retroactividad**: ¿el director puede editar jornadas de días ya cerrados? El esquema lo
   permite vía eventos con `origen='director'` y el límite ya está parametrizado en
   `asistencia_parametro.dias_edicion_retroactiva` (propuesta: 7 días); falta que el negocio
   confirme el valor y si RRHH necesita un permiso sin límite.
   **Nota de implementación (Fase 4):** `jornada_evento.ocurrido_en` es siempre `NOW(3)` del
   servidor (regla §7/no negociable), así que `POST /equipo/jornada/:id/evento` hoy solo sirve
   para corregir el mismo día / una jornada aún abierta — no puede backdatear un evento a la
   hora real en que ocurrió en un día ya cerrado. Se decidió dejarlo así por ahora; un campo de
   hora explícita para `origen='director'` queda pendiente para cuando se aborde este punto en
   la Fase 6.
8. **Refactorización de los módulos existentes**: el `errorHandler` y el `asyncHandler` que
   introduce este módulo son reutilizables por incidencias, activos y diseños. No se tocan
   ahora —está fuera del alcance— pero conviene decidir si a futuro los módulos viejos migran
   a este patrón o si el repositorio mantiene dos convenciones de forma permanente.

---

## 14. Notas de implementación (2026-09-15)

Registro de lo que efectivamente se construyó fase por fase, las desviaciones concretas
respecto a este documento y los bugs reales que aparecieron al probar contra el servidor real
(no solo con los tests del dominio). Léase junto con las tablas de §11 y §12.

### Fase 0-1 (andamiaje + BD)

- `routes/asistencia.js` arrancó como un router vacío con solo `verifyToken`, y las rutas
  reales se fueron agregando en las Fases 3/4 — no hubo un endpoint "trivial" permanente en el
  repo; la verificación de 400/422 se hizo con un servidor Express desechable en el
  scratchpad, no con una ruta de producción.
- `models/User.js#getById` sigue sin incluir `users_company_id` en su `SELECT` explícito (sí
  lo trae `getByUsername`, que usa `SELECT *`, usado en login). No se tocó porque no lo
  necesita el flujo de login/asistencia; si algún día se muestra el perfil del usuario logueado
  por `id` con ese método, hay que agregarlo ahí también.
- Migraciones 043/044/045 aplicadas y verificadas contra el local. Backfill corrido: los 24
  usuarios legacy (técnicos, coordinadores, admins de prueba) no tienen ficha de RRHH y
  quedaron sin vincular, como se esperaba.

### Fase 2 (dominio)

- **No existe `assertPuedeMarcarEntrada`.** `POST /mi-jornada/entrada` es idempotente (§7): un
  segundo llamado el mismo día debe devolver la jornada existente, no lanzar error. Esa
  comprobación vive en `marcajeService` contra el repositorio, no como regla de dominio.
- **Código HTTP de `ReglaAsistenciaError` (422)** para pausas y salida anticipada, aunque la
  tabla de §7 mencionaba 409/403 en prosa para esos mismos casos — se siguió el ejemplo de
  código de §3.4, que los contradecía.
- **`inicio_extra`/`fin_extra` no se usan.** Existen en el `ENUM` de `jornada_evento.tipo` pero
  el algoritmo de §6 nunca los referencia para calcular `minutosExtra` (solo compara `fin`
  contra `hora_salida` y la aprobación de `hora_extra`). Quedan sin implementar.
- **Bug real (corregido):** un evento posterior a `fin` (p. ej. una corrección manual
  registrada después de que la jornada ya se cerró con `salida`) generaba `minutosPausaBano`
  negativo. `calcularJornada` ahora ignora eventos fuera de la ventana `[entrada, fin]` y
  levanta la alerta `sin_marcar_salida` cuando la `salida` es `origen='sistema'` (esta alerta,
  prevista en §7, tampoco estaba implementada).

### Fase 3-4 (API empleado + director)

- `finalizarPausa` no recibe `tipo` del body (la ruta `/mi-jornada/pausa/fin` no lo lleva);
  el servicio infiere el tipo desde `pausaActiva.tipo` calculado por el dominio.
- `equipoRepository.directorUserIdDe`/`esSubordinado` filtran por
  `estado_contrato.nombre IN ('activo', 'periodo_prueba')` para decidir "contrato activo" —
  no estaba explícito en el plan, se definió a partir del catálogo real (`migrations/035`).
- `notificacionService.notificarDirector` no recibe `io` — el helper global
  `sendMessageToUser` de `index.js` ya tiene `io` en su clausura, así que se simplificó la
  firma respecto al ejemplo de §3.4.
- `services/asistencia/jornadaCalculo.js` (no está en la lista de archivos de §11) centraliza
  `calcularEstadoConDatos`/`construirTotales`, compartido por `marcajeService`,
  `equipoService` y `cierreService`, para que el cálculo en vivo, el ajuste manual del
  director y el cierre automático nunca diverjan.
- `GET /mis-estadisticas` y `GET /equipo/estadisticas` quedaron con una versión básica (días
  trabajados, ausencias, puntualidad, acumulados) leyendo los totales cacheados de `jornada`;
  las métricas más ricas de §9 (rankings, tendencias) no se implementaron.
- `horarioAsignadoRepository.insertar` hace upsert por `(users_company_id, fecha)`
  (`ON DUPLICATE KEY UPDATE`) para que la asignación masiva pueda reasignar un día ya asignado
  sin un paso previo de verificación.

### Fase 6 (cierre y reportes)

- El cierre perezoso (`cierreService.normalizarSiEsPasada`) solo actúa sobre fechas
  **estrictamente anteriores a hoy** — nunca sobre la jornada de hoy, aunque ya haya pasado la
  hora de salida programada. Cerrar "hoy" es trabajo exclusivo del cierre nocturno
  (`scripts/cerrarJornadasDelDia.js`), que sí fuerza el cierre de la fecha del día en curso al
  ejecutarse (pensado para correr a las 23:30 Bogotá).
- `jornadaEventoRepository.insertar` acepta un `ocurridoEn` opcional, usado únicamente por el
  cierre automático para escribir la hora de salida *programada* en vez de "ahora". Ningún
  endpoint HTTP lo expone.
- Verificado en vivo: una jornada de un día anterior que quedó `en_curso` (entrada marcada,
  sin salida) se cerró sola al consultarla, con la hora de salida programada del horario
  asignado, `cerrada_automaticamente=1` y la alerta `sin_marcar_salida`.

### Fase 5 (frontend)

- `src/components/asistencia/TrazabilidadView.jsx` (no está en la lista de §11) es la vista
  de línea de tiempo compartida entre `MiTrazabilidad` (empleado) y `TrazabilidadEmpleado`
  (director) — evita duplicar ~60 líneas de JSX.
- Rutas del director bajo `/operaciones/*` (no `/asistencia/*`, reservado para el empleado);
  `HorasExtra.jsx` es una sola pantalla que muestra "Mis solicitudes" siempre y, si
  `isDirectorOperaciones`, también la bandeja de aprobación del equipo.
- **Bug real (corregido):** `new Date(fechaPura).toLocaleDateString()` sobre un campo `DATE`
  (sin hora) mostraba el día anterior — MySQL serializa `DATE` como medianoche UTC, y el
  navegador la reconvierte a su zona horaria local (Bogotá, UTC-5) antes de formatear. Se
  centralizó el formateo en `src/utils/fecha.js#formatearFecha` con `timeZone: 'UTC'`, aplicado
  en `HorasExtra.jsx` y `MiHorario.jsx` (los únicos dos lugares con el patrón).
- El primer borrador de "aprobar hora extra" usaba `window.prompt` para pedir los minutos;
  se reemplazó por un input inline antes de dar la fase por cerrada.
- Probado con clicks reales en Chrome contra el backend real: login de `empleado1` y
  `director.operaciones`, las 5 pantallas de empleado, las 4 del director, asignación masiva
  de horario y el ciclo completo solicitar → bandeja → aprobar → el empleado ve el cambio.

---

## 15. Sesión 2026-09-16 — `director_operaciones`/`empleado` faltaban en la creación de usuarios del admin

**Síntoma reportado por el usuario:** al crear un usuario con rol `empleado` desde el panel de
administración (`/users`), la cuenta se creaba pero al entrar al módulo de asistencia mostraba
`"Tu usuario no está vinculado a una ficha de RRHH"` (mensaje de
`services/asistencia/consultaService.js` y equivalentes, cuando `req.user.users_company_id`
llega `null` en el JWT).

**Causa raíz — un gap real en la regla de "tres lugares" de `CLAUDE.md`:** el ENUM de
`users.role` (migración 043) y los middlewares de `middleware/auth.js` sí incluían
`director_operaciones`/`empleado` desde la implementación del 2026-09-15, pero **nadie los
agregó a `validRoles` en `controllers/userController.js`** (`createUser`/`updateUser`) ni al
array `roles` de `UserManagement.jsx` — el mismo gap ya documentado para `recursosHumanos` en
`claude/modulo recursoshumanos.md` §1.2 antes de corregirse ahí, repetido esta vez porque la
regla de "tres lugares" de `CLAUDE.md` no cubría esa lista blanca del backend ni el selector
del admin. Se corrigió la regla a "cinco lugares" (ver `CLAUDE.md` § Roles).

**Fix 1 — habilitar el rol en la creación de usuarios:**
- `controllers/userController.js`: `director_operaciones`/`empleado` agregados a `validRoles`
  en `createUser` y `updateUser`. Tratamiento de `sede`/`departamento` igual que
  `technician`/`administrativo`: conservan `sede`, sin `departamento` (coincide con cómo
  `scripts/seedEmpleadosAsistencia.js` ya creaba esos logins).
- `UserManagement.jsx`: agregados al array `roles`, al filtro de la lista y con un mensaje
  informativo propio.

**Fix 2 (pedido explícito del usuario) — vincular la ficha de RRHH en el mismo paso de
creación**, en vez de depender de `scripts/vincularUsuariosEmpleados.js` después:
- `models/User.js`: `create()`/`update()` ahora leen/escriben `users_company_id`; `getAll()`/
  `getById()` lo incluyen en el `SELECT` (cierra parcialmente la nota de la Fase 0-1 de §14
  sobre que `getById` no lo traía). Nuevo `getByUsersCompanyId(id, excludeUserId)` para
  detectar si una ficha ya está tomada por otra cuenta.
- `models/UserCompany.js`: `getAll({ soloSinUsuario })` — con el flag activo, agrega
  `LEFT JOIN users usr ON usr.users_company_id = uc.id WHERE usr.id IS NULL` para traer solo
  fichas sin cuenta de login vinculada.
- `controllers/userCompanyController.js`: `GET /users-company?sin_usuario=true` expone ese
  filtro (mismo router/middleware de siempre; `verificarLecturaEmpleados` ya incluía `admin`).
- `controllers/userController.js`: si el rol es `director_operaciones`/`empleado`, exige
  `users_company_id` en el body, valida que la ficha exista (`UserCompany.getById`) y que no
  esté vinculada a otra cuenta (`User.getByUsersCompanyId`), con mensajes 400 específicos.
  Cambiar el rol de un usuario a uno no vinculado a RRHH limpia `users_company_id` en el
  `UPDATE`. Fallback en el `catch` por si la constraint `uq_users_users_company` (migración
  043) salta por una condición de carrera: distingue ese mensaje del de username duplicado
  mirando si `err.message` contiene el nombre de la constraint.
- `UserManagement.jsx`: al elegir `director_operaciones`/`empleado` en el modal de crear/editar,
  aparece un selector **"Empleado (ficha de RRHH)"** poblado con `sin_usuario=true`; al elegir
  uno, autocompleta `full_name` con `nombre_completo`. Al editar un usuario que ya tenía ficha
  vinculada, esa ficha se agrega aparte a la lista (el filtro `sin_usuario` la excluye por
  estar vinculada a sí misma) vía `userCompanyService.getById`.
- `services/api.js`: `userCompanyService.getAll` ahora acepta `params` (antes no aceptaba
  ninguno).

**No se tocó:** `scripts/vincularUsuariosEmpleados.js` sigue existiendo y sirve para el
backfill masivo (usuarios legacy, migraciones de datos); no quedó redundante, solo dejó de ser
el único camino para el caso de "un usuario nuevo a la vez" desde el panel.

**Verificado:** `node -c` en los 4 archivos backend tocados; `eslint`/`vite build --mode
development` en frontend (solo warnings preexistentes, ninguno nuevo); `dist/` restaurado con
`git checkout -- dist/ && git clean -fd dist/` tras el build. **No probado end-to-end en
Chrome** contra el backend real (crear un `empleado` de prueba y confirmar que el error
desaparece) — pendiente si se quiere cerrar del todo.

---

## 16. Sesión 2026-09-23 — corrección: la jerarquía es `jefe_area_id`, no `jefe_inmediato_id`

**Contexto:** al probar el módulo con los 389 empleados reales importados desde Excel (ver
`claude/modulo recursoshumanos.md`), el usuario aclaró que en el negocio real es el **jefe de
área** quien crea los horarios y los asigna a los empleados a su cargo — no el jefe inmediato.
La decisión original de §2 (`jefe_inmediato_id`) era una suposición de diseño de la Fase 1 que
nunca se validó contra cómo opera RRHH realmente.

**Caso real que lo evidenció:** Kevin Yobany Buitrago Ladino aparece en los datos importados
como `jefe_area_id` de 106 empleados, pero como `jefe_inmediato_id` de solo 12 — con la regla
vieja, su cuenta `director_operaciones` de prueba solo hubiera visto a esos 12.

**Cambio aplicado — un solo archivo, `repositories/asistencia/equipoRepository.js`:** las tres
funciones (`directorUserIdDe`, `esSubordinado`, `listaEmpleadosACargo`) cambiaron su filtro de
`c.jefe_inmediato_id` a `c.jefe_area_id`. Es el único archivo del módulo que toca esta columna
(confirmado con `grep -rl` sobre `repositories/asistencia/`, `services/asistencia/` y
`tests/asistencia/` — cero resultados adicionales), así que el cambio no se propaga a ningún
otro sitio. Los nombres de las funciones y sus firmas no cambiaron, solo la columna que leen.

**No se tocó:** `jefe_inmediato_id` sigue existiendo como columna y sigue siendo editable desde
el formulario de RRHH (`AgentForm.jsx`) — el módulo de asistencia simplemente ya no lo lee. Si
en el futuro se necesita distinguir "jefe inmediato" de "jefe de área" para otro propósito
(ej. aprobaciones de nómina), ambos campos siguen disponibles en `contrato`.

**Verificado:** contra la BD local real — `listaEmpleadosACargo(25)` (Kevin) devuelve 106
empleados (antes 12), `esSubordinado(25, <un empleado de la lista>)` devuelve `true`, y
`directorUserIdDe(<uno de sus empleados>)` resuelve correctamente al `users.id` de la cuenta
`kevin.buitrago` (rol `director_operaciones`, creada para esta prueba). `node -c` sin errores.

---

## 17. Sesión 2026-09-24/25 — Rediseño de UI (Opción C), endpoint `mis-jornadas` y dos bugs de backend

**Contexto:** el usuario trajo un paquete de diseño externo prescriptivo
(`Descargas/asiste-ui-asistencia/`: instrucciones, `tokens.css`, `components.css`, capturas de
referencia) y pidió migrar **todo** el módulo de Asistencia al mismo look "Opción C"
(navy/Asiste ING) que ya tenía Recursos Humanos — la pasada anterior (documentada en memoria de
sesión, no en este archivo) había dejado Asistencia deliberadamente en el estilo "Claude"
(crema/terracota) de una migración previa. Este cambio es **solo del repo frontend**
(`FrontGestor\gestor-tecnico-frontend`); no toca endpoints, reglas de marcación, cálculos de
tiempo ni permisos — excepto el endpoint nuevo y los dos fixes que se describen abajo, que
salieron de probar el rediseño contra el servidor real, no del rediseño en sí.

### 17.1 Rediseño frontend (7 fases)

Reemplazó `EmpleadoLayout.jsx`/`DirectorOperacionesLayout.jsx` (sidebar crema) por un único
`AsistenciaLayout.jsx` con TopNav navy (pestañas de equipo solo para `director_operaciones`,
contador de alertas del equipo y de horas extra pendientes), y reescribió las 9 pantallas del
módulo (`MiJornada`, `ContadorJornada` + `TarjetaPausa` + `BotonesPausa` nuevos,
`TrazabilidadView`, `MisEstadisticas`, `EquipoAsistencia`, `GestionHorarios`, `HorasExtra`,
`MiHorario`) sobre las clases `.ai-*` de `tokens.css`/`components.css` (fusionados en
`src/styles/asiste-ui/`, mismo archivo que ya usaba RRHH — se le agregó el token `--lunch` y el
bloque "Módulo Asistencia" que traía el paquete nuevo).

**Efecto colateral bueno, no buscado:** Asistencia ya no usa ninguna clase Tailwind
`font-asistencia-*`/`bg-paper`/`text-clay`/etc. de la pasada "estilo Claude" — quedó resuelta,
solo para este módulo, la fuga de fuente documentada en memoria de sesión (RRHH también dejó de
tenerla desde su propia migración a Opción C). El `theme.extend.fontFamily` global en
`tailwind.config.js` sigue existiendo y sigue afectando a otros módulos no relacionados con
asistencia (`CopyableId`, `DirectivoDashboard`, etc.) — eso no se tocó.

**Decisiones tomadas por falta de dato en el backend** (no se inventó nada; se documentaron como
huecos en vez de rellenarlos):
- **"Equipo hoy"**: la tabla no muestra Campaña/Turno/Entrada porque `equipoService.equipo()`
  no las expone (solo `nombre, cedula, cargo, estado, minutos_trabajados, pausa_activa,
  alertas`). Traerlas requeriría cruzar con RRHH, para lo que `director_operaciones` no tiene
  permiso (`/users-company/:id` es de RRHH/admin), o extender `equipoService.equipo()`.
- **Colores de plantilla de horario**: no hay columna `color` en `horario_plantilla` (nunca
  existió, ver §5) — el frontend asigna los 5 tokens `--cat-*` **por orden de aparición**, tal
  como pedía el propio paquete de diseño. No es un dato que falte, es una convención de
  presentación.
- **Solicitar hora extra con hora inicio/fin**: `solicitarHoraExtraSchema` solo acepta
  `{ fecha, minutos_estimados, motivo }` (§8.1, sin cambios). El modal pide hora inicio/fin y
  calcula la duración en el cliente, pero al backend solo le llega `minutos_estimados`.

### 17.2 Endpoint nuevo — `GET /asistencia/mis-jornadas?desde=&hasta=`

El "Calendario del mes" y "Horas por día" de Mis Estadísticas necesitaban totales **por día**
de un rango para el propio usuario, y no existía (el equivalente del director,
`GET /equipo/:empleadoId/jornadas`, sí). Se agregó el mismo patrón, sin capa nueva:

- `routes/asistencia.js`: reutiliza `rangoQuerySchema` (ya existía, para `/mi-horario` y
  `/mis-estadisticas`).
- `controllers/asistencia/consultaController.js#misJornadas`.
- `services/asistencia/consultaService.js#misJornadas`: `requireUsersCompanyId` +
  `cierreService.normalizarRangoSiEsPasado` + `jornadaRepo.findRango` — las mismas tres piezas
  que ya usaba `equipoService.jornadasDe`. Cero SQL nuevo.

Devuelve las filas crudas de `jornada` (`estado`, `minutos_tarde`, `minutos_trabajados`, etc.),
igual que el endpoint del director. El frontend las usa para pintar el calendario
(Puntual/Tarde/Ausente por día, clic → trazabilidad de ese día) y las barras de horas por día.

### 17.3 Dos bugs de backend encontrados al probar el rediseño

**Bug 1 — Puntualidad mostraba >100% (p. ej. 125%).**
`consultaService.misEstadisticas` calculaba `diasPuntuales` con
`j.minutos_tarde === 0 && j.estado !== 'pendiente'`, sin excluir `'ausente'` — un día ausente
también tiene `minutos_tarde = 0` (nunca marcó), así que contaba como puntual sin contar como
trabajado en el denominador (`diasTrabajados` sí excluye `'ausente'`). Con solo un día ausente
en el rango, `diasPuntuales` podía superar a `diasTrabajados`. Fix de una línea: agregar
`&& j.estado !== 'ausente'` al filtro de `diasPuntuales`.

**Bug 2 — El servidor se caía con `ER_DUP_ENTRY` al pedir rangos de fechas solapados en
paralelo.**
`cierreService.normalizarJornada` hace "buscar jornada del día → si no existe, crearla" sin
transacción ni bloqueo. La pantalla de Mis Estadísticas dispara `mis-estadisticas` y
`mis-jornadas` casi al mismo tiempo, ambos con rangos que se solapan; si el rango incluye un día
pasado sin jornada (candidato a `'ausente'`), las dos peticiones pueden intentar `INSERT` la
misma fila de `jornada` a la vez. La segunda choca con la constraint única
`uq_jornada_empleado_fecha` y el error no queda atrapado por nada — tumba el proceso completo
(no es un 500 normal, es un crash de Node). Fix: en `normalizarJornada`, si el `INSERT` falla
con `err.code === 'ER_DUP_ENTRY'`, releer la fila que la petición concurrente ya insertó y
devolverla en vez de propagar el error. No se tocó el resto de la lógica de cierre ni se agregó
una transacción — el fix es mínimo y quirúrgico, pensado para la carrera específica que se
observó, no una reescritura del mecanismo de cierre perezoso.

**Verificado:** `npm test` sigue en 26/26 (no se tocó `domain/`). Probado en vivo con
`empleado1` y `director.operaciones`: calendario y barras con datos reales, clic en una celda
navega a `/asistencia/trazabilidad?fecha=YYYY-MM-DD` (soporte nuevo también en
`MiTrazabilidad.jsx` del frontend), puntualidad correcta después del fix, sin crashes tras
repetir la carga de la página varias veces seguidas.

**No se tocó:** el backend corría con `node index.js` suelto (sin autorecarga); se reinició con
`npm run dev` (nodemon) para poder iterar, y quedó así corriendo — session-only, no es un cambio
de archivo.

---

## 18. Sesión 2026-10-11 — Integración con AsisLock (login biométrico → jornada)

**Pedido:** que el login/logout en AsisLock (app de escritorio PyQt5 de acceso a las
aplicaciones del call center, repo `Desktop\AsislockBack\asislock`, base MySQL `asislock`)
alimente el tiempo laborado. AsisLock tiene la tabla `login_biometrico` (`id, usuario, fecha,
hora_login, hora_logout, estado_conexion, ip_local, ip_publica, aplicativo,
conectado_biometrico`). Ojo: el repo de AsisLock que se revisó **no** escribe esa tabla (usa
`login`/`registro_login`); la llena otro componente.

**Decisiones del usuario:**
- `usuario` = **cédula** → `users_company.numero_identificacion` (se ignoran puntos/espacios/guiones).
- Logout antes de la ventana de salida = **desconexión no laborada**; el siguiente login la cierra.
  Logout dentro de la ventana de salida (`minutos_habilitar_salida`, 10 min) o después = **salida**.
- Vale la **hora que reporta AsisLock** (hora de Bogotá), no la de llegada. Excepción documentada
  a la regla "el servidor pone la hora" (§2.1): solo para `origen='asislock'`.
- Baño y almuerzo **siguen en Gestor**; mientras está desconectado no puede iniciarlas (422).

**Contrato:** `POST /api/integraciones/asislock/v1/registros` con `{ registros: [filas de
login_biometrico] }` (máx. 500) y `GET /salud`; cabecera `x-api-key`. Documento para el equipo de
AsisLock, con script de envío de ejemplo: [`docs/asislock/API_AsisLock.md`](docs/asislock/API_AsisLock.md).
Respuesta 200 con un resultado por registro y por evento (`registrado | duplicado | ignorado |
rechazado` + `accion`/`motivo`). Idempotente por `(asislock_id, evento)`; un `rechazado` sí se
reprocesa al reenviarlo (p. ej. tras crear la ficha que faltaba).

**Migración `062_asistencia_asislock.sql`** (aplicada en local; en producción ya está `ASISLOCK_API_KEY` en el `.env`, **falta confirmar que la 062 se corrió**):
`jornada_evento.tipo` + `inicio_desconexion`/`fin_desconexion`, `jornada_evento.origen` + `asislock`
(ENUMs reescritos completos), `jornada.minutos_desconexion`, tabla `asislock_registro`
(bitácora/idempotencia) y parámetros `asislock_tolerancia_futuro_min` (5) y
`asislock_max_horas_atraso` (72). No es idempotente: correr una sola vez.

**Archivos (mismas 4 capas):**
- `domain/asistencia/asislock.js` — puro: normaliza fecha/hora/cédula, `instantesDelRegistro`
  (logout < login ⇒ día siguiente), `motivoRechazoHora`, `decidirLogin`/`decidirLogout`,
  `desconexionAbierta`. `calcularJornada` ahora descuenta `minutosDesconexion` y expone
  `desconexionActiva` (estado `en_pausa`); `assertPuedeIniciarPausa` bloquea si está desconectado.
- `repositories/asistencia/asislockRegistroRepository.js`, `empleadoRepository.js` (cédula → id).
- `services/asistencia/asislockService.js` — un login/logout = una transacción (`FOR UPDATE` sobre
  el registro y la jornada), eventos aplicados en orden cronológico, reintento ante
  `ER_DUP_ENTRY`/`ER_LOCK_DEADLOCK`. Si hay pausa de baño/almuerzo abierta al logout, la cierra
  antes de la desconexión.
- `cierreService.normalizarJornada`: si la jornada termina con una desconexión abierta, la salida
  se registra **a la hora de ese logout** (`origen='asislock'`, sin alerta `sin_marcar_salida`), no
  en la hora programada.
- `controllers/asistencia/asislockController.js`, `routes/integracionAsislock.js` (montada en
  `index.js` antes de `express.json()`, con su propio límite de 1 MB),
  `middleware/autenticarAsislock.js`, `config/integracionAsislock.js`,
  `validators/asislockSchemas.js`.
- `.env`: `ASISLOCK_API_KEY` (obligatoria; sin ella 503), `ASISLOCK_API_KEY_ANTERIOR` (rotación),
  `ASISLOCK_IPS_PERMITIDAS` (opcional, lista blanca).
- Frontend: etiquetas de los eventos nuevos y origen "AsisLock" en la trazabilidad, hueco en la
  barra durante la desconexión, aviso en Mi Jornada (se ocultan baño/almuerzo) y badge
  "Desconectado de AsisLock" en Equipo.

**Seguridad:** la clave **no** debe ir en el `.exe` de AsisLock (extraíble en cada PC); el envío lo
hace un proceso en servidor. El tráfico va por HTTP a la IP pública de Gestor (mismo caveat que
Hydra). Se vio además que el repo de AsisLock tiene credenciales de MySQL en el código y arma SQL
con `.format()` — fuera de este alcance, avisado al usuario.

**Verificado:** `npm test` 130/130 (24 nuevos en `tests/asistencia/asislock.test.js`). En vivo
contra el servidor local: 401 sin clave, 400 por forma, entrada → desconexión → reconexión →
salida (218 min = 233 brutos − 15 desconectado, 5 min de salida anticipada), duplicados,
`empleado_no_encontrado`, `hora_futura`, cierre del día con desconexión abierta (salida a la hora
del logout), y en Chrome la trazabilidad y el aviso de Mi Jornada. El script de ejemplo del
documento se ejecutó contra la API local.

---

## 19. Sesión 2026-10-11 — Cuenta de empleado automática para toda ficha de RRHH

**Pedido:** que todo empleado, sin importar su cargo, pueda ver su asistencia sin que el admin
cree las cuentas una por una.

**Decisiones del usuario:**
- Toda ficha de RRHH tiene un usuario de **empleado**: usuario = cédula, contraseña inicial =
  cédula, con **cambio obligatorio en el primer ingreso**.
- Quien ya tiene cuenta con otro rol (coordinador, jefe de operaciones, técnico…) **conserva la
  suya** y además recibe la de empleado (esas cuentas no estaban vinculadas a ninguna ficha, así
  que no chocan con `uq_users_users_company`).
- **RRHH** no recibe cuenta aparte: su cuenta ya está vinculada a su ficha porque
  `userCompanyController.create()` usa ese `users_company_id` como *analista encargado* del alta
  (no se puede desvincular). En cambio, su cuenta de RRHH ganó acceso a "Mi asistencia".
- `director_operaciones` y `empleado` que ya tenían cuenta vinculada no se tocan.
- Si RRHH retira al empleado (contrato más reciente `retirado` o `inactivo`, o sin contrato), la
  cuenta **deja de entrar** (403 en el login); si lo reintegran, vuelve a entrar sola.

**Migración `063_cuentas_empleado_automaticas.sql`** (se puede repetir): `users.debe_cambiar_password`.

**Backend:**
- `User.crearCuentaEmpleadoEnConexion(conn, …)`: crea la cuenta dentro de la transacción de quien
  llama; si la ficha ya tiene cuenta o la cédula ya es un usuario, no falla (devuelve el motivo).
- `UserCompany.crearEnConexion` la llama al final → la reciben solos los empleados nuevos del alta
  manual, del import masivo y del registro desde Hydra.
- `scripts/crearCuentasEmpleados.js` — backfill de las fichas existentes; **simula por defecto**,
  crea con `--aplicar`, idempotente, reporta cédulas que ya son usuario de otra cuenta.
- Login: bloquea cuentas vinculadas a una ficha retirada; el JWT y la respuesta llevan
  `debe_cambiar_password`. `verifyToken` responde 403 `CAMBIO_PASSWORD_REQUERIDO` a todo salvo
  `/api/auth/me` y `/api/auth/change-password` mientras la marca esté activa. `change-password`
  rechaza una nueva igual al usuario o a la actual, quita la marca y devuelve una sesión nueva.
- `canRegistrarAsistencia` incluye `recursosHumanos`.
- `scripts/seedEmpleadosAsistencia.js`: reemplaza la cuenta automática de sus fichas de prueba
  por el login fijo del seed, ya vinculado.

**Frontend:** pantalla `CambiarPasswordObligatorio` en `/cambiar-password` (todo `ProtectedRoute`
redirige ahí mientras haga falta; el interceptor de `api.js` también ante el 403); RRHH tiene
"Mi asistencia" en su menú, que abre las pantallas de asistencia con el layout de asistencia y un
enlace de vuelta a Recursos Humanos.

**Verificado en local:** migración aplicada dos veces sin error; backfill: 388 cuentas creadas,
10 fichas que ya tenían cuenta intactas (3 director, 5 empleado, 2 RRHH), re-ejecución sin cambios.
Contra el servidor: login con cédula → 403 en cualquier endpoint menos `me`/cambio → cambio con la
cédula rechazado → cambio válido devuelve token y desbloquea → la cédula ya no sirve → ficha
retirada = 403 / reintegrada = 200 → RRHH vinculado ve su asistencia y sigue con su módulo. Alta de
un empleado nuevo crea su cuenta (probado dentro de una transacción revertida). En Chrome: el
primer ingreso lleva a la pantalla de cambio y al guardar entra a Mi Jornada.

**Pendientes / a tener en cuenta:**
- Si RRHH corrige la cédula de una ficha, el usuario de la cuenta sigue siendo la cédula vieja.
- `MiJornada` sigue marcando la entrada al abrirse (comportamiento de la Fase 5). Con AsisLock como
  fuente, abrir Gestor para *consultar* crea una entrada a esa hora (si AsisLock ya marcó antes,
  manda la más temprana; pero en un día libre crearía una jornada). Decidir si se apaga el
  marcaje automático para quien marca por AsisLock.
- El login no tiene límite de intentos; con usuarios = cédula conviene agregarlo.

**Estado (2026-10-12):** probado en local, sin commitear ni desplegar. *(Commiteado y desplegado
el 2026-10-19, ver §22; falta confirmar que el script se corrió en producción.)* Orden para producción: 063 →
pull + `pm2 restart gestor-backend` → `node scripts/crearCuentasEmpleados.js` (revisar) → `--aplicar`
→ frontend `git pull && npm install && npm run build && chmod -R a+rX dist`.

---

## 20. Sesión 2026-10-19 — Prueba end-to-end y tres correcciones

**Prueba nueva:** `tests/e2e/asistencia.e2e.js` (`npm run test:e2e`). Hace peticiones HTTP reales
contra el backend y la BD local, con 86 verificaciones:
- permisos;
- plantillas y asignación de horarios;
- la jornada completa en Gestor, con pausas, salida, trazabilidad y estadísticas;
- horas extra;
- las vistas del director y el evento manual;
- la API de AsisLock (clave, `id` como texto o `null` → 400, entrada → desconexión → reconexión →
  salida = 209 min, duplicados, cédula inexistente, hora futura);
- la cuenta por cédula con cambio obligatorio de contraseña (063).

Si no recibe `E2E_BASE`, levanta su propio servidor en el puerto 5099 con una `ASISLOCK_API_KEY`
de prueba, sin tocar `.env`. Borra al empezar y al terminar lo que crea en el día para las fichas
7-11 del seed (`--conservar` lo deja para mirarlo en el frontend) y deja como estaba la cuenta por
cédula que usa. Hay que correrla entre las 04:00 y las 23:40 hora Bogotá. Va aparte de `npm test`,
que sigue sin servidor ni BD; por eso el archivo no termina en `.test.js`.

**Correcciones (la primera corrida dio 80/85):**
- **500 con fechas imposibles.** `middleware/validar.js` revisaba solo el formato del tipo `fecha`,
  así que `2026-13-45` llegaba a MySQL (`Incorrect DATE value`). Ahora también verifica que la fecha
  exista y responde 400. El middleware lo comparten las rutas de Hydra, que también se benefician.
- **Horas extra ya resueltas se podían volver a resolver.** Un director podía rechazar una aprobada,
  o reaprobarla con otros minutos. Ahora `horaExtraService.aprobar`/`rechazar` exigen `pendiente`
  (409 `CONFLICTO_JORNADA`), y `horaExtraRepository.resolver` lleva `AND estado = 'pendiente'` para
  cubrir dos decisiones simultáneas. El frontend (`HorasExtra.jsx`) ya ofrecía los botones solo para
  las pendientes.
- **`scripts/seedEmpleadosAsistencia.js` no corría** ("La campaña seleccionada no existe") porque
  tenía fija la campaña 1 de 035/036, que ya no existe tras cargar los catálogos reales. Ahora la
  resuelve al arrancar: usa la de las fichas de prueba o, si no hay, la primera. Además se quitó un
  aviso "Falta vincular users.users_company_id" que salía siempre, aunque el vínculo existiera.

**Diferencias con el plan, documentadas y no cambiadas:**
- Una segunda pausa y la salida antes de tiempo responden **422**, no 409/403 como decía §7 (ya
  corregido arriba).
- La salida anticipada se calcula y se guarda (`jornada.minutos_salida_anticipada`), pero no viaja
  en `/mi-jornada/hoy` ni genera la alerta que prometía §7.

**Pendiente — baño y almuerzo desde AsisLock:** el usuario confirmó que los botones de baño y
almuerzo también están en AsisLock. Hoy la API (§18) solo recibe login/logout de
`login_biometrico`, y las pausas que lleguen por esa vía no se registran. Falta saber de qué tabla y
con qué campos salen esos eventos en AsisLock: ni el repo local ni el remoto de AsisLock (último
commit de julio de 2026) tienen esos botones.

## 21. Sesión 2026-10-19 — Copia de `login_biometrico` en Gestor (migración 064)

El usuario pidió que Gestor guarde los datos que envía AsisLock en una tabla con la misma forma que
`login_biometrico` de AsisLock. Definición en AsisLock (dada por el usuario):
`id int AUTO_INCREMENT PK, usuario varchar(11), fecha varchar(20), hora_login time, hora_logout time,
estado_conexion varchar(20), ip_local varchar(50), ip_publica varchar(50), aplicativo varchar(80),
conectado_biometrico varchar(15)`.

- **Tabla nueva `login_biometrico`** (064): mismas columnas, una fila por `id` de AsisLock (no es
  autoincremental en Gestor), más `recibido_en`/`actualizado_en`. Diferencias deliberadas: `usuario`
  es `VARCHAR(20)` (lo que acepta la API) y las horas se guardan normalizadas a `HH:MM:SS`; una hora
  inválida queda `NULL` aquí y cruda en `asislock_registro`.
- **`asislock_registro` sigue igual** (una fila por login/logout, con resultado y motivo: es la llave de
  idempotencia). Solo `estado_conexion` pasa de `TINYINT` a `VARCHAR(20)`.
- `repositories/asistencia/loginBiometricoRepository.guardar` hace upsert. `hora_login`/`hora_logout`
  usan `COALESCE`: un reenvío atrasado sin logout no borra un logout ya recibido.
- `asislockService.recibirRegistros` guarda la copia de cada registro antes de procesar sus eventos,
  aunque luego se rechacen o ignoren. Un envío que no pasa la validación (400) no guarda nada.
- El validador acepta `estado_conexion` como texto de hasta 20 caracteres, número o `null` (antes
  solo entero: con el `varchar(20)` de AsisLock habría dado 400).
- `id` sigue exigiéndose como número JSON > 0. El 400 de `registros[0].id` que vio AsisLock se va
  con el `id int AUTO_INCREMENT` de su tabla, siempre que el envío no lo convierta en texto.
- E2E: 89/89 (3 checks nuevos sobre la copia); unitarios 130/130. 064 aplicada en local, **no en
  producción** (requiere la 062 antes).

**Mismo día — el cliente de AsisLock (proyecto `block`, fuera de este repo):** la tabla real en
AsisLock es `registro_login` (no `login_biometrico`): `id int AUTO_INCREMENT, usuario int, fecha
varchar(20), hora_login time, hora_logout time, estado_conexion tinyint`. El 400 de `id` venía de
`ConexionDB.envio_datos` (`connection/conexion.py`), que armaba el registro con la hora del equipo y
**sin `id`**; además el logout (`panelEstados.desconectar`) nunca se enviaba. Se corrigió en `block`:
`envio_datos` lee la última fila de `registro_login` del usuario y la manda con su `id`, y
`desconectar` la reenvía con `hora_logout` antes de apagar el equipo. Como el logout no conoce
`conectado_biometrico`, `loginBiometricoRepository` lo conserva con `COALESCE`. Probado contra
Gestor local: 200, la copia queda con login y logout.
**Origen de baño/almuerzo encontrado:** `panelEstados.cambiarEstado` guarda cada cambio de estado en
`asislock.conexion_asislock` (`estado_conexion` 1 Conectado, 2 Break, 3 Almuerzo, 4 Capacitación,
5 Baño, 0 Desconectar; `nombre_estado_conexion`, `fecha`, `hora_login`), una fila por clic, y hoy no
se envía a Gestor.

**Mismo día — `id` opcional (064 reescrita antes de desplegarse):** el usuario confirmó que otro
sistema enviará sin `id`. La identidad de cada evento pasa a una `llave`: `id:<id>` si vino el id;
si no, `cc:<cédula>|<fecha>|<hora del evento>` (`domain/asistencia/asislock.js`, `llaveEvento` y
`llaveSesion`). `asislock_registro` es única por `(llave, evento)` y `asislock_id` admite NULL.
`login_biometrico` pasa a tener PK propia (`idlogin_biometrico`), `llave` única y el id de AsisLock
en `asislock_id`. Un logout sin id ni `hora_login` cierra la sesión **sin id** abierta de esa cédula
ese día (la E2E encontró que, sin ese filtro, cerraba una sesión con id de la misma cédula). La
decisión de jornada (entrada/desconexión/salida) ya dependía solo del estado de la cédula, no del id.
Contrato actualizado (`docs/asislock/API_AsisLock.md` §3.3). Unitarios 132/132, E2E 97/97.

**Producción, 2026-10-19:** el usuario corrió `migraciones_produccion_062_064.sql` (062+063+064
consolidadas e idempotentes, generado en Descargas). Por el log: la 062 ya estaba aplicada (columna,
tabla y parámetros existían), la 063 y la 064 entraron ese día; `asislock_registro` tenía 10 filas, que
recibieron su `llave = 'id:<id>'`. Hasta desplegar el código nuevo, el backend viejo de producción no
llena `llave` (NOT NULL) y falla al recibir envíos de AsisLock. *(Ya desplegado el mismo día, ver
§22.)*

> Nota: los puntos de la lista del principio de §21 que dicen "una fila por `id`" y "`id` sigue
> exigiéndose" quedaron superados por el párrafo "`id` opcional". Lo vigente es la `llave`.

## 22. Sesión 2026-10-19/20 — Despliegue, prueba en producción con la ficha 1010 y pendientes

**Commits y despliegue (2026-10-19):**
- Backend `4cfc7e6` en `sebas-branch`: cuentas por cédula (063), copia de `login_biometrico` con id
  opcional (064), E2E de asistencia y las correcciones de §20.
- Frontend `9bb3f2f` en `sebas-branch`: `CambiarPasswordObligatorio.jsx`, `App.jsx`,
  `AuthContext.jsx`, `api.js`, `RecursosHumanosLayout.jsx`, `AsistenciaLayout.jsx` (pantalla de
  cambio obligatorio de contraseña de la 063).
- El usuario hizo el merge a `main` y desplegó ambos repos en producción. Las migraciones ya
  estaban (062-064, ver §21).

**Ficha de prueba en producción:** `Descargas\empleado_prueba_asislock_1010.sql` crea
"PRUEBA ASISLOCK", cédula `1010` (CC), con un contrato copiado del agente de Claro vigente más
reciente con `jefe_area_id` (mismo cliente, campaña, cargo, oleada, ciudad, empresa y los mismos
jefes). Usa nombres de catálogo, no IDs (los de producción no son los locales), corre en una
transacción y es idempotente. No crea cuenta de login. Trae comentado al final el `UPDATE` que
la retira (estado `retirado`, sin borrarla: su jornada y los registros de AsisLock la referencian).

**Resultado de la prueba (2026-10-19, horas Bogotá), en `asislock_registro`:**
- 14:42-14:54, cuatro `login rechazado empleado_no_encontrado`: aún no existía la ficha 1010.
- 14:55:30 `login registrado entrada`: abrió la jornada. **La integración funciona en producción.**
- 14:57:45 `login ignorado ya_conectado`: segundo login sin logout de por medio. Correcto.
- `asislock_id` vacío y ningún `logout`: la copia de AsisLock que se usó **no es la de `block`
  corregida** (§21), que manda el `id` y el logout al desconectar.
- Falta completar el flujo: un logout (debe dar `desconexion`) y otro login (`reconexion`). Se le
  pasó al usuario cómo enviarlos a mano con `Invoke-RestMethod` contra
  `/api/integraciones/asislock/v1/registros` mientras se porta el arreglo. Las horas deben ser
  pasadas (más de 5 min adelante = `hora_futura`) y posteriores al último evento
  (si no, `fuera_de_orden`).

**Pendientes (consolidado al 2026-10-20, mañana) — superada por §28:**

*Prueba y despliegue*
1. Terminar la prueba de la 1010 (logout → `desconexion`, login → `reconexion`) y luego retirar la
   ficha con el `UPDATE` comentado del script.
2. Portar los dos cambios de `block` a la copia de AsisLock que se usa de verdad:
   `ConexionDB.envio_datos` (lee la última fila de `registro_login` y manda su `id`) y la llamada en
   `panelEstados.desconectar` que envía el logout. Ojo: `desconectar` apaga el equipo
   (`shutdown /s /t 0`), probarlo en una máquina que se pueda apagar.
3. Confirmar en producción `node scripts/crearCuentasEmpleados.js` (revisar) y luego `--aplicar`
   (cuentas por cédula de las fichas existentes, §19). No hay constancia de que se haya corrido.

*Seguridad en `block` (cliente AsisLock)*
4. La API key de AsisLock y las credenciales de su BD están quemadas en el código de `block`:
   rotar la key y pasarlas a variables de entorno.
5. `block` arma SQL con `.format(...)`: parametrizarlo.

*Funcionalidad*
6. **Baño/almuerzo desde AsisLock.** Origen: `asislock.conexion_asislock` (una fila por clic;
   `estado_conexion` 1 Conectado, 2 Break, 3 Almuerzo, 4 Capacitación, 5 Baño, 0 Desconectar). Falta
   que el usuario decida qué hacer con Break y Capacitación (Gestor solo tiene pausas `bano` y
   `almuerzo`), y luego extender la API (o crear un endpoint de estados) y `block` para enviarlos.
7. Decidir si se apaga el marcaje automático de entrada al abrir "Mi jornada" para quien marca por
   AsisLock (§19; en la prueba en Chrome le marcó entrada al director sin horario).
8. Límite de intentos en el login (los usuarios ahora son cédulas).
9. Sincronizar el usuario de la cuenta cuando RRHH corrige la cédula.
10. Salida anticipada: se guarda en `jornada.minutos_salida_anticipada` pero no viaja en
    `/mi-jornada/hoy` ni genera la alerta de §7.

*Errores de interfaz de la prueba en Chrome (2026-10-19, todos del frontend, sin corregir)*
11. Los contadores saltan hasta ±30 s al recargar y en cada resincronización de 60 s:
    `src/hooks/useJornada.js` multiplica por 60 minutos que el servidor redondea. Para la pausa,
    usar `pausa_activa.desde`.
12. En "Equipo hoy" la tarjeta "En pausa" cuenta 0 mientras la pestaña "En pausa" cuenta 1: la
    tarjeta solo suma baño y almuerzo y deja fuera al desconectado de AsisLock
    (`EquipoAsistencia.jsx:76-77`).
13. ~~Los contadores del menú ("Horas extra", "Equipo hoy") no se actualizan~~ — corregido 2026-10-20 (§25). `AsistenciaLayout.jsx`
    los carga una sola vez al montarse.
14. Una jornada finalizada sigue mostrando "Salida programada 9:00 · en 9 min" y no la hora real de
    salida.
15. Menores: scroll horizontal en "Horas extra" del empleado; la plantilla acepta un almuerzo fuera
    del turno sin avisar; el botón de la tarjeta de pausa no respondió al primer clic dos veces
    (puede ser la herramienta de automatización, probar a mano).

*Arrastrados de antes*
16. Rotar el `JWT_SECRET` de producción y de pruebas (es el texto de ejemplo) y las claves que se
    pegaron en el chat (ver `claude/contextoriginal.md` §12.5).
17. Hydra: confirmar las migraciones 059-061 en producción (`conexionhydra.md` §14.8).

## 23. Sesión 2026-10-20 — Todo jefe de área gestiona su equipo, sin rol de director

**Pedido:** dejar de depender del rol `director_operaciones` para asignar horarios. Todo empleado
ya tiene su cuenta por cédula (§19); si además tiene empleados a cargo (ej. Kevin Buitrago), esa
misma cuenta debe poder gestionar a su equipo. Sin afectar las cuentas ya creadas.

**Decisión: el permiso se deriva, no se guarda.** Jefe de equipo = ficha que es `jefe_area_id` de
al menos un contrato `activo`/`periodo_prueba` (la misma jerarquía de §16). No hay tabla nueva ni
cambio de rol: una tabla de "jefes" se desincronizaría cada vez que RRHH cambie un jefe de área, y
el dato ya vive en `contrato`. El rol `director_operaciones` sigue funcionando igual (por rol pasa
siempre); simplemente deja de ser necesario. No confundir con `jefe_operaciones`, que es un rol del
módulo de incidentes y no se tocó.

**Backend:**
- `equipoRepository.tieneEmpleadosACargo` + `equipoService.esJefeDeEquipo`.
- `middleware/auth.js` → `canDirigirEquipo`: deja pasar a `director_operaciones`/`admin` por rol, o
  a cualquier cuenta cuya ficha tenga gente a cargo, **consultado en cada petición** (si RRHH le
  quita el equipo, pierde el acceso en el acto aunque su token siga vigente).
  `routes/asistencia.js` lo usa en las 17 rutas de equipo/horarios/horas extra en lugar de
  `isDirectorOperaciones` (que sigue exportado). Qué empleados puede tocar lo sigue validando
  `assertEmpleadoACargo` en cada servicio, como antes.
- `authController`: `login` y `change-password` devuelven `user.esJefeEquipo`; `/auth/me` devuelve
  `es_jefe_equipo`. Solo informa al frontend; no viaja en el JWT.
- Las notificaciones por socket al jefe (`directorUserIdDe`) ya funcionaban con cualquier cuenta
  vinculada a la ficha del jefe, así que no cambiaron.

**Frontend:** `AuthContext.isDirectorOperaciones` ahora es `role === 'director_operaciones'` **o**
`role === 'empleado'` con `esJefeEquipo`/`es_jefe_equipo`. Con eso el jefe entra a `/operaciones`
(`RedirectByRole`/`DashboardRoute`), ve "Equipo hoy", "Horarios" y la bandeja de horas extra, y
el layout lo rotula "Jefe de equipo". Se limitó a `empleado` a propósito: una cuenta de RRHH u otro
rol con gente a cargo no cambia de pantallas (los endpoints sí la dejarían pasar).

**Verificado:** unitarios 132/132; E2E 105/105 (sección 1b nueva: empleado1 recibe temporalmente a
empleado5, ve solo a él, le asigna y borra un horario, recibe 403 con empleado2, y pierde el acceso
con el mismo token al restaurar el contrato). En la BD local hay 6 jefes de área con cuenta
`empleado` que ganan el acceso y 2 con `director_operaciones` (Kevin entre ellos), sin cambios.

**Pendiente:** commit y despliegue de ambos repos (frontend con rebuild de `dist/`). No requiere
migración. En producción, los jefes solo tendrán su cuenta si ya se corrió
`crearCuentasEmpleados.js --aplicar` (pendiente 3 de §22).

## 24. Sesión 2026-10-20 — Cuentas de empleado en su propia tabla (`cuenta_empleado`, migración 065)

**Pedido:** que las cuentas de empleado (cédula / cédula, para ver su trazabilidad diaria) estén
separadas de los usuarios del sistema, para no afectar los usuarios ya creados.

**Decisiones del usuario:**
- Las cuentas que la 063 creó dentro de `users` **se mueven** a la tabla nueva y se borran de `users`.
- **Misma pantalla de login**: el backend busca primero en `users` y, si ese usuario no existe ahí,
  en `cuenta_empleado`. Si existe en `users`, solo vale la contraseña de `users`.
- Las cuentas vinculadas a mano (los 3 `director_operaciones` con Kevin, `empleado1..5` del seed,
  los 2 de RRHH) **se quedan en `users`** como están y su ficha no recibe cuenta en la tabla nueva.

**Migración `065_cuenta_empleado.sql`** (aplicada en local; **no en producción**):
- Tabla `cuenta_empleado`: `users_company_id` único, `usuario` (cédula) único, `password`,
  `debe_cambiar_password`, `ultimo_ingreso`, `movida_de_user_id` (de qué `users.id` vino).
- Columnas de autor paralelas a las `*_por_user_id`: `horario_plantilla.creado_por_cuenta_id`,
  `horario_asignado.creado_por_cuenta_id`, `hora_extra.solicitado_por_cuenta_id` y
  `aprobado_por_cuenta_id`, `jornada_evento.registrado_por_cuenta_id` (FK a la tabla nueva,
  `ON DELETE SET NULL`). `jornada.ajustada_por_user_id` no tiene paralela: ningún código la escribe.
- Mueve las cuentas de la 063 (rol `empleado` cuyo usuario es la cédula de su ficha), con su
  contraseña y su marca de cambio; reapunta la auditoría de asistencia y borra la fila de `users`.
  **No mueve** una cuenta que otra tabla fuera de asistencia referencie (incidentes, diseños,
  Hydra, activos…: varias tienen `ON DELETE CASCADE`); el `SELECT` final las lista.
- La parte de `ADD COLUMN` no es idempotente: correr **una sola vez**. Requiere la 063.

**Backend:**
- `models/CuentaEmpleado.js` (patrón de `models/`, porque lo usan el login, el alta de RRHH y los
  scripts). `User.crearCuentaEmpleadoEnConexion` se eliminó. `UserCompany.crearEnConexion` llama a
  `CuentaEmpleado.crearEnConexion`, que se salta la ficha si ya tiene cuenta (en cualquiera de las
  dos tablas) o si la cédula ya es un usuario.
- Sesión: el JWT de una cuenta de empleado lleva `tipo_cuenta: 'empleado'`, `role: 'empleado'` e
  `id` = `idcuenta_empleado`. La respuesta del login trae `user.tipoCuenta` y `/auth/me`
  `tipo_cuenta`. `change-password` tiene su rama para la tabla nueva. El login registra
  `ultimo_ingreso` y sigue bloqueando la ficha retirada.
- **Aislamiento:** `verifyToken` limita esas sesiones a `/api/auth/*` y `/api/asistencia/*` (403 en
  cualquier otra ruta), porque su `id` no es un `users.id` y puede coincidir con el de otro usuario.
- Autoría: `controllers/asistencia/autor.js` (`autorDe(req)` → `{ userId, cuentaId }`). Los
  parámetros `*PorUserId` de servicios y repositorios pasaron a `registradoPor`/`solicitadoPor`/
  `aprobadoPor`/`creadoPor` con ese objeto, y cada repositorio escribe las dos columnas.
- `userController.createUser`/`updateUser` rechazan (400) un nombre de usuario que ya es la cédula
  de una cuenta de empleado: el login la taparía.
- `scripts/crearCuentasEmpleados.js` crea en la tabla nueva (exige la 065).
  `scripts/seedEmpleadosAsistencia.js` borra la cuenta automática de sus fichas de
  `cuenta_empleado`.
- Las notificaciones por socket al jefe (`directorUserIdDe`) siguen yendo solo a cuentas de
  `users`. Hoy no afecta: ninguna pantalla de asistencia escucha esos eventos.

**Frontend:** sin cambios. La sesión de empleado se ve igual (`role: 'empleado'`), las pantallas de
asistencia solo llaman a `/api/asistencia`, y los hooks de incidentes y diseños están en `Layout`,
que el empleado no usa.

**Verificado en local:** respaldo de las 393 filas `empleado` de `users` antes de migrar; 065
aplicada: 388 cuentas movidas, ninguna quedó en `users`. Backfill en simulación: 0 por crear
(388 en `cuenta_empleado`, 10 vinculadas en `users`). Alta nueva dentro de una transacción
revertida: crea en `cuenta_empleado`, nada en `users`, y no duplica. Unitarios 132/132; E2E
112/112 (la sección 7 ahora: login por cédula en la tabla nueva, 403 en `/api/users` y
`/api/users-company`, y una cuenta de empleado jefe asigna un horario con
`creado_por_cuenta_id`).

**Para producción** (en este orden; la 065 y el código nuevo van juntos: el backend viejo con la
065 aplicada ya no podría crear cuentas de empleado nuevas, y el nuevo sin la 065 falla en el login
de cédulas):
1. Respaldo de `users`.
2. `065_cuenta_empleado.sql`; revisar el `SELECT` final (cuentas que no se pudieron mover).
3. Pull del backend + `pm2 restart gestor-backend`.
4. `node scripts/crearCuentasEmpleados.js` (revisar) y luego `--aplicar`, para las fichas que aún
   no tienen cuenta (pendiente 3 de §22).
5. Frontend con rebuild (por §23).

**Pendiente:** nadie puede restablecer la contraseña de una cuenta de empleado desde el panel (el
admin ya no las ve en `/users`). Hoy sería por SQL; si hace falta, una opción "Restablecer acceso"
en la ficha de RRHH.

**Prueba en Chrome (2026-10-20, local, datos ficticios del seed, revertidos al final):** una cuenta
de `cuenta_empleado` (ficha 12) con la ficha 11 a su cargo. Recorrido: login por cédula → cambio
obligatorio de clave → entra a `/operaciones` rotulado "Jefe de equipo" → entrada automática, pausa
de baño → Equipo hoy (solo su persona a cargo) → crea una plantilla y asigna 4 horarios → `/users`,
`/recursos-humanos` y la API de usuarios, RRHH e incidentes le dan 403 → la empleada (cuenta de
`users`) ve el horario asignado y pide horas extra → el jefe las aprueba → trazabilidad de la
empleada y la propia, estadísticas → `director.operaciones` sigue igual y ya no ve a la ficha 11.
En la BD, toda acción del jefe quedó en las columnas `*_por_cuenta_id` y la solicitud de la
empleada en `solicitado_por_user_id`.

Hallazgos nuevos (sin corregir):
- **Las plantillas de horario son globales**: cualquier jefe ve, edita y elimina las de los demás
  (`horario_plantilla` no tiene dueño ni equipo). Con todos los jefes de área entrando, conviene
  decidir si cada jefe ve solo las suyas.
- "Salida disponible en 374:02": la cuenta regresiva muestra minutos:segundos pasada la hora;
  debería decir "6 h 14 min".
- Al enviar una solicitud de horas extra no aparece aviso de confirmación (sí se guarda).
- Confirmado de nuevo el punto 13 de §22: el contador "Horas extra" del menú no baja al aprobar.

## 25. Sesión 2026-10-20 — Plantillas por jefe y tres correcciones de interfaz

**Plantillas de horario por jefe (migración `066_horario_plantilla_dueno.sql`, aplicada en local, no
en producción).** `horario_plantilla.dueno_users_company_id` = ficha del jefe que la creó. Es la ficha
y no la cuenta para que una persona con usuario del sistema y cuenta por cédula vea las mismas. La
066 asigna el dueño de las existentes por su creador (usuario vinculado o cuenta de empleado) y lista
las que quedan sin dueño, que nadie ve. Requiere la 065.
- `horarioPlantillaRepository.findAll` → `findPorDueno`; `crear` guarda el dueño.
- `horarioService`: `plantillaPropia(id, ficha)` responde **404** si la plantilla es de otro jefe (no
  revela las ajenas). La usan editar, eliminar y la asignación con `plantilla_id`. Listar y crear
  exigen ficha vinculada (antes no), igual que el resto de la gestión de equipo.
- E2E: 6 checks nuevos (el jefe ve solo las suyas; no edita ni elimina las del director; el director
  no ve las del jefe ni asigna con ellas). 118/118.

**Interfaz (frontend):**
- Cuenta regresiva de salida (`BotonesPausa.jsx`): desde una hora muestra "5 h 56 min" (antes
  "374:02"); en la última hora sigue en minutos:segundos.
- Confirmación al pedir horas extra: en `MiJornada.jsx` el aviso salía dentro del modal y se cerraba a
  los 1,2 s; ahora el modal se cierra y queda un aviso en la página por 6 s. En `HorasExtra.jsx` no
  había aviso; ahora sí. El texto dice "tu jefe" en vez de "el director".
- Contadores del menú (`AsistenciaLayout.jsx`, era el punto 13 de §22): se recargan al cambiar de
  pantalla y cuando `HorasExtra.jsx` aprueba o rechaza (evento de `src/utils/eventosAsistencia.js`).

**Verificado en Chrome** (datos ficticios del seed, revertidos): el jefe con cuenta por cédula ve
"Sin plantillas todavía" (ya no la del director), crea la suya y solo esa aparece al asignar; el
aviso de horas extra aparece; al aprobar el contador baja de 4 a 3 y al rechazar a 2; "Equipo hoy"
se actualiza al cambiar de pantalla; la empleada ve "Salida disponible en 5 h 56 min".

**Visto de paso, sin corregir:** el formulario de `HorasExtra.jsx` arranca la fecha con
`new Date().toISOString().slice(0, 10)`, que entre las 19:00 y las 23:59 de Bogotá ya es el día
siguiente (UTC).

## 26. Sesión 2026-10-20 — Fin de las cuentas `director_operaciones`: los jefes entran con su cédula

**Pedido:** que lo que estaba bajo el rol `director_operaciones` ya no funcione así. Kevin Buitrago
(y todo jefe) entra por defecto con su cuenta por cédula y desde ella gestiona a su equipo, como
cualquier jefe de área (§23).

**Decisiones del usuario:** las cuentas `director_operaciones` existentes se **desactivan** (no se
borran: conservan el historial de horarios, aprobaciones y eventos manuales) y el rol sale del
selector de `/users`.

**Migración `067_desactivar_cuentas_director.sql`** (aplicada en local; no en producción): agrega
`users.activo` (1 por defecto, ningún otro usuario cambia) y desactiva todas las cuentas
`director_operaciones`. No las desvincula de su ficha. Requiere la 065.

**Código:**
- Login: una cuenta de `users` con `activo = 0` responde 403 "Esta cuenta ya no está activa. Ingresa
  con tu número de cédula." (después de validar la clave).
- `CuentaEmpleado.crearEnConexion` y `scripts/crearCuentasEmpleados.js` ya no cuentan una cuenta
  desactivada como "la ficha ya tiene cuenta": esas fichas reciben su cuenta por cédula.
- `userController.createUser` ya no acepta `director_operaciones` (`updateUser` sí, para editar las
  existentes). `UserManagement.jsx` lo oculta del selector salvo al editar una cuenta que ya lo tiene.
- El rol sigue en el ENUM y en `canDirigirEquipo`; con las cuentas desactivadas ya no lo usa nadie.
- Seed: el jefe de prueba (ficha 7) entra con su cuenta por cédula `9000000001`, con la clave fija del
  seed y sin cambio obligatorio; `director.operaciones` quedó desactivada.

**Verificado en local:** 067 desactivó 4 cuentas (`director.operaciones`, `jefeprueba` y
`kevin.buitrago`, con ficha, y `Dprueba`, sin ficha, que no recibe cuenta). `crearCuentasEmpleados
--aplicar` creó las 2 que faltaban (Kevin, ficha 25 con 106 personas a cargo, y `jefeprueba`); la del
seed la creó el seed. Contra la API: Kevin entra con cédula/cédula, `esJefeEquipo: true`, y debe
cambiar la clave antes de ver su equipo. E2E 119/119 (la cuenta desactivada → 403; el jefe del seed
entra por cédula); unitarios 132/132.

**Para producción** (en este orden, seguido): respaldo de `users` → 065 → 066 → 067 → pull del backend
+ `pm2 restart gestor-backend` → `node scripts/crearCuentasEmpleados.js` (revisar) → `--aplicar` →
frontend con rebuild. Avisar a Kevin y a los demás jefes que desde ese momento entran con su cédula
(clave inicial = cédula) y que deben cambiarla al primer ingreso. Un token ya emitido de una cuenta
desactivada sigue valiendo hasta que expire (5 h): `verifyToken` no consulta la BD.

**Producción, 2026-10-20:** respaldo `/root/respaldo_antes_065_2026-10-20.sql` (2.7 MB) →
`Descargas\migraciones_produccion_065_067.sql` en Workbench. El primer intento se detuvo con el error
1267 (`users`/`users_company` en producción son `utf8mb4_unicode_ci` y la tabla nueva quedó con el
default del servidor, `utf8mb4_0900_ai_ci`) antes de mover nada; se corrigió comparando las cédulas
con `BINARY` (commit `07389cc`, que **aún no está en `main`**) y el segundo intento terminó sin
errores: 0 cuentas automáticas quedaron en `users` (producción no tenía, el script de la §19 nunca se
había corrido allí), 0 plantillas sin dueño, 1 cuenta `director_operaciones` desactivada. Backend
`main` = merge #14 (`891f0f8`, incluye `ed09eae`) + `pm2 restart`; frontend `git pull` + build.
`crearCuentasEmpleados.js --aplicar`: **389 cuentas creadas** (todas las fichas vigentes, Kevin y la
ficha de prueba 1010 incluidas); 1 ficha ya tenía cuenta (RRHH). Kevin: 107 personas a cargo.
Pendiente: que Kevin entre por primera vez con su cédula (su primer ingreso le corresponde a él),
merge de `07389cc` a `main`, rotar la `ASISLOCK_API_KEY` (se pegó en el chat) y avisar a los
empleados que su usuario y clave inicial son su cédula.

## 27. Sesión 2026-10-20 — "Seleccionar todos" al asignar horarios

**Pedido:** al asignar un horario, poder marcar a todo el equipo de una vez (Kevin tiene 107 personas).

- `GestionHorarios.jsx`: casilla "Seleccionar todos (N)" sobre la lista; con texto en el buscador
  actúa solo sobre lo visible ("Seleccionar los N de la búsqueda") y suma a lo ya marcado. Queda a
  medias (indeterminada) si solo hay algunos marcados. El filtro del buscador ya no se cae con un
  `nombre` vacío (`(e.nombre || '')`, mismo caso que tumbó Equipo en producción en §17).
- `horarioService.asignarMasivo`: valida todo el equipo con una sola consulta
  (`equipoRepository.subordinadosDe`) en vez de una por empleado, quita ids repetidos, e inserta en
  **una transacción** con `horarioAsignadoRepository.insertarVarios` (lotes de 500, mismo upsert por
  `(users_company_id, fecha)`). Antes eran inserciones sueltas sin transacción: un fallo a mitad dejaba
  parte del equipo sin horario. Si una persona no es del equipo, 403 y no se escribe nada.

**Verificado:** en Chrome, el jefe del seed marca a sus 5 con un clic, desmarca una (casilla a
medias), filtra y suma con "los 3 de la búsqueda", y asigna 25 horarios. Con el servicio en local,
la ficha de Kevin (106 personas) por un mes: 2.438 horarios en 0,18 s; con una persona ajena en la
lista, 403 y 0 filas. E2E 119/119, unitarios 132/132.


## 28. Pendientes vigentes (consolidado al 2026-10-20, noche)

Reemplaza la lista de §22. Estado de producción a esta fecha: migraciones hasta la 067; backend `main`
con `ed09eae` (merge #14) y el frontend reconstruido; 389 cuentas por cédula creadas en
`cuenta_empleado`; la cuenta `director_operaciones` que había, desactivada.

*Despliegue en curso*
1. §27 ("Seleccionar todos" y asignación masiva en transacción): backend `f75d87c` y frontend
   `c178dab` en `sebas-branch`; el usuario hace el merge, luego `git pull` + `pm2 restart` y
   rebuild del frontend. Sin migración. El merge del backend lleva también `07389cc` (corrección
   de collation de la 065), que no estaba en `main`.
2. El primer ingreso con la cuenta por cédula de Kevin lo hizo el usuario: que Kevin conozca o
   cambie esa contraseña.
3. Avisar a todos los empleados: usuario y clave inicial = cédula, cambio obligatorio al entrar.

*Prueba y AsisLock*
4. Ficha 1010: terminar la prueba (logout → `desconexion`, login → `reconexion`) y retirarla con
   el `UPDATE` comentado de `Descargas\empleado_prueba_asislock_1010.sql`.
5. Portar a la copia real de AsisLock los dos arreglos de `block` (envío del `id` y del logout).
6. Baño/almuerzo desde AsisLock (`asislock.conexion_asislock`): falta decidir Break y Capacitación.

*Seguridad*
7. **Rotar la `ASISLOCK_API_KEY` de producción**: se pegó en el chat el 2026-10-20. Usar
   `ASISLOCK_API_KEY_ANTERIOR` mientras AsisLock cambia la suya.
8. `block`: credenciales y API key quemadas en el código; SQL armado con `.format()`.
9. Rotar el `JWT_SECRET` de producción y de pruebas y las claves pegadas antes
   (`claude/contextoriginal.md` §12.5).
10. Login sin límite de intentos: ahora son 389 cuentas cuyo usuario es la cédula.
11. Un token de una cuenta desactivada vale hasta que expire (5 h): `verifyToken` no consulta la BD.
12. Nadie puede restablecer la contraseña de una cuenta de empleado desde la interfaz (el admin ya
    no las ve en `/users`): hoy es por SQL. Propuesta: "Restablecer acceso" en la ficha de RRHH.

*Funcionalidad*
13. Marcaje automático de entrada al abrir "Mi jornada" para quien marca por AsisLock.
14. Sincronizar `cuenta_empleado.usuario` cuando RRHH corrige una cédula.
15. Salida anticipada: se guarda pero no viaja en `/mi-jornada/hoy` ni genera alerta.
16. Notificaciones por socket al jefe: `directorUserIdDe` solo encuentra cuentas de `users`, así que
    a un jefe con cuenta por cédula no le llegan (hoy ninguna pantalla las escucha).
17. Una cuenta de RRHH u otro rol con gente a cargo pasa `canDirigirEquipo` en el backend, pero su
    interfaz no muestra la vista de equipo (decisión de §23).

*Interfaz (frontend)*
18. Contadores que saltan hasta ±30 s (`useJornada.js`); tarjeta "En pausa" que no cuenta al
    desconectado de AsisLock; jornada finalizada que sigue mostrando "Salida programada"; scroll
    horizontal en "Horas extra"; plantilla que acepta un almuerzo fuera del turno.
19. `HorasExtra.jsx` arranca la fecha del formulario en UTC: entre 19:00 y 23:59 de Bogotá propone
    el día siguiente.

*Arrastrado*
20. Hydra: confirmar las migraciones 059-061 en producción (`conexionhydra.md` §14.8).

## 29. Sesión 2026-10-21 — Significado de `conectado_biometrico`

El usuario aclaró qué manda AsisLock en `conectado_biometrico`: en el **login**, `Presencial` (el
empleado puso la huella en el biométrico y cruzó el molinete) o `Teletrabajo` (solo se logueó en
AsisLock); en el **logout**, `close` (motivo del cierre: el logout no sabe cómo entró). Los registros
del 19-oct con el campo vacío son de la versión de prueba de AsisLock.

**Corrección:** en la copia por sesión (`login_biometrico`), el logout pisaba el valor del login con
`close`. `loginBiometricoRepository.guardar` y `cerrarSesion` ahora conservan el valor del login
cuando llega el logout (un reenvío del propio login sí puede corregirlo). `asislock_registro` sigue
guardando lo que trae cada evento. El dato no entra en el cálculo de la jornada. Contrato actualizado
en `docs/asislock/API_AsisLock.md`. Probado contra la BD local en una transacción revertida
(sesión sin id y con id); unitarios 139/139.

**Producción:** las sesiones ya guardadas con `close` se recuperan desde el login de la misma llave:
`UPDATE login_biometrico lb JOIN asislock_registro ar ON ar.llave = lb.llave AND ar.evento = 'login'
SET lb.conectado_biometrico = ar.conectado_biometrico WHERE lb.conectado_biometrico = 'close' AND
ar.conectado_biometrico IS NOT NULL AND lb.idlogin_biometrico > 0;`

## 30. Sesión 2026-10-21 — Lo que reporta AsisLock, visible para el empleado y su jefe

**Pedido:** mostrar los datos que envía AsisLock en la pantalla de cada empleado y en las de los
jefes que les asignan horario y los monitorean. (Las cédulas que llegan con `empleado_no_encontrado`
son personas que aún no tienen ficha; RRHH las agregará y AsisLock puede reenviar.)

**Backend (solo lectura, no cambia el cálculo de la jornada):**
- `domain/asistencia/asislock.js`: `modalidadIngreso` (`Presencial`/`Teletrabajo` → `presencial`/
  `teletrabajo`; `close` u otro → null) y `resumenDelDia(registros)` → `{ modalidad` (del último
  login), `modalidades` (si cambió en el día), `primer_login`, `ultimo_evento`, `conectado`,
  `ip_local`, `ip_publica`, `aplicativo }`, o null sin avisos válidos (los rechazados no cuentan).
- `asislockRegistroRepository.findDelDia(ids, fecha)`: avisos de la jornada de ese día (incluye un
  logout pasada la medianoche) o, sin jornada, los de esa fecha reportada. Una consulta para todo el
  equipo.
- `services/asistencia/asislockVista.js` (`resumenesDelDia`, `delDia`), usado por:
  - `GET /mi-jornada/hoy` → `asislock: resumen | null`;
  - `GET /equipo` → `asislock` por empleado;
  - las dos trazabilidades → `asislock: { resumen, registros }` (cada login/logout con resultado,
    acción o motivo, modalidad, `conectado_biometrico` crudo, estado, aplicativo e IP).

**Frontend:** `IngresoAsislock.jsx` (`BadgeIngreso`, `ResumenAsislock`, `RegistrosAsislock`) y
`src/utils/asislock.js` (`MODALIDAD_INGRESO`, `textoConexion`).
- Mi jornada: franja "AsisLock · Presencial/Teletrabajo · Primer login · Conectado/Desconectado desde".
- Equipo hoy: columna "Ingreso" (badge + hora del primer login; al pasar el mouse, el estado de
  conexión), conteo "X presencial · Y teletrabajo" bajo "En turno" y tres columnas más en el CSV.
- Trazabilidad (empleado y jefe): "Ingreso (AsisLock)" en la franja de KPIs, con "(cambió en el día)"
  si hubo las dos modalidades, y la tabla "Registros de AsisLock".
- Gestión de horarios no cambió: el monitoreo diario es Equipo hoy.

**Verificado:** unitarios 143/143 (4 nuevos); E2E 125/125 (sección 6c nueva: Equipo hoy con
teletrabajo/conectado, sin dato/desconectado y sin registros = null; trazabilidad con los 3 avisos y
su acción; Mi jornada con el último evento). Para correr la E2E en este equipo hubo que levantar el
servidor aparte y pasar `E2E_BASE`: con poca memoria tarda más de los 10 s que espera la prueba.
`eslint` sin errores y `vite build` ok. No se probó en el navegador.

**Para producción:** solo código (backend + frontend con rebuild), sin migración.

## 31. Sesión 2026-10-21 — Usuarios de la pantalla gris de AsisLock (migración 071)

**Pedido:** todo empleado que se contrate debe quedar con un usuario para la pantalla gris de
AsisLock, enviado a AsisLock por API, y AsisLock debe validar contra Gestor el inicio de sesión.
**Son credenciales distintas** de la cuenta por cédula del portal (`cuenta_empleado`, §24): cada
una tiene su propia clave.

**Decisiones:**
- Tabla propia `usuario_pantalla_gris` (una por ficha): usuario = cédula (la misma que AsisLock ya
  envía en `registros`), clave inicial = cédula en bcrypt, `debe_cambiar_password = 1`.
- **AsisLock no guarda claves**: valida cada inicio de sesión con `POST /pantalla-gris/validar`.
  El aviso a AsisLock nunca lleva la clave.
- 5 claves erradas seguidas bloquean 15 minutos (`config/integracionAsislock.js` → `pantallaGris`;
  son de la integración, no de `asistencia_parametro`). Usuario inexistente y clave errada
  responden igual (`credenciales_invalidas`) y tardan igual (bcrypt contra un hash señuelo).
- Quien no tiene contrato vigente (retirado/inactivo/sin contrato) responde `usuario_inactivo`, y
  solo si dio la clave correcta. Se calcula en vivo desde el último contrato: no hay columna
  `activo` que mantener.

**Backend:**
- `domain/asistencia/pantallaGris.js`: `contratoVigente`, `estaBloqueado`, `decidirValidacion`,
  `motivoClaveNuevaInvalida`, `cuerpoAviso`.
- `repositories/asistencia/usuarioPantallaGrisRepository.js` y `asislockEnvioRepository.js`
  (outbox `asislock_envio_saliente`, mismo esquema que el de Hydra).
- `services/asistencia/pantallaGrisService.js`: `crearEnConexion` (crea y encola `alta`; no lanza,
  devuelve el motivo, como `CuentaEmpleado.crearEnConexion`), `avisarEnConexion` (`baja`/
  `reactivacion`), `eliminarEnConexion`, `validar`, `cambiarClave`, `listarUsuarios`.
- `services/asistencia/asislockDespachoService.js`: `POST <ASISLOCK_CALLBACK_URL>/usuarios` con
  `x-api-key` e `Idempotency-Key`; reutiliza `decidirResultadoEnvio` del outbox de Hydra.
- Ganchos, todos dentro de la transacción existente: `UserCompany.crearEnConexion` (alta manual,
  Excel e Hydra), `Retiro.registrar` (`baja`), `Retiro.reactivar` (`reactivacion`),
  `UserCompany.delete` (`baja` y borra el usuario).
- Endpoints nuevos en `/api/integraciones/asislock/v1` (misma `x-api-key`):
  `POST /pantalla-gris/validar`, `POST /pantalla-gris/cambiar-clave`, `GET /pantalla-gris/usuarios`.
- Scripts: `node scripts/crearUsuariosPantallaGris.js [--aplicar]` (fichas vigentes que ya
  existían; simula por defecto; en local: 398) y `node scripts/despacharEnviosAsislock.js` (cron
  cada minuto). `.env`: `ASISLOCK_CALLBACK_URL` y `ASISLOCK_CALLBACK_API_KEY`; sin ellas los avisos
  esperan en el outbox.
- Contrato y guía de implementación para el equipo de AsisLock: `docs/asislock/API_AsisLock.md` §8
  (tareas de su lado en §8.1, endpoint de avisos con tabla y ejemplo Flask en §8.3 —el upsert que
  ignora avisos atrasados se probó en MySQL—, mensajes por motivo en §8.4-§8.5, intercambio de
  URL/claves y orden de puesta en marcha en §8.8).

**Verificado:** unitarios 150/150 (7 nuevos). Prueba local contra un servidor en 5099 y un AsisLock
falso, 26/26: alta sin duplicar, validación con clave inicial, inexistente, 400 y 401, bloqueo a
los 5 fallos (4 no bloquean), reglas de clave nueva, la clave del portal no cambia, lista sin claves,
retiro → `usuario_inactivo` y reactivación, despacho de alta/baja/reactivación en orden con
`x-api-key` e `Idempotency-Key` y sin clave, AsisLock caído → queda pendiente. Alta real por
`UserCompany.crearEnConexion` en una transacción revertida: crea la cuenta del portal, el usuario
de pantalla gris y el aviso. No se probó contra AsisLock real (su endpoint de avisos no existe aún).

**Para producción — orden obligatorio:** correr la 071 **antes** de subir el código: sin la tabla,
registrar un empleado falla (el gancho está dentro de la transacción del alta).

**Pendiente:**
- AsisLock: implementar su `POST /usuarios` (§8.4 del documento) y pasar URL y clave; cambiar la
  pantalla gris para validar con §8.1/§8.2.
- Decidir si se corre el backfill en producción (crea usuarios para todos los empleados vigentes
  y encola un alta por cada uno).
- Sin pantalla en Gestor todavía: RRHH no puede restablecer la clave de pantalla gris de un
  empleado que la olvidó (hoy: a mano en la BD).

**Revisión 2026-10-22 (migración 075) — sin cambio de contraseña obligatorio:** los usuarios de
pantalla gris se crean con clave por defecto = cédula y **ya no se les pide cambiarla**
(`debe_cambiar_password` DEFAULT 0, y apagada en los ~390 ya creados), para que el agente no quede
bloqueado si la olvida; quien quiera, igual puede cambiarla. El cambio es de una línea en
`usuarioPantallaGrisRepository.insertar` (0 en vez de 1) más la migración 075. **No toca
`cuenta_empleado`**, que sí sigue pidiendo el cambio al primer ingreso. Esto cubre en parte el
pendiente de arriba: al no caducar, se olvida menos; falta igual la pantalla de RRHH para
restablecerla. Pendiente en producción (va después de la 071, ya aplicada).

## 32. Sesión 2026-10-21 — Rol `financiera` y reporte de horas extras (migraciones 072 y 073)

**Pedido y evolución.** Primero se montó un flujo manual (072): el jefe armaba el reporte del mes
repartiendo las horas y se lo **enviaba** a financiera, que lo aprobaba o devolvía con fecha
límite y recordatorios en la campana. El mismo día el usuario lo replanteó: **el reporte se llena
solo** con las horas extra que el jefe aprueba, **no se envía**, y financiera lo ve **en tiempo
real**. Además, financiera ve el mismo reporte que el jefe **más el costo en dinero, por campaña y
totales**. La revisión se implementó en la **073**, que deja sin uso el andamiaje de la 072.

**Decisiones (confirmadas con el usuario):**
- **Clase de cada hora extra:** la elige el agente al solicitarla (las 5 del formato V.3) y el jefe
  la ajusta al aprobar. Vive en `hora_extra.clase` (073).
- **Sin envío ni aprobación:** el reporte del mes = agregación en vivo de las horas aprobadas por
  empleado y clase. Las aclaraciones salen del `motivo` de cada hora.
- **Dinero (solo financiera):** valor hora = salario vigente (`historial_salarial`,
  `fecha_vigencia_fin IS NULL`) ÷ 240. Factores de ley por clase: recargo nocturno 0,35; extra
  diurna 1,25; extra nocturna 1,75; dominical/festiva 0,90; extra dom/fest 2,15 (= 1 + 1,15). Los
  recargos pagan solo el %, las extras la hora + el %. El dinero se redondea por clase y luego se
  suma, para que las líneas cuadren con el total. Empleado sin salario → dinero 0.
- **Financiera = admin de RRHH y asistencia**, con su propia asistencia y la trazabilidad de
  cualquier empleado por campaña (esto no cambió entre 072 y 073).

**Migración 072** (sigue vigente solo por el rol): agrega `financiera` al ENUM de `users.role`.
Sus tablas (`periodo_horas_extra`, `reporte_horas_extra`, `reporte_horas_extra_detalle`) y el
parámetro `dias_aviso_reporte_horas_extra` las **elimina la 073**. Si la 072 no corrió en un
servidor, se aplica 072 y luego 073 (en ese orden); si ya corrió, basta la 073.

**Migración 073:** `hora_extra.clase` ENUM (default `extras_diurnas` para las filas viejas) y
`DROP` de las tres tablas de la 072 + borrado del parámetro. Idempotente. **Aplicada en local el
2026-10-21; 072 y 073 pendientes en producción.**

**Backend (cuatro capas):**
- `domain/asistencia/reporteHorasExtra.js`: puro. Clases, `FACTOR_DINERO`, `DIVISOR_HORAS_MES`,
  `valorHora`, `dineroDeClase/dineroDeFila`, `filaReporte` (minutos→horas y, con `conDinero`, pesos)
  y `totalesDe`.
- `repositories/asistencia/reporteHorasExtraRepository.js`: `reporteDelMes({ jefeId?, campaniaId?,
  desde, hasta })`, una fila por empleado con los minutos sumados por clase (SUM CASE), salario
  vigente y campaña. `horaExtraRepository` gana `clase` en insertar/resolver. Se eliminaron
  `periodoHorasExtraRepository`, `equipoRepository.datosParaReporte` y
  `horaExtraRepository.minutosAprobadosPorEmpleado` (eran del flujo 072).
- `services/asistencia/reporteHorasExtraService.js`: `miReporte` (jefe, sin dinero) y
  `reporteFinanciera` (todos/por campaña, con dinero y `por_campania`). `alertaService` volvió a
  traer solo traspasos.
- Rutas: jefe `GET /reporte-horas-extra?periodo` (solo lectura); financiera
  `GET /financiera/reporte-horas-extra?periodo&campania_id`, más campañas/empleados/trazabilidad.
  El flujo 072 (`PUT/POST /reporte-horas-extra`, `/enviar`, `reportes-horas-extra`, `/aprobar`,
  `/devolver`, `/periodos/:periodo`) se **quitó**. `solicitar`/`aprobar`/`asignar` aceptan `clase`.

**Frontend:**
- Jefe: `/operaciones/reporte-horas-extra` (`asistencia/ReporteHorasExtra.jsx`) solo lectura, se
  llena solo. `HorasExtra.jsx`: el agente elige la clase al solicitar y el jefe la ajusta al aprobar.
- Financiera (layout de RRHH): `/recursos-humanos/reportes-horas-extra`
  (`financiera/ReportesHorasExtra.jsx`) = reporte con dinero, resumen por campaña y totales, filtro
  por campaña y mes, export CSV; y `/recursos-humanos/trazabilidad`. Se eliminó
  `DetalleReporteHorasExtra.jsx` (aprobar/devolver) y la campana volvió a su forma simple.
- `src/utils/reporteHorasExtra.js`: clases, `OPCIONES_CLASE`, `formatearPesos`.

**Pruebas:** 10 tests unitarios del dominio (dinero por clase, factores, pivot y totales; total
**160**) y prueba e2e local (solicitar con clase, reclasificar al aprobar, reporte del jefe sin
dinero, reporte de financiera con dinero por campaña y totales coherentes, filtro por campaña,
rutas viejas → 404, campana sin recordatorios). El script quedó fuera del repo.

**Para producción:** aplicar 072 (si falta) y 073, desplegar backend y frontend (con
`npm run build`), y crear el usuario `financiera` desde `/users`. Para que el dinero cuadre, las
fichas deben tener salario en `historial_salarial`.

## 33. Sesión 2026-10-22 — Clasificación automática de la hora extra (migración 074)

El agente ya **no elige** la clase: ingresa la **franja** (fecha + hora inicio/fin) y el servidor la
clasifica solo. Quita el error humano de la 073 (donde el agente escogía la clase a ojo). Acotado a
lo que el agente solicita (los recargos de turnos nocturnos "automáticos" desde la jornada real
quedan como posible fase futura).

**Regla (confirmada con el usuario):** para cada minuto de la franja —festivo/domingo (tabla
`festivo_colombia` o día de la semana), dentro/fuera del turno asignado, y de día/noche según la
`ventana_nocturna` vigente— se mapea a una de las 5 clases:
- Festivo/domingo: dentro del turno → `dominicales_festivas` (90%); fuera → `extras_dominicales_festivas` (115%).
- Ordinario, dentro del turno: de noche → `recargo_nocturno`; de día → no aplica (jornada ordinaria).
- Ordinario, fuera del turno: de día → `extras_diurnas`; de noche → `extras_nocturnas`.
Sin turno asignado o día de descanso: todo cuenta como fuera del turno (extra). Una franja puede
cruzar límites (día↔noche, medianoche hacia un festivo) y partirse en **varios tramos**.

**Umbral nocturno:** `ventana_nocturna(vigente_desde, hora_inicio, hora_fin)`. Se siembra `21:00`
(histórico) y `19:00` desde la reforma (Ley 2466/2025); se toma la vigencia aplicable a la fecha,
para que un mes viejo se recalcule con el umbral que regía. **Confirmar la fecha exacta de entrada
en vigencia del tramo de las 7 p.m. y ajustarla si cambia.**

**Festivos:** `festivo_colombia` con 2025-2030, generados con Pascua (algoritmo gregoriano) + Ley
Emiliani (traslado al lunes). Los domingos no se guardan: salen del día de la semana.

**Migración 074:** `hora_extra.hora_inicio/hora_fin` (TIME), tabla `hora_extra_tramo`
(`idhora_extra`, `clase`, `minutos`; UNIQUE por clase, ON DELETE CASCADE), `festivo_colombia`,
`ventana_nocturna`, y backfill de un tramo por cada hora extra aprobada existente. Idempotente salvo
los `ALTER`. **Va DESPUÉS de 072+073. Aplicada en local el 2026-10-22; pendiente en producción.**

**Backend (cuatro capas):**
- `domain/asistencia/clasificarHoraExtra.js`: puro. `clasificarHoraExtra({ inicio, fin, turno,
  dia0EsFestivo, dia1EsFestivo, ventanaNocturna })` → `[{clase, minutos}]`; helpers `totalMinutos`,
  `claseDominante`, `aMinutos`. El servicio resuelve antes turno/festivos/ventana y se los pasa.
- `repositories/asistencia`: nuevos `festivoRepository.sonFestivos`, `ventanaNocturnaRepository.vigenteEn`;
  `horaExtraRepository` gana `hora_inicio/hora_fin` en la solicitud y `insertarTramos`/`reemplazarTramos`/
  `findTramos`/`findTramosPorHorasExtra`. El reporte (`reporteHorasExtraRepository`) suma desde
  `hora_extra_tramo` (LEFT JOIN) en vez de `he.clase`.
- `services/asistencia/horaExtraService.js`: `solicitar` clasifica y guarda solicitud + tramos en
  transacción; `previsualizar` (sin guardar); `aprobar` acepta `tramos` (ajuste del jefe) o conserva
  los calculados; `asignar` guarda un tramo único; `misHorasExtra`/`bandeja` adjuntan los tramos.
- Rutas: `POST /horas-extra/previsualizar` (nueva); `solicitar` pide `hora_inicio/hora_fin`; `aprobar`
  recibe `tramos`. Validador: tipo `hora` (`HH:MM`).

**Frontend:**
- `HorasExtra.jsx`: el agente ingresa franja y ve la **clasificación sugerida** (llamada a
  `previsualizar`), ya no un selector de clase. El jefe aprueba aceptando la propuesta o con un editor
  de **tramos** (clase + minutos, con agregar/quitar). `api.js`: `previsualizarHoraExtra`.
- `utils/reporteHorasExtra.js`: `etiquetaClase` para mostrar los tramos.

**Pruebas:** 12 tests unitarios del dominio (cruce día/noche, umbral parametrizado, turno nocturno =
recargo, sin turno, descanso, festivo dentro/fuera del turno, cruce de medianoche a festivo; total
**172**) y e2e (previsualizar, solicitar con franja que se clasifica sola, aprobar ajustando tramos,
reporte del jefe desde tramos; **127 checks**).

**Para producción:** aplicar 074 (después de 072+073), desplegar backend y frontend (con
`npm run build`). Para clasificar bien, los empleados deben tener **horario asignado** (si no, todo
cuenta como extra) y la `ventana_nocturna`/festivos ya quedan sembrados por la migración.

## 34. Sesión 2026-10-22 — Pausas de AsisLock: break y capacitación (migración 076)

AsisLock ya manda un registro por cada cambio de estado (`Conectado`, `Break`, `Almuerzo`,
`Capacitación`, `Baño`, `Desconectado`) como evento `login`, con el estado en `estado_conexion`
(confirmado con logs reales de `asislock_registro` en producción). Hasta ahora el Gestor solo usaba
Conectado/Desconectado y las pausas de baño/almuerzo se marcaban en el portal; los demás estados
caían como `ya_conectado`. Ahora el Gestor los interpreta.

**Regla de negocio (confirmada):** baño, break y almuerzo son **tiempo libre** y **descuentan** del
tiempo trabajado; **capacitación cuenta COMO LABORADA** (no descuenta).

**Migración 076:** `jornada_evento.tipo` suma `inicio_break/fin_break` e
`inicio_capacitacion/fin_capacitacion`; `jornada` suma `minutos_break` y `minutos_capacitacion`.
Pendiente en producción, va después de la 071.

**Dominio:**
- `asislock.js`: `normalizarEstado(estado_conexion)` → conectado/desconectado/bano/break/almuerzo/
  capacitacion; `pausaAbierta` cubre las 4 pausas; `decidirLogin({ eventos, instante, estado })`
  abre la pausa del estado (cerrando otra que estuviera abierta), y `Conectado` cierra la pausa
  abierta (o reconecta, o entra). Un estado desconocido/ausente se trata como `Conectado` (compat).
- `calcularJornada`: acumula las 4 pausas; resta baño+break+almuerzo+desconexión; **no** resta
  capacitación. Nuevos campos `minutosBreak`/`minutosCapacitacion` (también en `ESTADO_SIN_ENTRADA`,
  `construirTotales`, `jornadaRepository.actualizarTotales` y la respuesta de `estadoDeHoy`).

**Frontend:** la trazabilidad (`TrazabilidadView.jsx`) distingue break (color de pausa) y
capacitación (color de trabajo, porque es laborada), con etiquetas propias en la línea de tiempo y
la tabla de eventos. El agente marca en AsisLock; el portal del Gestor ya no necesita marcar pausas.

**Pruebas:** dominio (break descuenta, capacitación no, mezcla, pausa activa; decidirLogin con cada
estado, cambio entre pausas, repetición, sin entrada) — total **182** unitarias; e2e 127 sin
regresión.

**Fase 2 (hecha, migración 077 + código):** la traza muestra el relato de la hora extra:
- `GET /mi-jornada/:fecha/trazabilidad` devuelve `hora_extra` = { solicitudes (franja, tramos,
  `creado_en`/`fecha_decision`), franja_aprobada, extra (inicio_real, fin_real, minutos, en_curso,
  contiguo, excedio_min) }. Cálculo puro en `domain/asistencia/resumenHoraExtra.js`.
- La ingesta de AsisLock reabre la jornada: un login después de la `salida` que cae dentro de una
  franja de hora extra aprobada (con 15 min de gracia al inicio) genera `inicio_extra` en vez de
  ignorarse por `jornada_finalizada`; el logout siguiente genera `fin_extra`
  (`asislock.decidirLogin`/`decidirLogout`, `extraAbierto`, `dentroDeHoraExtra`). Solo se activa si
  hay hora extra aprobada, así que los días normales no cambian. El bloque extra no toca
  `calcularJornada` (queda después de la `salida`): el relato se arma aparte en la trazabilidad.
- `hora_extra.creado_en` (migración 077) guarda cuándo se solicitó; `insertarSolicitud`/
  `insertarAsignada` lo llenan con `NOW()`.
- Frontend: `TrazabilidadView.jsx` dibuja el segmento de hora extra en la línea de tiempo y un panel
  con el relato (solicitud/aprobación, hora real de ingreso, y "siguió N más allá del fin aprobado").

**Probado:** unitarias del dominio (`resumenHoraExtra` contiguo/no contiguo/en curso/desborde;
`decidirLogin` reabre con HE aprobada y la ignora sin ella; `decidirLogout` cierra con `fin_extra`)
— total **192**; e2e 127 sin regresión; prueba de integración real (entrada→salida→login en franja
→logout) que confirma `inicio_extra`/`fin_extra` y el resumen con la hora real de ingreso.

## 35. Sesión 2026-10-22 — Vista mensual del equipo para el jefe

El jefe tenía solo "Equipo hoy" (foto del día) y la trazabilidad de un empleado día a día; faltaba
un consolidado mes a mes del equipo. Se agrega una vista mensual (sin cambios de BD: usa las
jornadas ya calculadas).

**Backend:** `GET /asistencia/equipo/resumen-mensual?periodo=AAAA-MM` (`canDirigirEquipo`,
`periodoQuerySchema`). `equipoService.resumenMensualEquipo` normaliza los días pasados (cierre) por
empleado y agrega con el dominio puro `domain/asistencia/resumenMensual.js` (`resumenDeJornadas`,
`totalesEquipo`). Devuelve, por empleado: días trabajados, ausencias, días tarde, puntualidad %,
minutos trabajados/tarde/extra y por pausa (baño, break, almuerzo, capacitación), salida anticipada,
y la grilla `dias` (fecha + estado + tarde/trabajado/extra). Más los totales del equipo.

**Frontend:** `EquipoMensual.jsx` (`/operaciones/equipo/mes`, en el nav del jefe como "Equipo ·
mes"): KPIs del mes, un **calendario tipo heatmap** día × empleado (verde puntual, ámbar tarde, rojo
ausente, azul en curso, gris pendiente; cada celda enlaza a la trazabilidad de ese día vía
`?fecha=`), y la tabla detallada por empleado con totales y export CSV. `TrazabilidadEmpleado`
ahora acepta `?fecha=` para abrir un día concreto desde el calendario.

**Probado:** dominio `resumenMensual` (196 unitarias) + prueba de integración del endpoint contra la
BD. Sin migración.

**Financiera / admin (misma sesión):** la misma idea a nivel organización.
`GET /asistencia/financiera/resumen-mensual?periodo=&campania_id=` (`isFinanciera`): comparativo de
TODAS las campañas (empleados, puntualidad %, días trabajados, ausencias, horas trabajadas/extra) y,
si se pasa `campania_id`, el detalle de esa campaña (empleados + grilla día a día, como el jefe).
Hecho con consultas AGREGADAS (`repositories/asistencia/resumenMensualRepository.js`:
`agregadosPorEmpleado` con un `SUM(CASE…)` sobre `jornada` + contrato activo + campaña, y
`jornadasDiaPorCampania` para la grilla), no un recorrido por empleado; no normaliza (confía en el
cron diario). `financieraService.resumenMensual` agrupa con `totalesEquipo`. Frontend:
`financiera/AsistenciaMensual.jsx` (`/recursos-humanos/asistencia-mensual`, nav "Asistencia
mensual"): KPIs globales, comparativo por campaña con barras de puntualidad, y al abrir una campaña
su calendario + tabla; las celdas enlazan a la trazabilidad por campaña con `?fecha=`.
Verificado con prueba de integración (comparativo de 2 campañas + detalle). Sin migración.

**Tendencia mes contra mes:** el resumen de financiera también trae `periodo_anterior` y, por campaña, `anterior` (los mismos totales del mes previo, consulta agregada aparte), para mostrar la variación de puntualidad en puntos porcentuales.

**Ajuste (commit `5fcf46c`) — el comparativo incluye TODAS las campañas con dotación activa:**
la primera versión armaba el comparativo a partir de `agregadosPorEmpleado` (basado en `jornada`),
así que una campaña sin marcaciones ese mes (p. ej. Pymes, Vital, Asiste) desaparecía del tablero.
Ahora `financieraService.resumenMensual` parte de `empleadoRepo.findCampaniasConEmpleados()` (todas
las campañas con contrato activo, con su dotación real) y le pega el agregado del mes; las que no
tienen jornadas salen en 0 / — en vez de faltar. El detalle de una campaña (`campania_id`) también
lista a TODOS sus empleados activos vía `findActivosPorCampania`, con ceros para los que no marcaron.
Verificado en local: 18 campañas / 398 empleados. Sin migración.

**Topnav (frontend):** al sumar las pestañas "Asistencia mensual" y "Equipo · mes", el contenedor
`.ai-topnav-links` no se encogía y las pestañas se montaban sobre la lupa/campana. Corregido en
`RecursosHumanosLayout.jsx` y `asistencia/AsistenciaLayout.jsx`: las pestañas son flexibles con
scroll horizontal sin barra visible (`flex:1 1 auto; min-width:0; overflow-x:auto`) y el bloque de
acciones queda fijo (`[data-topnav-actions] { flex: none; }`).

## 36. Sesión 2026-10-23 — "Reporte Asistencia": reporte mensual y trazabilidad en una sola pestaña

Pedido: renombrar la pestaña "Asistencia mensual" de financiera a **"Reporte Asistencia"** y unificarle
la pestaña "Trazabilidad" (por campaña). Solo frontend.
- `RecursosHumanosLayout.jsx`: `NAV_FINANCIERA` queda con "Horas extra" y "Reporte Asistencia"
  (`/recursos-humanos/asistencia-mensual`, misma ruta). Sale "Trazabilidad".
- `financiera/AsistenciaMensual.jsx` (título "Reporte de asistencia"): al abrir una campaña, buscador
  por nombre o cédula que filtra el calendario diario y la tabla por empleado, y columna
  "Trazabilidad" con acceso directo a la traza diaria (además del clic en cada día del calendario y
  en el nombre, que ya existían).
- `financiera/TrazabilidadPorCampania.jsx` se borró. `/recursos-humanos/trazabilidad` redirige al
  reporte; `/recursos-humanos/trazabilidad/:empleadoId` (traza diaria) sigue igual y su "Volver al
  reporte" abre el mes y la campaña de la fecha que se estaba viendo.
- Lo que se pierde de la vista vieja: la columna "Jefe de área" (el resumen mensual no la trae).
  `GET /api/asistencia/financiera/empleados` queda sin uso en el frontend; no se quitó del backend.

Verificado: `eslint` sin errores nuevos, `vite build` ok. **No probado en el navegador.**

**Ajuste (mismo día):** el detalle de la campaña ya no se despliega debajo del comparativo: "Ver
detalle" abre una ventana (`DetalleCampaniaModal`, en el mismo archivo, 1200 px) con KPIs de la
campaña (puntualidad con tendencia, días trabajados, ausencias, días tarde, horas trabajadas y extra),
buscador, calendario diario, tabla por empleado y "Exportar empleados" (CSV). Se cierra con X, Esc o
clic fuera. La campaña abierta sigue en `?campania=`, así que "Volver al reporte" desde la
trazabilidad reabre la ventana. Mientras carga, el comparativo queda visible y solo la ventana
muestra el spinner.

## 37. Sesión 2026-10-23 — Home de financiera/admin: tablero de RRHH, asistencia, horas extra y costos

Pedido: una página "Home" para financiera (y admin) con estadísticas concretas que se lean a primera
vista: RRHH, asistencia, horas extra y su costo, y costo de nómina. Sin migración.

**Backend** (en capas, dentro del módulo de asistencia):
- `GET /api/asistencia/financiera/home?periodo=AAAA-MM` (`isFinanciera` = financiera + admin).
- `services/asistencia/homeFinancieraService.js → resumen()`: reutiliza `financieraService.resumenMensual`
  (mes y mes anterior) y `reporteHorasExtraService.reporteFinanciera` (últimos 6 meses), más el repo nuevo.
- `repositories/asistencia/indicadoresRrhhRepository.js`: nómina vigente por campaña (salario + bonos
  del `historial_salarial` abierto de cada contrato activo; cuenta los activos sin salario), ingresos
  por `contrato.fecha_ingreso`, retiros por `retiro.fecha_retiro` y novedades por tipo que se cruzan con el mes.
- `domain/asistencia/homeFinanciera.js` (puro, con `tests/asistencia/homeFinanciera.test.js`, 10 tests):
  `variacionPct`, `deltaPp`, `unirPorCampania` y `hallazgos` — frases de "lo que hay que mirar" (costo
  de horas extra ±10 % vs mes anterior, campaña que concentra ≥ 40 % del costo, puntualidad global ±3 pp,
  campañas bajo la meta de 90 %, más retiros que ingresos, activos sin salario, horas extra como % de
  la nómina). En el **mes en curso** no compara el costo contra el mes anterior completo.
- `utils/fechaBogota.js`: `sumarMeses` y `periodosHasta`.
- Ojo: la "nómina" es salario básico + bonos; **no incluye prestaciones ni aportes**. No es el mismo
  número que `GET /users-company/gasto-total` (ese suma todos los contratos con salario abierto, sin
  filtrar por estado).

**Frontend:** `financiera/HomeFinanciera.jsx` en `/recursos-humanos/home` (guard `HomeFinancieraRoute`:
financiera o admin). Financiera aterriza ahí al entrar y es su primera pestaña; el admin lo abre desde
"Tablero financiero" en su menú lateral. Contenido: hallazgos; KPIs (nómina, costo de horas extra con
variación, activos con ingresos/retiros, puntualidad con delta, ausencias con novedades); gráficas de
costo de horas extra 6 meses, ingresos vs retiros 6 meses, nómina por campaña, puntualidad por campaña
(énfasis: bajo la meta en naranja, resto gris, línea de meta), costo de horas extra por campaña, horas
por clase, novedades por tipo; y el top 10 de empleados por costo de horas extra. Chart.js con la guía
de visualización: azul `#2a78d6`/naranja `#eb6834` (oscuro `#3987e5`/`#d95926`) validados para
daltonismo sobre las superficies de la app, una escala por gráfica, fuente del dato y vista de tabla
en cada tarjeta, modo oscuro propio.

Verificado: `npm test` 206/206; servicio contra la BD local (oct y sep 2026); capturas en Chromium
headless como financiera (claro y oscuro) y admin, sin errores de consola. **No probado por el usuario.**

## 38. Sesión 2026-10-23 — Costo de nómina en el Home: nómina, prestaciones, bonos y total, en vivo y mes a mes

Pedido: ver por separado el costo de solo nómina, de prestaciones, de bonos y el costo total, en tiempo
real y con el histórico mes a mes.

**Migración `078_factor_costo_nomina.sql`** (aplicada en local, **pendiente en producción**, idempotente,
sin IDs): tabla `factor_costo_nomina` con los porcentajes de las prestaciones sociales sobre el salario
básico — cesantías 8,33 %, intereses sobre cesantías 1 %, prima 8,33 %, vacaciones 4,17 % (21,83 %).
Se ajustan con un `UPDATE` sin tocar código. **No incluye aportes** (salud, pensión, ARL, caja, ICBF,
SENA) ni auxilio de transporte: si se decide sumarlos, van como filas nuevas con su categoría.
**El backend nuevo sin la 078 rompe `GET /financiera/home`** (la consulta de factores falla).

**Cálculo** (`domain/asistencia/costoNomina.js`, puro, `tests/asistencia/costoNomina.test.js`):
- Se reconstruye desde `historial_salarial`: cada vigencia es un tramo recortado al ingreso y al retiro
  del contrato (`indicadoresRrhhRepository.tramosSalariales`). `fecha_vigencia_fin` es excluyente (ese
  día ya rige el salario nuevo). Un contrato retirado/inactivo sin fila en `retiro` termina en su
  `updated_at`.
- Prorrateo con mes comercial de 30 días: mes completo = 30 (también febrero), el 31 no cuenta.
- Nómina = salario prorrateado; prestaciones = nómina × factores; bonos = no prestacional + cafetería
  prorrateados (no son base de prestaciones); total = la suma.
- Mes en curso: **proyectado al cierre** con la nómina vigente hoy, más lo **causado a hoy** (corte en la
  fecha laboral de Bogotá). Los meses futuros no se calculan.
- La campaña es la actual del contrato (los traspasos no cambian el contrato, §35 de RRHH).

**Home:** KPI principal = costo total (en curso: proyectado + causado a hoy; cerrado: variación vs mes
anterior). Sección nueva "Costo de nómina": los cuatro valores con su variación, barras apiladas de 12
meses (nómina/prestaciones/bonos, azul/naranja/aqua, validado; el mes en curso más claro y con `*`),
vista de tabla con lo causado, exportar CSV y el detalle de cada prestación. "Costo total de nómina por
campaña" pasa a barras apiladas. Hallazgo nuevo cuando el costo total cambia ≥ 5 % vs el mes anterior.
**Tiempo real:** el mes en curso se recalcula solo cada 2 minutos y muestra la hora de actualización.

Verificado: `npm test` 213/213; en local octubre 2026 = nómina $ 774,9 M + prestaciones $ 169,2 M +
bonos $ 92,7 M = $ 1.036,7 M (causado al 23: $ 794,6 M), histórico nov 2025 → oct 2026; capturas en
Chromium claro/oscuro sin errores de consola. **No probado por el usuario.**

## 39. Sesión 2026-10-25 — Aportes de seguridad social y parafiscales en el costo de nómina

Pedido: sumar al costo de nómina los aportes del empleador.

**Migración `079_aportes_costo_nomina.sql`** (aplicada en local, **pendiente en producción, va después
de la 078**, idempotente, sin IDs):
- `factor_costo_nomina.categoria` pasa a `ENUM('prestacion','aporte')` y gana `exonerable`.
- Aportes: salud 8,5 % · pensión 12 % · ARL 0,522 % (respaldo) · caja 4 % · ICBF 3 % · SENA 2 %.
  Salud, ICBF y SENA llevan `exonerable = 1` (art. 114-1 E.T.: no se pagan por quien gana menos de
  10 SMMLV). **Si la empresa no aplica la exoneración**:
  `UPDATE factor_costo_nomina SET exonerable = 0 WHERE codigo IN ('salud','icbf','sena');`
- Tabla `salario_minimo` (SMMLV por año: 2024 $ 1.300.000, 2025 $ 1.423.500, 2026 $ 1.750.905).
  **Cada enero hay que insertar el del año nuevo**; si falta, se usa el último cargado. Sin ninguno,
  no se exonera nada (estimación conservadora).

**Cálculo** (`domain/asistencia/costoNomina.js`):
- Base de los aportes = IBC: el salario más lo que los bonos (no salariales) pasen del 40 % de la
  remuneración total (Ley 1393 de 2010, art. 30). Hoy ningún empleado supera ese 40 %.
- ARL: la `seguridad_social.tarifa_arl` de la afiliación ARL activa del empleado. Si falta o está fuera
  del rango legal 0,348-8,7 % (en local hay tarifas de 80 y 200, datos mal cargados) se usa la del factor.
- La exoneración se decide con el salario mensual del tramo contra 10 SMMLV del año del periodo.
- Prestaciones siguen sobre el salario básico. Total = nómina + prestaciones + aportes + bonos.
- Cada detalle trae `porcentaje_efectivo` (lo que de verdad pesó sobre su base en el mes).

**Home:** quinto valor "Aportes" (violeta; paleta azul/naranja/violeta/aqua validada en claro y oscuro,
adyacencias en el orden de apilado), en las barras apiladas de 12 meses, por campaña, en la tabla y el
CSV; fila de chips con cada aporte (los exonerados dicen "exonerado").

Verificado: `npm test` 218/218; en local octubre 2026 = nómina $ 774,9 M + prestaciones $ 169,2 M +
aportes $ 128,0 M (pensión $ 93 M, caja $ 31 M, ARL $ 4 M; salud/ICBF/SENA exonerados) + bonos
$ 92,7 M = $ 1.164,7 M. Capturas claro/oscuro sin errores. **No probado por el usuario.** Sin
auxilio de transporte todavía.

## 40. Sesión 2026-10-26 — Auxilio de transporte en el costo de nómina

Pedido: sumar el auxilio de transporte al costo de nómina.

**Migración `080_auxilio_transporte_costo_nomina.sql`** (aplicada en local, **pendiente en producción,
va después de la 079**, idempotente, sin IDs):
- `salario_minimo.auxilio_transporte`: 2024 $ 162.000, 2025 $ 200.000, 2026 $ 249.095. **Cada enero
  se actualiza junto con el SMMLV** (si falta el del año, se usa el último cargado).
- `factor_costo_nomina.incluye_auxilio = 1` en cesantías, intereses sobre cesantías y prima (el
  auxilio es base de esas tres, no de vacaciones).

**Cálculo** (`domain/asistencia/costoNomina.js`):
- Lo recibe quien tiene salario básico hasta 2 SMMLV del año del periodo (Ley 15 de 1959),
  prorrateado por los mismos días comerciales del tramo. Sin SMMLV o sin auxilio cargado, no se suma.
- No es base de aportes a seguridad social ni parafiscales.
- No se distingue el auxilio de conectividad del trabajo en casa (Ley 2088 de 2021): vale lo mismo.
- Total = nómina + auxilio + prestaciones + aportes + bonos. Nuevos campos `auxilio_transporte` y
  `empleados_con_auxilio` en el mes, el histórico, lo causado y por campaña.

**Home:** sexta tarjeta "Auxilio de transporte" (amarillo, al final de la pila; paleta de 5 validada
en claro y oscuro con las adyacencias del apilado), en barras de 12 meses, por campaña, tabla y CSV.
Las tarjetas comparan "vs <mes corto>" para que no se partan en dos líneas.

Verificado: `npm test` 221/221; en local octubre 2026 = nómina $ 774,9 M + auxilio $ 96,5 M (388
empleados) + prestaciones $ 186,2 M + aportes $ 128,0 M + bonos $ 92,7 M = $ 1.278,3 M. Capturas
claro/oscuro sin errores. **No probado por el usuario.**

## 41. Sesión 2026-10-26 — Monitor del empleado en vivo con AsisLock

Prueba del usuario en producción con un empleado de prueba y AsisLock. Encontró cuatro problemas:
1. Al loguearse, el contador corría pero el monitor no lo mostraba hasta recargar.
2. Igual con los cambios de estado: baño, break, etc.
3. Al recargar en break, el contador arrancaba desde cero.
4. En break, la etiqueta decía "En baño".

**Causas:**
- **Sin aviso al monitor:** el monitor solo se resincronizaba cada 60 s y al volver a la pestaña, y
  el backend no le avisaba. El aviso por socket existente (`notificarDirector`) iba solo a cuentas
  de `users` y a ninguna pantalla del empleado.
- **Contador de pausa mal calculado:** el contador de la pausa se armaba con
  `pausa_activa.minutosTranscurridos × 60`, y esos minutos vienen redondeados. Una pausa de 20 s
  daba 0 min, y por eso "desde cero". El contador principal tenía el mismo defecto (±30 s).
- **Etiquetas incompletas:** `TarjetaPausa` y "Equipo hoy" solo conocían baño y almuerzo.
  Cualquier otro tipo salía como "Baño", en la tarjeta, o como "Almuerzo", en Equipo hoy.

**Backend (sin migración):**
- `calcularJornada` devuelve `segundosTrabajados` exactos, `pausaActiva.segundosTranscurridos` /
  `desconexionActiva.segundosTranscurridos` y `cuentaTiempo`. Este último indica si el tiempo
  laborado suma en este instante: en curso y en **capacitación** sí, que cuenta como laborada
  aunque el estado sea `en_pausa`; en baño, break, almuerzo y desconectado, no.
  `/mi-jornada/hoy` los expone como `segundos_trabajados` y `cuenta_tiempo`. Hay 2 tests nuevos,
  223 en total.
- **Socket por ficha** (`index.js`): la pantalla emite `asistencia:suscribir` con su JWT. El
  servidor lo verifica y la une a la sala `asistencia:<users_company_id>` (dentro de
  `payload.user`). Así sirve igual para cuentas de `users` y de `cuenta_empleado`, cuyos ids pueden
  coincidir. `global.emitirAsistencia(ficha, evento, datos)`.
- **Aviso en cada cambio de jornada:** `notificacionService.notificarCambioJornada` reemplaza a
  `notificarDirector` en `asislockService` y `marcajeService`. Emite `asistencia:mi-jornada` a la
  ficha del empleado y `asistencia:equipo` a la de su jefe de área (`equipoRepo.jefeAreaDe`), y
  luego el aviso viejo al director. Solo avisa: cada pantalla vuelve a pedir su estado a la API.

**Frontend:**
- `src/utils/socketAsistencia.js`: un socket compartido que se suscribe con el token al conectar
  y al reconectar.
- `useJornada`:
  - recarga al recibir `asistencia:mi-jornada`;
  - el contador principal parte de `segundos_trabajados` y suma mientras `cuenta_tiempo`;
  - el de la pausa se calcula desde `pausa_activa.desde`, con el reloj del servidor;
  - sin socket, la resincronización baja de 60 s a 15 s.
- `src/utils/pausasAsistencia.js` reúne etiqueta, ícono y color de baño, break, almuerzo y
  capacitación:
  - `TarjetaPausa` dice "En break", "En capacitación", etc.;
  - en capacitación aclara que cuenta como laborada.
- `EquipoAsistencia`:
  - se recarga con `asistencia:equipo`;
  - la tarjeta "En pausa" suma break y capacitación;
  - el badge muestra el estado real.
- `ContadorJornada` muestra "Break hoy" y "Capacitación".
- La tabla "Registros de AsisLock" de la trazabilidad tiene la columna "Estado en AsisLock" y
  etiquetas para las acciones de pausa (`pausa_*`, `fin_pausa`, `entrada_extra`, `fin_extra`) y
  sus motivos (`ya_en_pausa`, `desconectado`, `en_hora_extra`, `empleado_no_encontrado`).

**Verificado en local:** backend con una `ASISLOCK_API_KEY` de prueba pasada por variable de
entorno, sin tocar `.env`, y envíos simulados para el empleado del seed. En Chrome, sin recargar,
el monitor pasó de "Sin iniciar" a "En turno", luego a "En break", "En baño" al instante,
"En capacitación" y de vuelta a "En turno". Al recargar en baño a 0:41 siguió en 0:44. La
trazabilidad lista cada estado. `npm test` 223/223 y `npm run test:e2e` 127/127. Los datos de la
prueba se borraron.

**Para producción:** solo código, backend + frontend con `npm run build`. El socket conecta a la
URL de `VITE_API_BASE_URL` sin `/api`. Si nginx publica la API por un proxy que solo reenvía
`/api`, también debe reenviar `/socket.io/` con `Upgrade`. Si no, el monitor igual se actualiza,
pero cada 15 s en vez de al instante.

**Ajuste del mismo día: el reloj grande es el tiempo en jornada.** El usuario vio que al volver
del break el contador "empezaba de cero". No se perdía tiempo. El reloj mostraba el tiempo
**laborado**, que descuenta el break, y en una prueba corta, con entrada y break enseguida, eso es
casi cero. Lo que se pidió es que el reloj siga corriendo desde la entrada y que al final del día
muestre las horas de la jornada, con el tiempo de cada estado aparte.

- **Backend:** `calcularJornada` devuelve `segundosEnJornada`, el tiempo desde la entrada hasta la
  salida o hasta ahora, con pausas y desconexión incluidas, y `/mi-jornada/hoy` lo expone como
  `segundos_en_jornada`. Hay 1 test nuevo, 224 en total.
- **Frontend:**
  - el reloj de `ContadorJornada` dice "TIEMPO EN JORNADA" y corre mientras la jornada está
    abierta, también en pausa;
  - el desglose muestra "Laborado" (lo que cuenta para nómina, sin cambios), baño, break,
    almuerzo, capacitación y "Desconectado" si lo hubo.
- **Verificado en local:** entrada hace 30 min y 10 min de break. El reloj muestra 0:30, Laborado
  20 min y Break 10 min.

## 42. Sesión 2026-10-26 — Desconexión de AsisLock: la jornada corre hasta la hora de salida

Regla pedida por el usuario: si el empleado se desconecta de AsisLock y no vuelve, el contador de
la jornada sigue hasta su hora de salida. La traza debe decir a qué hora se desconectó y cuánto
tiempo de la jornada estuvo sin conexión.

**Antes:**
- En vivo, el reloj seguía corriendo sin límite, también pasada la hora de salida.
- El cierre del día ponía la salida **en el logout**, así que el tramo entre el logout y la hora
  de salida desaparecía de la jornada.

**Ahora (sin migración):**
- **Con horario:** `calcularJornada` corre la jornada hasta la hora de salida programada si hay
  una desconexión abierta, sin reconexión ni salida, y ahí la detiene. Todo el tramo desde el
  logout es **desconectado**: no laborado, `minutosDesconexion`, y no genera hora extra. Expone
  `cuentaJornada`, que es `cuenta_jornada` en `/mi-jornada/hoy`, para que el monitor sepa cuándo
  parar el reloj.
- **Sin horario:** no hay hasta dónde llevarla, así que la jornada se detiene en la desconexión,
  igual que antes en el cierre.
- **Cierre del día** (`cierreService.normalizarJornada`): con una desconexión abierta, la salida
  va a la hora de salida programada si es posterior al logout. Lleva origen `asislock`, así que no
  levanta `sin_marcar_salida`, y la nota "desconectado de AsisLock sin reconexión hasta la hora de
  salida". Sin horario, va en el logout, como antes. El laborado no cambia, porque el tramo nuevo
  es todo desconexión.
- **Frontend:**
  - el aviso de Mi jornada explica que la jornada sigue hasta la hora de salida como tiempo
    desconectado, o que queda detenida si no hay horario;
  - el reloj se detiene con `cuenta_jornada`;
  - la trazabilidad suma la tarjeta "Desconectado de AsisLock". La fila de la desconexión ya
    mostraba su duración hasta la salida.
- **Pruebas:** 2 tests nuevos, 226 en total. `test:e2e` sigue en 127/127.
- **Verificado en local** con un horario de prueba de 11:50 a 12:28:
  - entrada a las 11:51 y logout a las 12:05;
  - el monitor siguió corriendo, se detuvo en 0:36:32 a las 12:28 y siguió así al recargar,
    con 23 min desconectado;
  - el cierre puso la salida a las 12:28 con la nota, y la traza quedó como entrada, desconexión
    de 23 min y salida.

## 43. Sesión 2026-10-26 — Pantallas de monitoreo en vivo: jefes y financiera

Pedido del usuario: que el cambio de pantalla según el estado (§41) también llegue a quienes
monitorean, es decir a los jefes de personal y al "admin o financiera". Aclaración del usuario:
**el admin de los módulos de asistencia y RRHH es financiera**, no el `admin` del sistema (que
administra los otros módulos).

**Backend (sin migración):**
- Al suscribirse, una sesión de `users` con rol `financiera` entra además a la sala
  `asistencia:monitores` (`ROLES_MONITOR_ASISTENCIA` en `index.js`; las cuentas de empleado y el
  `admin` del sistema no entran).
- `notificarCambioJornada` emite ahí `asistencia:monitor` `{ tipo, usersCompanyId }`, además del
  aviso de siempre al jefe de área, `asistencia:equipo`, que solo llega a la sala de su ficha.
  El equipo es de reportes directos (`jefe_area_id`), así que no hay cadena de jefes que avisar.

**Frontend:** `escucharCambiosEmpleados(handler, esperaMs)` en `socketAsistencia.js` escucha los
dos avisos y puede agrupar una ráfaga en una sola llamada.
- **Equipo hoy** (jefe): ya se actualizaba desde §41.
- **Trazabilidad de un empleado** (`TrazabilidadEmpleado`, la del jefe y la de financiera): se
  recarga sin spinner cuando el aviso es de ese empleado. El CSV ahora nombra break y
  capacitación.
- **Calendario mensual del equipo** (jefe) y **asistencia mensual** (financiera): solo en el mes
  en curso, recargan en silencio con los avisos agrupados cada 5 s. Una recarga fallida deja la
  tabla que ya se veía.
- **Home de financiera:** sigue con su refresco de 2 min. Muestra montos del mes, no estados
  en vivo.
- **Cambio de sesión sin recargar la página** (logout y login de otra persona): el socket
  compartido se reconecta al notar otro token, para no quedarse en las salas de la sesión
  anterior.

**Verificado en local:**
- Con tres sesiones suscritas a la vez y un cambio de AsisLock de `empleado1`, el jefe
  (9000000001) recibió `asistencia:equipo`, la sesión financiera recibió `asistencia:monitor` y
  `empleado2` no recibió nada.
- En Chrome, con el jefe en la trazabilidad de `empleado1`, el break apareció sin recargar.
- El calendario mensual del jefe volvió a pedir el resumen tras cada cambio.
- Pruebas: `npm test` 226/226, `test:e2e` 127/127. Los datos de prueba se borraron.
