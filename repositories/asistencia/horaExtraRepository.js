const db = require('../../config/db');

async function findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha, conn = db) {
    const [filas] = await conn.query(
        "SELECT * FROM hora_extra WHERE users_company_id = ? AND fecha = ? AND estado = 'aprobada'",
        [usersCompanyId, fecha]
    );
    return filas;
}

async function insertarSolicitud({ usersCompanyId, fecha, minutosEstimados, motivo, solicitadoPorUserId }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO hora_extra (users_company_id, fecha, tipo, minutos_estimados, estado, motivo, solicitado_por_user_id)
         VALUES (?, ?, 'solicitada', ?, 'pendiente', ?, ?)`,
        [usersCompanyId, fecha, minutosEstimados, motivo, solicitadoPorUserId]
    );
    return resultado.insertId;
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

async function resolver(id, { estado, minutosAprobados, comentario, aprobadoPorUserId }, conn = db) {
    const [resultado] = await conn.query(
        `UPDATE hora_extra
         SET estado = ?, minutos_aprobados = ?, comentario_director = ?, aprobado_por_user_id = ?, fecha_decision = NOW()
         WHERE idhora_extra = ?`,
        [estado, minutosAprobados ?? null, comentario ?? null, aprobadoPorUserId, id]
    );
    return resultado.affectedRows > 0;
}

async function insertarAsignada({ usersCompanyId, fecha, minutos, motivo, aprobadoPorUserId }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO hora_extra
            (users_company_id, fecha, tipo, minutos_estimados, minutos_aprobados, estado, motivo, solicitado_por_user_id, aprobado_por_user_id, fecha_decision)
         VALUES (?, ?, 'asignada', ?, ?, 'aprobada', ?, ?, ?, NOW())`,
        [usersCompanyId, fecha, minutos, minutos, motivo ?? null, aprobadoPorUserId, aprobadoPorUserId]
    );
    return resultado.insertId;
}

module.exports = {
    findAprobadasPorEmpleadoYFecha,
    insertarSolicitud,
    findPorEmpleado,
    findById,
    findPorEquipo,
    resolver,
    insertarAsignada
};
