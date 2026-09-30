# Módulo de Asistencia — Plan de implementación

Estado: **implementado**. Backend (Fases 0-4 y 6) y frontend (Fase 5) completos y probados
contra el servidor real — ver §14 para el detalle de qué se construyó y en qué se desvió del
plan original, §15 para el fix del 2026-09-16 a la creación de usuarios `director_operaciones`/
`empleado` desde el panel de admin, §16 para la corrección de jerarquía a `jefe_area_id`, y §17
para el rediseño visual del frontend (Opción C) + el endpoint `mis-jornadas` + dos bugs de
backend corregidos (2026-09-24/25).
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
| **Una pausa a la vez** | El servidor rechaza `inicio_bano` si hay una pausa abierta (409). Igual para `inicio_almuerzo`. |
| **Almuerzo con hora exacta** | Si `hora_almuerzo_inicio` está definida, se calcula `desviacion_almuerzo_min = abs(inicio_real − hora_programada)`. **No se bloquea** el marcaje; se registra la desviación y se levanta alerta si supera 15 min. Si es NULL, el almuerzo es libre. |
| **Exceso de almuerzo** | Si la pausa de almuerzo supera `minutos_almuerzo`, el excedente descuenta del tiempo laborado (ya lo hace el cálculo) y genera alerta `almuerzo_excedido`. |
| **Baño** | Sin bloqueo. Alerta si una pausa supera 15 min o si el acumulado del día supera 30 min. Ambos configurables. |
| **Botón Salida** | Habilitado solo cuando `ahora >= hora_salida − 10 min`. **Validado en el servidor** (403 si se intenta antes); el front solo refleja el flag `puedeMarcarSalida`. |
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
| `POST` | `/mi-jornada/salida` | 403 si faltan más de 10 min |
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
