const db = require('../../config/db');

async function findByIdempotencyKey(clave, conn = db) {
    const [rows] = await conn.query(
        'SELECT endpoint, hash_cuerpo, codigo_respuesta, respuesta FROM hydra_peticion_entrante WHERE idempotency_key = ?',
        [clave]
    );
    return rows[0] ?? null;
}

// INSERT IGNORE: si dos reintentos con la misma clave terminan a la vez, el segundo no
// debe fallar — la respuesta ya quedó guardada por el primero.
async function insertar({ idempotencyKey, endpoint, hashCuerpo, codigoRespuesta, respuesta, ipOrigen }, conn = db) {
    await conn.query(
        `INSERT IGNORE INTO hydra_peticion_entrante
            (idempotency_key, endpoint, hash_cuerpo, codigo_respuesta, respuesta, ip_origen)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [idempotencyKey, endpoint, hashCuerpo, codigoRespuesta, JSON.stringify(respuesta), ipOrigen ?? null]
    );
}

module.exports = { findByIdempotencyKey, insertar };
