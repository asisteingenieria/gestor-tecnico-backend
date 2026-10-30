const db = require('../../config/db');

async function findByExternoIdParaActualizar(loteExternoId, conn = db) {
    const [rows] = await conn.query(
        'SELECT * FROM hydra_lote WHERE lote_externo_id = ? FOR UPDATE',
        [loteExternoId]
    );
    return rows[0] ?? null;
}

async function findByIdParaActualizar(id, conn = db) {
    const [rows] = await conn.query('SELECT * FROM hydra_lote WHERE idhydra_lote = ? FOR UPDATE', [id]);
    return rows[0] ?? null;
}

// Bandeja de RRHH: lotes con el conteo de candidatos por estado.
async function findAll({ estado } = {}, conn = db) {
    const condiciones = [];
    const params = [];
    if (estado) {
        condiciones.push('l.estado = ?');
        params.push(estado);
    }
    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const [rows] = await conn.query(
        `SELECT l.idhydra_lote, l.lote_externo_id, l.nombre, l.fecha_ingreso_sugerida, l.estado,
                l.registrado_en, l.created_at, l.updated_at,
                COUNT(c.idhydra_candidato) AS total,
                COALESCE(SUM(c.estado = 'pendiente'), 0) AS pendientes,
                COALESCE(SUM(c.estado = 'listo'), 0) AS listos,
                COALESCE(SUM(c.estado = 'registrado'), 0) AS registrados,
                COALESCE(SUM(c.estado IN ('descartado', 'cancelado_hydra', 'no_apto')), 0) AS fuera_del_lote,
                -- Exámenes médicos de SST por resolver (migración 089): candidatos en curso sin aprobar.
                COALESCE(SUM(c.estado IN ('pendiente', 'listo') AND c.examen_estado <> 'aprobado'), 0) AS examenes_pendientes,
                COALESCE(SUM(c.estado IN ('pendiente', 'listo') AND c.examen_estado = 'no_asistio'), 0) AS examenes_no_asistio
         FROM hydra_lote l
         LEFT JOIN hydra_candidato c ON c.hydra_lote_id = l.idhydra_lote
         ${where}
         GROUP BY l.idhydra_lote
         ORDER BY l.created_at DESC, l.idhydra_lote DESC`,
        params
    );
    return rows.map((r) => ({
        ...r,
        total: Number(r.total),
        pendientes: Number(r.pendientes),
        listos: Number(r.listos),
        registrados: Number(r.registrados),
        fuera_del_lote: Number(r.fuera_del_lote),
        examenes_pendientes: Number(r.examenes_pendientes),
        examenes_no_asistio: Number(r.examenes_no_asistio)
    }));
}

async function findById(id, conn = db) {
    const [rows] = await conn.query('SELECT * FROM hydra_lote WHERE idhydra_lote = ?', [id]);
    return rows[0] ?? null;
}

// Lotes abiertos que tienen candidatos todavía editables, bloqueados en orden de id
// (mismo orden lote → candidato que el resto del módulo). Para aplicar un mapeo nuevo.
async function findAbiertosConCandidatosEditablesParaActualizar(conn = db) {
    const [rows] = await conn.query(
        `SELECT * FROM hydra_lote
         WHERE estado IN ('abierto', 'listo')
           AND idhydra_lote IN (SELECT hydra_lote_id FROM hydra_candidato WHERE estado IN ('pendiente', 'listo'))
         ORDER BY idhydra_lote
         FOR UPDATE`
    );
    return rows;
}

async function insertar({ loteExternoId, nombre, fechaIngresoSugerida }, conn = db) {
    const [result] = await conn.query(
        'INSERT INTO hydra_lote (lote_externo_id, nombre, fecha_ingreso_sugerida) VALUES (?, ?, ?)',
        [loteExternoId, nombre, fechaIngresoSugerida ?? null]
    );
    return result.insertId;
}

async function actualizarEstado(id, estado, conn = db) {
    await conn.query('UPDATE hydra_lote SET estado = ? WHERE idhydra_lote = ?', [estado, id]);
}

async function marcarRegistrado(id, usuarioId, conn = db) {
    await conn.query(
        "UPDATE hydra_lote SET estado = 'registrado', registrado_por_user_id = ?, registrado_en = UTC_TIMESTAMP() WHERE idhydra_lote = ?",
        [usuarioId, id]
    );
}

module.exports = {
    findByExternoIdParaActualizar,
    findByIdParaActualizar,
    findAll,
    findById,
    findAbiertosConCandidatosEditablesParaActualizar,
    insertar,
    actualizarEstado,
    marcarRegistrado
};
