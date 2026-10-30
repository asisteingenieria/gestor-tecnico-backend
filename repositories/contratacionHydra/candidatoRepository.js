const db = require('../../config/db');

// mysql2 devuelve las columnas JSON ya parseadas; al escribir se serializa aquí, para que
// los servicios trabajen siempre con objetos.

async function findByExternoIdParaActualizar(hydraCandidatoExternoId, conn = db) {
    const [rows] = await conn.query(
        'SELECT * FROM hydra_candidato WHERE hydra_candidato_externo_id = ? FOR UPDATE',
        [hydraCandidatoExternoId]
    );
    return rows[0] ?? null;
}

// Resumen para que Hydra consulte el estado (sin datos personales en la respuesta).
async function findEstadoByExternoId(hydraCandidatoExternoId, conn = db) {
    const [rows] = await conn.query(
        `SELECT c.hydra_candidato_externo_id, c.estado, c.examen_estado, c.motivo_descarte, c.users_company_id,
                c.version_hydra, c.updated_at, l.lote_externo_id, l.estado AS lote_estado
         FROM hydra_candidato c
         JOIN hydra_lote l ON l.idhydra_lote = c.hydra_lote_id
         WHERE c.hydra_candidato_externo_id = ?`,
        [hydraCandidatoExternoId]
    );
    return rows[0] ?? null;
}

async function findById(id, conn = db) {
    const [rows] = await conn.query('SELECT * FROM hydra_candidato WHERE idhydra_candidato = ?', [id]);
    return rows[0] ?? null;
}

async function findByIdParaActualizar(id, conn = db) {
    const [rows] = await conn.query('SELECT * FROM hydra_candidato WHERE idhydra_candidato = ? FOR UPDATE', [id]);
    return rows[0] ?? null;
}

async function findByLote(loteId, conn = db) {
    const [rows] = await conn.query(
        'SELECT * FROM hydra_candidato WHERE hydra_lote_id = ? ORDER BY nombre_completo, idhydra_candidato',
        [loteId]
    );
    return rows;
}

async function findEditablesByLoteParaActualizar(loteId, conn = db) {
    const [rows] = await conn.query(
        `SELECT * FROM hydra_candidato
         WHERE hydra_lote_id = ? AND estado IN ('pendiente', 'listo')
         ORDER BY idhydra_candidato
         FOR UPDATE`,
        [loteId]
    );
    return rows;
}

// Registro del lote: todos sus candidatos, bloqueados.
async function findByLoteParaActualizar(loteId, conn = db) {
    const [rows] = await conn.query(
        'SELECT * FROM hydra_candidato WHERE hydra_lote_id = ? ORDER BY idhydra_candidato FOR UPDATE',
        [loteId]
    );
    return rows;
}

async function marcarRegistrado(id, usersCompanyId, conn = db) {
    await conn.query(
        "UPDATE hydra_candidato SET estado = 'registrado', users_company_id = ? WHERE idhydra_candidato = ?",
        [usersCompanyId, id]
    );
}

// Edición de RRHH: borrador + estado derivado, en una sola escritura.
async function actualizarBorrador(id, datosEmpleado, estado, conn = db) {
    await conn.query(
        'UPDATE hydra_candidato SET datos_empleado = ?, estado = ? WHERE idhydra_candidato = ?',
        [JSON.stringify(datosEmpleado), estado, id]
    );
}

async function findEstadosByLote(loteId, conn = db) {
    const [rows] = await conn.query('SELECT estado FROM hydra_candidato WHERE hydra_lote_id = ?', [loteId]);
    return rows.map((r) => r.estado);
}

async function insertar(candidato, conn = db) {
    const [result] = await conn.query(
        `INSERT INTO hydra_candidato (
            hydra_lote_id, hydra_candidato_externo_id, tipo_identificacion, numero_identificacion,
            nombre_completo, cargo_hydra, datos_hydra, version_hydra, datos_empleado, estado,
            users_company_existente_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            candidato.loteId, candidato.hydraCandidatoExternoId, candidato.tipoIdentificacion,
            candidato.numeroIdentificacion, candidato.nombreCompleto, candidato.cargoHydra,
            JSON.stringify(candidato.datosHydra), candidato.versionHydra,
            JSON.stringify(candidato.datosEmpleado), candidato.estado,
            candidato.usersCompanyExistenteId ?? null
        ]
    );
    return result.insertId;
}

// Reenvío de Hydra: reemplaza el payload original y el borrador ya fusionado.
async function actualizarDesdeHydra(id, candidato, conn = db) {
    await conn.query(
        `UPDATE hydra_candidato SET
            tipo_identificacion = ?, numero_identificacion = ?, nombre_completo = ?, cargo_hydra = ?,
            datos_hydra = ?, version_hydra = ?, datos_empleado = ?, estado = ?,
            motivo_descarte = ?, users_company_existente_id = ?
         WHERE idhydra_candidato = ?`,
        [
            candidato.tipoIdentificacion, candidato.numeroIdentificacion, candidato.nombreCompleto,
            candidato.cargoHydra, JSON.stringify(candidato.datosHydra), candidato.versionHydra,
            JSON.stringify(candidato.datosEmpleado), candidato.estado, candidato.motivoDescarte ?? null,
            candidato.usersCompanyExistenteId ?? null, id
        ]
    );
}

// Exámenes médicos de SST (migración 089).
async function actualizarExamen(id, examenEstado, conn = db) {
    await conn.query('UPDATE hydra_candidato SET examen_estado = ? WHERE idhydra_candidato = ?', [examenEstado, id]);
}

async function actualizarEstado(id, estado, motivoDescarte, conn = db) {
    await conn.query(
        'UPDATE hydra_candidato SET estado = ?, motivo_descarte = ? WHERE idhydra_candidato = ?',
        [estado, motivoDescarte ?? null, id]
    );
}

module.exports = {
    findByExternoIdParaActualizar,
    findEstadoByExternoId,
    findById,
    findByIdParaActualizar,
    findByLote,
    findEditablesByLoteParaActualizar,
    findByLoteParaActualizar,
    marcarRegistrado,
    findEstadosByLote,
    insertar,
    actualizarDesdeHydra,
    actualizarBorrador,
    actualizarExamen,
    actualizarEstado
};
