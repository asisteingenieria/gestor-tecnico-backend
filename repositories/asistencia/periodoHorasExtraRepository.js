const db = require('../../config/db');

// Fecha límite de cada mes para enviar el reporte de horas extras (migración 072). La fija financiera.

const aTexto = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : f);

async function obtener(periodo, conn = db) {
    const [rows] = await conn.query('SELECT periodo, fecha_limite, actualizado_en FROM periodo_horas_extra WHERE periodo = ?', [periodo]);
    return rows[0] ? { ...rows[0], fecha_limite: aTexto(rows[0].fecha_limite) } : null;
}

async function guardar(periodo, fechaLimite, userId, conn = db) {
    await conn.query(
        `INSERT INTO periodo_horas_extra (periodo, fecha_limite, definido_por_user_id) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE fecha_limite = VALUES(fecha_limite), definido_por_user_id = VALUES(definido_por_user_id)`,
        [periodo, fechaLimite, userId ?? null]
    );
}

/** Meses cuya fecha límite cae entre `desde` y `hasta` (para la campana). */
async function findConLimiteEntre(desde, hasta, conn = db) {
    const [rows] = await conn.query(
        'SELECT periodo, fecha_limite FROM periodo_horas_extra WHERE fecha_limite BETWEEN ? AND ? ORDER BY fecha_limite',
        [desde, hasta]
    );
    return rows.map((r) => ({ periodo: r.periodo, fecha_limite: aTexto(r.fecha_limite) }));
}

module.exports = { obtener, guardar, findConLimiteEntre };
