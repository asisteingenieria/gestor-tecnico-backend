const { randomUUID } = require('node:crypto');
const db = require('../../config/db');

// Outbox hacia AsisLock (asislock_envio_saliente, migración 071): avisos de alta, baja y
// reactivación de usuarios de la pantalla gris. Mismo esquema que el outbox hacia Hydra.

async function insertar({ evento, usersCompanyId, usuario, payload }, conn = db) {
    const idempotencyKey = randomUUID();
    await conn.query(
        `INSERT INTO asislock_envio_saliente (evento, users_company_id, usuario, payload, idempotency_key, proximo_intento)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [evento, usersCompanyId, usuario, JSON.stringify(payload), idempotencyKey]
    );
    return idempotencyKey;
}

// SKIP LOCKED: dos corridas solapadas del despachador no toman la misma fila. Va en orden de
// creación para que una baja nunca adelante al alta del mismo usuario.
async function findSiguienteParaDespacho(conn = db) {
    const [rows] = await conn.query(
        `SELECT * FROM asislock_envio_saliente
          WHERE estado = 'pendiente' AND proximo_intento <= UTC_TIMESTAMP()
          ORDER BY idasislock_envio_saliente
          LIMIT 1
          FOR UPDATE SKIP LOCKED`
    );
    return rows[0] ?? null;
}

async function registrarResultado(id, { estado, intentos, esperaMinutos, error }, conn = db) {
    await conn.query(
        `UPDATE asislock_envio_saliente
            SET estado = ?, intentos = ?, ultimo_error = ?,
                proximo_intento = IF(? IS NULL, proximo_intento, UTC_TIMESTAMP() + INTERVAL ? MINUTE)
          WHERE idasislock_envio_saliente = ?`,
        [estado, intentos, error ? String(error).slice(0, 500) : null, esperaMinutos, esperaMinutos ?? 0, id]
    );
}

module.exports = { insertar, findSiguienteParaDespacho, registrarResultado };
