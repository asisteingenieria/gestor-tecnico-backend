const db = require('../../config/db');

async function findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha, conn = db) {
    const [filas] = await conn.query(
        "SELECT * FROM hora_extra WHERE users_company_id = ? AND fecha = ? AND estado = 'aprobada'",
        [usersCompanyId, fecha]
    );
    return filas;
}

async function insertarSolicitud({ usersCompanyId, fecha, horaInicio, horaFin, minutosEstimados, clase, motivo, solicitadoPor }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO hora_extra (users_company_id, fecha, hora_inicio, hora_fin, tipo, clase, minutos_estimados, estado, motivo, solicitado_por_user_id, solicitado_por_cuenta_id, creado_en)
         VALUES (?, ?, ?, ?, 'solicitada', ?, ?, 'pendiente', ?, ?, ?, NOW())`,
        [usersCompanyId, fecha, horaInicio ?? null, horaFin ?? null, clase, minutosEstimados, motivo, solicitadoPor?.userId ?? null, solicitadoPor?.cuentaId ?? null]
    );
    return resultado.insertId;
}

// Tramos: la clasificación (1..n clases) de una hora extra. El UNIQUE (idhora_extra, clase) garantiza
// una fila por clase. `reemplazarTramos` los vuelve a escribir cuando el jefe ajusta al aprobar.
async function insertarTramos(idhoraExtra, tramos, conn = db) {
    const filas = (tramos || []).filter((t) => (Number(t.minutos) || 0) > 0);
    if (filas.length === 0) return;
    await conn.query(
        'INSERT INTO hora_extra_tramo (idhora_extra, clase, minutos) VALUES ?',
        [filas.map((t) => [idhoraExtra, t.clase, t.minutos])]
    );
}

async function reemplazarTramos(idhoraExtra, tramos, conn = db) {
    await conn.query('DELETE FROM hora_extra_tramo WHERE idhora_extra = ?', [idhoraExtra]);
    await insertarTramos(idhoraExtra, tramos, conn);
}

async function findTramos(idhoraExtra, conn = db) {
    const [filas] = await conn.query(
        'SELECT clase, minutos FROM hora_extra_tramo WHERE idhora_extra = ?',
        [idhoraExtra]
    );
    return filas;
}

async function findTramosPorHorasExtra(ids, conn = db) {
    if (!ids || ids.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT idhora_extra, clase, minutos FROM hora_extra_tramo
         WHERE idhora_extra IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    return filas;
}

async function findPorEmpleado(usersCompanyId, { estado } = {}, conn = db) {
    const condiciones = ['users_company_id = ?'];
    const parametros = [usersCompanyId];
    if (estado) {
        condiciones.push('estado = ?');
        parametros.push(estado);
    }
    const [filas] = await conn.query(
        `SELECT * FROM hora_extra WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC`,
        parametros
    );
    return filas;
}

async function findById(id, conn = db) {
    const [filas] = await conn.query('SELECT * FROM hora_extra WHERE idhora_extra = ?', [id]);
    return filas[0] ?? null;
}

async function findPorEquipo(usersCompanyIds, { estado } = {}, conn = db) {
    if (usersCompanyIds.length === 0) return [];
    const condiciones = [`users_company_id IN (${usersCompanyIds.map(() => '?').join(',')})`];
    const parametros = [...usersCompanyIds];
    if (estado) {
        condiciones.push('estado = ?');
        parametros.push(estado);
    }
    const [filas] = await conn.query(
        `SELECT * FROM hora_extra WHERE ${condiciones.join(' AND ')} ORDER BY fecha DESC`,
        parametros
    );
    return filas;
}

async function resolver(id, { estado, minutosAprobados, clase, comentario, aprobadoPor }, conn = db) {
    // `clase` solo se toca al aprobar, cuando el jefe la ajusta; si no viene, se deja la que puso
    // el agente (COALESCE con el valor actual).
    const [resultado] = await conn.query(
        `UPDATE hora_extra
         SET estado = ?, minutos_aprobados = ?, clase = COALESCE(?, clase), comentario_director = ?,
             aprobado_por_user_id = ?, aprobado_por_cuenta_id = ?, fecha_decision = NOW()
         WHERE idhora_extra = ? AND estado = 'pendiente'`,
        [estado, minutosAprobados ?? null, clase ?? null, comentario ?? null, aprobadoPor?.userId ?? null, aprobadoPor?.cuentaId ?? null, id]
    );
    return resultado.affectedRows > 0;
}

async function insertarAsignada({ usersCompanyId, fecha, minutos, clase, motivo, aprobadoPor }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO hora_extra
            (users_company_id, fecha, tipo, clase, minutos_estimados, minutos_aprobados, estado, motivo,
             solicitado_por_user_id, solicitado_por_cuenta_id, aprobado_por_user_id, aprobado_por_cuenta_id, fecha_decision, creado_en)
         VALUES (?, ?, 'asignada', ?, ?, ?, 'aprobada', ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
            usersCompanyId, fecha, clase, minutos, minutos, motivo ?? null,
            aprobadoPor?.userId ?? null, aprobadoPor?.cuentaId ?? null, aprobadoPor?.userId ?? null, aprobadoPor?.cuentaId ?? null
        ]
    );
    return resultado.insertId;
}

module.exports = {
    findAprobadasPorEmpleadoYFecha,
    insertarSolicitud,
    insertarTramos,
    reemplazarTramos,
    findTramos,
    findTramosPorHorasExtra,
    findPorEmpleado,
    findById,
    findPorEquipo,
    resolver,
    insertarAsignada
};
