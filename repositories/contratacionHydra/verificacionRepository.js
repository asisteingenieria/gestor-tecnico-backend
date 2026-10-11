const db = require('../../config/db');

const SELECT_VERIFICACION = `
    SELECT v.hydra_candidato_id, v.seccion, v.hash_contenido, v.verificado_por_user_id,
           v.verificado_en, u.full_name AS verificado_por_nombre
    FROM hydra_candidato_verificacion v
    LEFT JOIN users u ON u.id = v.verificado_por_user_id
`;

async function findByCandidato(candidatoId, conn = db) {
    const [rows] = await conn.query(`${SELECT_VERIFICACION} WHERE v.hydra_candidato_id = ?`, [candidatoId]);
    return rows;
}

// Todas las verificaciones de un lote en una consulta (evita una por candidato).
async function findByLote(loteId, conn = db) {
    const [rows] = await conn.query(
        `${SELECT_VERIFICACION}
         JOIN hydra_candidato c ON c.idhydra_candidato = v.hydra_candidato_id
         WHERE c.hydra_lote_id = ?`,
        [loteId]
    );
    return rows;
}

// Marcar de nuevo una sección (p. ej. después de editarla) reemplaza hash, autor y fecha.
async function guardar({ candidatoId, seccion, hashContenido, usuarioId }, conn = db) {
    await conn.query(
        `INSERT INTO hydra_candidato_verificacion
            (hydra_candidato_id, seccion, hash_contenido, verificado_por_user_id, verificado_en)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE hash_contenido = VALUES(hash_contenido),
            verificado_por_user_id = VALUES(verificado_por_user_id), verificado_en = VALUES(verificado_en)`,
        [candidatoId, seccion, hashContenido, usuarioId]
    );
}

async function eliminar(candidatoId, seccion, conn = db) {
    await conn.query(
        'DELETE FROM hydra_candidato_verificacion WHERE hydra_candidato_id = ? AND seccion = ?',
        [candidatoId, seccion]
    );
}

module.exports = { findByCandidato, findByLote, guardar, eliminar };
