const db = require('../../config/db');

// Documentos de contratación que envía Hydra (migración 087). `archivo` es el nombre
// generado en storage/contratacion-hydra/: los servicios no lo devuelven a la UI.

const COLUMNAS = `d.idhydra_candidato_documento AS id, d.hydra_candidato_id, d.tipo, d.nombre,
    d.nombre_original, d.mime, d.tamano_bytes, d.sha256, d.archivo, d.recibido_en`;

async function findByCandidatoYTipoParaActualizar(hydraCandidatoId, tipo, conn = db) {
    const [rows] = await conn.query(
        `SELECT ${COLUMNAS} FROM hydra_candidato_documento d
         WHERE d.hydra_candidato_id = ? AND d.tipo = ? FOR UPDATE`,
        [hydraCandidatoId, tipo]
    );
    return rows[0] ?? null;
}

// Alta o reemplazo: uno por tipo y candidato (UNIQUE). `recibido_en` se actualiza solo.
async function guardar(documento, conn = db) {
    await conn.query(
        `INSERT INTO hydra_candidato_documento
            (hydra_candidato_id, tipo, nombre, nombre_original, mime, tamano_bytes, sha256, archivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            nombre = VALUES(nombre), nombre_original = VALUES(nombre_original), mime = VALUES(mime),
            tamano_bytes = VALUES(tamano_bytes), sha256 = VALUES(sha256), archivo = VALUES(archivo)`,
        [
            documento.hydraCandidatoId, documento.tipo, documento.nombre, documento.nombreOriginal,
            documento.mime, documento.tamanoBytes, documento.sha256, documento.archivo
        ]
    );
}

async function findByCandidato(hydraCandidatoId, conn = db) {
    const [rows] = await conn.query(
        `SELECT ${COLUMNAS} FROM hydra_candidato_documento d WHERE d.hydra_candidato_id = ?`,
        [hydraCandidatoId]
    );
    return rows;
}

// Tipos recibidos por candidato de un lote, para exigir los firmados al registrar.
async function findTiposByLote(loteId, conn = db) {
    const [rows] = await conn.query(
        `SELECT d.hydra_candidato_id, d.tipo
         FROM hydra_candidato_documento d
         JOIN hydra_candidato c ON c.idhydra_candidato = d.hydra_candidato_id
         WHERE c.hydra_lote_id = ?`,
        [loteId]
    );
    return rows;
}

async function findById(id, conn = db) {
    const [rows] = await conn.query(
        `SELECT ${COLUMNAS} FROM hydra_candidato_documento d WHERE d.idhydra_candidato_documento = ?`,
        [id]
    );
    return rows[0] ?? null;
}

// Documentos de la ficha de un empleado: los del candidato de Hydra que se registró como él.
async function findByEmpleado(usersCompanyId, conn = db) {
    const [rows] = await conn.query(
        `SELECT ${COLUMNAS}, c.datos_hydra, l.nombre AS lote_nombre
         FROM hydra_candidato c
         JOIN hydra_lote l ON l.idhydra_lote = c.hydra_lote_id
         LEFT JOIN hydra_candidato_documento d ON d.hydra_candidato_id = c.idhydra_candidato
         WHERE c.users_company_id = ?`,
        [usersCompanyId]
    );
    return rows;
}

module.exports = {
    findByCandidatoYTipoParaActualizar,
    guardar,
    findByCandidato,
    findTiposByLote,
    findById,
    findByEmpleado
};
