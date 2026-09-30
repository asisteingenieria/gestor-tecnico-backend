---
name: arquitectura-asistencia
description: Convenciones de arquitectura en capas del módulo de asistencia (domain/repositories/services/controllers). Úsala SIEMPRE antes de crear o editar cualquier archivo bajo domain/asistencia/, repositories/asistencia/, services/asistencia/, controllers/asistencia/, routes/asistencia.js, validators/asistenciaSchemas.js, tests/asistencia/, o las migraciones 043-045, y también al escribir SQL o reglas de negocio relacionadas con jornada, horario, marcaje, pausas u horas extra.
user-invocable: false
---

# Arquitectura del módulo de asistencia

El resto de este repositorio usa dos capas (`routes → controllers → models` con SQL crudo
dentro del controller). **El módulo de asistencia NO sigue ese patrón.** Si lo replicas aquí,
el resultado está mal aunque funcione.

El plan completo está en `asistencia.md` (raíz del repo). Este documento es la regla operativa.

## Las cuatro capas

```
routes/asistencia.js              Capa 1 · ruta + middlewares. Cero lógica.
controllers/asistencia/*.js       Capa 2 · adaptador HTTP. Sin SQL, sin reglas, sin try/catch.
services/asistencia/*.js          Capa 3 · reglas, autorización, transacciones. Sin req/res, sin SQL.
repositories/asistencia/*.js      Capa 4 · único lugar con SQL del módulo.

domain/asistencia/                transversal · cálculo puro, sin E/S de ningún tipo.
utils/fechaBogota.js              transversal · conversión de zona horaria.
errors/                           transversal · AppError y subclases.
```

**Regla de dependencia**: cada capa solo importa la que tiene debajo. `domain/` no importa a
nadie — ni `db`, ni `config`, ni otro servicio.

## Qué va en cada capa

| Si vas a escribir… | Va en |
|---|---|
| Un `SELECT`, `INSERT`, `UPDATE`, `NOW(3)`, un JOIN | `repositories/asistencia/` |
| `beginTransaction`, `commit`, `rollback`, `getConnection` | `services/asistencia/` |
| "si el empleado ya tiene una pausa abierta entonces…" | `domain/asistencia/` |
| `assertEmpleadoACargo`, cualquier chequeo de permisos con datos | `services/asistencia/` |
| `res.json`, `res.status`, leer `req.body`/`req.params`/`req.user` | `controllers/asistencia/` |
| `verifyToken`, `verifyRole`, `validar(schema)` | `routes/asistencia.js` |
| Aritmética de fechas u horas | `utils/fechaBogota.js` |

## Reglas no negociables

1. **Nada de SQL fuera de `repositories/asistencia/`.** Ni en services, ni en controllers,
   ni en los scripts de `scripts/`.
2. **Los controllers no llevan `try/catch`.** Se envuelven con `asyncHandler` y los errores
   los captura `middleware/errorHandler.js`. Para fallar, lanza un error de dominio:
   `NoAutorizadoError` (403), `NoEncontradoError` (404), `ConflictoJornadaError` (409),
   `ReglaAsistenciaError` (422).
3. **Un controller llama a un solo método de servicio.** Si necesita dos, la orquestación
   pertenece al servicio.
4. **`domain/` es puro y determinista**: el instante actual se recibe como parámetro
   (`calcularJornada(eventos, horario, ahora)`), nunca se lee `new Date()` dentro.
5. **Cada repositorio acepta `conn = db`** como último parámetro, para poder participar de
   una transacción ajena sin duplicar el método.
6. **Los timestamps los pone el servidor** con `NOW(3)` dentro del repositorio. El cliente
   nunca envía una hora, y si la envía se ignora.
7. **SQL siempre parametrizado con `?`**, incluidos los filtros dinámicos de los reportes
   (se arman como lista de condiciones + arreglo de parámetros).
8. **Toda escritura múltiple va en transacción.** Insertar un evento y actualizar los totales
   de `jornada` ocurren juntos o no ocurren.
