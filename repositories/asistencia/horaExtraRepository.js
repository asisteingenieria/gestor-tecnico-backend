const db = require('../../config/db');

async function findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha, conn = db) {
    const [filas] = await conn.query(
        "SELECT * FROM hora_extra WHERE users_company_id = ? AND fecha = ? AND estado = 'aprobada'",
        [usersCompanyId, fecha]
    );
    return filas;
}

async function insertarSolicitud({ usersCompanyId, fecha, minutosEstimados, clase, motivo, solicitadoPor }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO hora_extra (users_company_id, fecha, tipo, clase, minutos_estimados, estado, motivo, solicitado_por_user_id, solicitado_por_cuenta_id)
         VALUES (?, ?, 'solicitada', ?, ?, 'pendiente', ?, ?, ?)`,
        [usersCompanyId, fecha, clase, minutosEstimados, motivo, solicitadoPor?.userId ?? null, solicitadoPor?.cuentaId ?? null]
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
             solicitado_por_user_id, solicitado_por_cuenta_id, aprobado_por_user_id, aprobado_por_cuenta_id, fecha_decision)
         VALUES (?, ?, 'asignada', ?, ?, ?, 'aprobada', ?, ?, ?, ?, ?, NOW())`,
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
    findPorEmpleado,
    findById,
    findPorEquipo,
    resolver,
    insertarAsignada
};
