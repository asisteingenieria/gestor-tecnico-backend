const db = require('../../config/db');

// Traza de exámenes médicos de SST (hydra_candidato_examen, migración 089). Solo se
// insertan filas: la traza no se edita ni se borra.

const SELECT_EXAMEN = `
    SELECT e.idhydra_candidato_examen AS id, e.hydra_candidato_id, e.evento, e.nota, e.origen,
           e.creado_en, COALESCE(u.full_name, e.usuario_hydra) AS marcado_por
    FROM hydra_candidato_examen e
    LEFT JOIN users u ON u.id = e.users_id
`;

async function insertar({ candidatoId, evento, nota, origen, usuarioId, usuarioHydra }, conn = db) {
    const [result] = await conn.query(
        `INSERT INTO hydra_candidato_examen (hydra_candidato_id, evento, nota, origen, users_id, usuario_hydra)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [candidatoId, evento, nota ?? null, origen, usuarioId ?? null, usuarioHydra ?? null]
    );
    return result.insertId;
}

async function findById(id, conn = db) {
    const [rows] = await conn.query(`${SELECT_EXAMEN} WHERE e.idhydra_candidato_examen = ?`, [id]);
    return rows[0] ?? null;
}

async function findByCandidato(candidatoId, conn = db) {
    const [rows] = await conn.query(
        `${SELECT_EXAMEN} WHERE e.hydra_candidato_id = ? ORDER BY e.idhydra_candidato_examen`,
        [candidatoId]
    );
    return rows;
}

module.exports = { insertar, findById, findByCandidato };
