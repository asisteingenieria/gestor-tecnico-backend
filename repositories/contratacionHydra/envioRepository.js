const { randomUUID } = require('node:crypto');
const db = require('../../config/db');

// Outbox hacia Hydra (hydra_envio_saliente). Las fechas se calculan en la BD con
// UTC_TIMESTAMP(): el pool corre en UTC y así no depende del reloj del proceso.

async function insertar({ tipo, hydraCandidatoExternoId, payload }, conn = db) {
    const idempotencyKey = randomUUID();
    await conn.query(
        `INSERT INTO hydra_envio_saliente (tipo, hydra_candidato_externo_id, payload, idempotency_key, proximo_intento)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
        [tipo, hydraCandidatoExternoId, JSON.stringify(payload), idempotencyKey]
    );
    return idempotencyKey;
}

// Siguiente envío vencido, bloqueado. SKIP LOCKED permite correr dos despachadores a la
// vez (o una corrida que se solapa con la anterior) sin que tomen la misma fila.
// Requiere MySQL 8+.
async function findSiguienteParaDespacho(conn = db) {
    const [rows] = await conn.query(
        `SELECT * FROM hydra_envio_saliente
         WHERE estado = 'pendiente' AND proximo_intento <= UTC_TIMESTAMP()
         ORDER BY proximo_intento, idhydra_envio_saliente
         LIMIT 1
         FOR UPDATE SKIP LOCKED`
    );
    return rows[0] ?? null;
}

async function registrarResultado(id, { estado, intentos, esperaMinutos, error }, conn = db) {
    await conn.query(
        `UPDATE hydra_envio_saliente
         SET estado = ?, intentos = ?, ultimo_error = ?,
             proximo_intento = IF(? IS NULL, proximo_intento, UTC_TIMESTAMP() + INTERVAL ? MINUTE)
         WHERE idhydra_envio_saliente = ?`,
        [estado, intentos, error ? String(error).slice(0, 500) : null, esperaMinutos, esperaMinutos ?? 0, id]
    );
}

async function findAll({ estado } = {}, conn = db) {
    const condiciones = [];
    const params = [];
    if (estado) {
        condiciones.push('e.estado = ?');
        params.push(estado);
    }
    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const [rows] = await conn.query(
        `SELECT e.idhydra_envio_saliente, e.tipo, e.hydra_candidato_externo_id, e.estado, e.intentos,
                e.proximo_intento, e.ultimo_error, e.created_at, e.updated_at,
                c.nombre_completo
         FROM hydra_envio_saliente e
         LEFT JOIN hydra_candidato c ON c.hydra_candidato_externo_id = e.hydra_candidato_externo_id
         ${where}
         ORDER BY e.created_at DESC, e.idhydra_envio_saliente DESC
         LIMIT 500`,
        params
    );
    return rows;
}

async function findEstadoById(id, conn = db) {
    const [rows] = await conn.query('SELECT estado FROM hydra_envio_saliente WHERE idhydra_envio_saliente = ?', [id]);
    return rows[0]?.estado ?? null;
}

// "Reintentar" desde la UI: solo sobre un envío fallido; reinicia el contador.
async function reintentar(id, conn = db) {
    const [result] = await conn.query(
        `UPDATE hydra_envio_saliente
         SET estado = 'pendiente', intentos = 0, proximo_intento = UTC_TIMESTAMP()
         WHERE idhydra_envio_saliente = ? AND estado = 'fallido'`,
        [id]
    );
    return result.affectedRows > 0;
}

module.exports = { insertar, findSiguienteParaDespacho, registrarResultado, findAll, findEstadoById, reintentar };
