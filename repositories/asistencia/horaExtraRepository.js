const db = require('../../config/db');

async function findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha, conn = db) {
    const [filas] = await conn.query(
        "SELECT * FROM hora_extra WHERE users_company_id = ? AND fecha = ? AND estado = 'aprobada'",
        [usersCompanyId, fecha]
    );
    return filas;
}

// Las aprobadas de un día de varias personas en una consulta (tableros en vivo, §47).
async function findAprobadasPorEmpleadosYFecha(usersCompanyIds, fecha, conn = db) {
    if (usersCompanyIds.length === 0) return [];
    const [filas] = await conn.query(
        "SELECT * FROM hora_extra WHERE users_company_id IN (?) AND fecha = ? AND estado = 'aprobada'",
        [usersCompanyIds, fecha]
    );
    return filas;
}

// `solicitante`/`aprobador` (fichas, 085): el jefe que la pide y el director que la aprueba (§51).
async function insertarSolicitud({
    usersCompanyId, fecha, horaInicio, horaFin, minutosEstimados, clase, motivo, solicitadoPor, solicitanteUsersCompanyId, aprobadorUsersCompanyId
}, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO hora_extra (users_company_id, fecha, hora_inicio, hora_fin, tipo, clase, minutos_estimados, estado, motivo,
                                 solicitante_users_company_id, aprobador_users_company_id, solicitado_por_user_id, solicitado_por_cuenta_id, creado_en)
         VALUES (?, ?, ?, ?, 'solicitada', ?, ?, 'pendiente', ?, ?, ?, ?, ?, NOW())`,
        [
            usersCompanyId, fecha, horaInicio ?? null, horaFin ?? null, clase, minutosEstimados, motivo,
            solicitanteUsersCompanyId ?? null, aprobadorUsersCompanyId ?? null, solicitadoPor?.userId ?? null, solicitadoPor?.cuentaId ?? null
        ]
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

// Con los nombres que muestran las bandejas: el director no tiene a la gente del jefe en su lista.
const CON_NOMBRES = `SELECT he.*, e.nombre_propio AS empleado, s.nombre_propio AS solicitante, a.nombre_propio AS aprobador
         FROM hora_extra he
         JOIN users_company e ON e.id = he.users_company_id
         LEFT JOIN users_company s ON s.id = he.solicitante_users_company_id
         LEFT JOIN users_company a ON a.id = he.aprobador_users_company_id`;

// Lo que le toca resolver a esta ficha: las que la tienen de aprobador y, del flujo anterior (sin
// aprobador), las de su propia gente (`empleadosDirectos`), que siguen siendo del jefe (§51).
async function findBandeja(aprobadorUsersCompanyId, empleadosDirectos, { estado } = {}, conn = db) {
    const condiciones = [
        empleadosDirectos.length > 0
            ? '(he.aprobador_users_company_id = ? OR (he.aprobador_users_company_id IS NULL AND he.users_company_id IN (?)))'
            : 'he.aprobador_users_company_id = ?'
    ];
    const parametros = empleadosDirectos.length > 0 ? [aprobadorUsersCompanyId, empleadosDirectos] : [aprobadorUsersCompanyId];
    if (estado) {
        condiciones.push('he.estado = ?');
        parametros.push(estado);
    }
    const [filas] = await conn.query(
        `${CON_NOMBRES} WHERE ${condiciones.join(' AND ')} ORDER BY he.estado = 'pendiente' DESC, he.fecha DESC LIMIT 500`,
        parametros
    );
    return filas;
}

async function findPorSolicitante(solicitanteUsersCompanyId, { estado } = {}, conn = db) {
    const condiciones = ['he.solicitante_users_company_id = ?'];
    const parametros = [solicitanteUsersCompanyId];
    if (estado) {
        condiciones.push('he.estado = ?');
        parametros.push(estado);
    }
    const [filas] = await conn.query(
        `${CON_NOMBRES} WHERE ${condiciones.join(' AND ')} ORDER BY he.estado = 'pendiente' DESC, he.fecha DESC LIMIT 500`,
        parametros
    );
    return filas;
}

async function findDetalle(id, conn = db) {
    const [filas] = await conn.query(`${CON_NOMBRES} WHERE he.idhora_extra = ?`, [id]);
    return filas[0] ?? null;
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

module.exports = {
    findAprobadasPorEmpleadoYFecha,
    findAprobadasPorEmpleadosYFecha,
    insertarSolicitud,
    insertarTramos,
    reemplazarTramos,
    findTramos,
    findTramosPorHorasExtra,
    findPorEmpleado,
    findById,
    findBandeja,
    findPorSolicitante,
    findDetalle,
    resolver
};