9. **El marcaje usa `SELECT ... FOR UPDATE`** sobre la fila de `jornada`
   (`jornadaRepository.findHoyParaActualizar`), para que un doble clic o dos pestañas no
   generen dos eventos.
10. **`jornada_evento` es append-only.** Nunca `UPDATE` ni `DELETE` sobre esa tabla; una
    corrección es un evento nuevo con `origen='director'`, autor y nota.
11. **Sin números mágicos.** Tolerancias, límites de pausa y los 10 minutos del botón de
    salida salen de `asistencia_parametro`, vía `parametroRepository`.
12. **La autorización se valida en el servidor siempre.** El flag `puede_marcar_salida` de la
    respuesta es una ayuda visual; la regla real se aplica en el endpoint.
13. **Todo caso de uso del director empieza con `assertEmpleadoACargo`**, que consulta
    `contrato.jefe_area_id` (corregido 2026-09-23, antes `jefe_inmediato_id` — ver
    asistencia.md §16: en el negocio real es el jefe de área quien crea horarios y aprueba
    horas extra de su equipo, no el jefe inmediato). No hay tabla propia de equipos.

## Zona horaria

La BD corre en UTC (`config/db.js` fuerza `+00:00`); el negocio opera en UTC-5.
- Los eventos se guardan en UTC.
- La **fecha laboral** (`jornada.fecha`, `horario_asignado.fecha`) se calcula en
  `America/Bogota`. **Nunca uses `CURDATE()`** para obtenerla.
- Las horas de horario son `TIME` en hora local y se combinan con la fecha para producir el
  instante UTC comparable.
- Toda esta conversión pasa por `utils/fechaBogota.js`. No la repliques a mano.

## Esqueleto de un caso de uso nuevo

```js
// routes/asistencia.js
router.post('/mi-jornada/pausa',
    canRegistrarAsistencia,
    validar(iniciarPausaSchema),
    asyncHandler(marcajeController.iniciarPausa)
);

// controllers/asistencia/marcajeController.js
async function iniciarPausa(req, res) {
    const resultado = await marcajeService.iniciarPausa({
        usersCompanyId: req.user.users_company_id,
        tipo: req.body.tipo,
        contexto: { ip: req.ip, userAgent: req.get('user-agent'), io: req.io }
    });
    res.json(resultado);
}

// services/asistencia/marcajeService.js
async function iniciarPausa({ usersCompanyId, tipo, contexto }) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, conn);
        if (!jornada) throw new ConflictoJornadaError('No hay una jornada iniciada');

        const eventos = await eventoRepo.findByJornada(jornada.idjornada, conn);
        const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, jornada.fecha, conn);

        const estado = calcularJornada(eventos, horario, new Date());
        assertPuedeIniciarPausa(estado, tipo);          // dominio; lanza ReglaAsistenciaError

        await eventoRepo.insertar({ jornadaId: jornada.idjornada, tipo: `inicio_${tipo}` }, conn);
        await jornadaRepo.actualizarTotales(jornada.idjornada, estado, conn);
        await conn.commit();

        notificarDirector(contexto.io, usersCompanyId, `inicio_${tipo}`);
        return consultaService.estadoDeHoy(usersCompanyId);
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}
```

## Convenciones de nombres

- Base de datos en `snake_case`, JavaScript en `camelCase`, todo en español.
- Repositorios: `<entidad>Repository.js`, con métodos `findX`, `insertar`, `actualizarX`.
- Servicios: `<área>Service.js`, con métodos que nombran el caso de uso (`iniciarPausa`,
  `aprobarHoraExtra`).
- Respuestas HTTP con la forma `{ success, message, ...datos }` que ya usan los demás módulos.

## Antes de dar por terminado un cambio

- ¿Quedó algún SQL fuera de `repositories/`?
- ¿Algún controller con `try/catch` o con una regla de negocio dentro?
- ¿`domain/` importa algo con E/S?
- ¿Una escritura doble sin transacción?
- ¿Un literal numérico que debería estar en `asistencia_parametro`?
- ¿Un endpoint del director sin `assertEmpleadoACargo`?
- ¿Aritmética de fechas fuera de `utils/fechaBogota.js`?
