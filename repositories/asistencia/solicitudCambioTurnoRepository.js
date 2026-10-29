const db = require('../../config/db');

// Solicitudes de cambio de turno (migración 084, asistencia.md §50).
const nombreDe = (alias) => `TRIM(CONCAT_WS(' ', ${alias}.primer_nombre, ${alias}.segundo_nombre, ${alias}.primer_apellido, ${alias}.segundo_apellido))`;

async function insertar({ tipo, solicitanteUsersCompanyId, solicitadoPor, aprobadorUsersCompanyId, motivo }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO solicitud_cambio_turno
            (tipo, solicitante_users_company_id, solicitado_por_user_id, solicitado_por_cuenta_id, aprobador_users_company_id, motivo, creado_en)
         VALUES (?, ?, ?, ?, ?, ?, NOW(3))`,
        [tipo, solicitanteUsersCompanyId, solicitadoPor?.userId ?? null, solicitadoPor?.cuentaId ?? null, aprobadorUsersCompanyId, motivo]
    );
    return resultado.insertId;
}

async function insertarDias(solicitudId, dias, conn = db) {
    if (dias.length === 0) return;
    await conn.query(
        `INSERT INTO solicitud_cambio_turno_dia
            (solicitud_id, users_company_id, fecha, horario_plantilla_id, hora_entrada, hora_salida, minutos_almuerzo,
             hora_almuerzo_inicio, tolerancia_entrada_min, es_descanso,
             anterior_hora_entrada, anterior_hora_salida, anterior_es_descanso, anterior_plantilla)
         VALUES ?`,
        [dias.map((d) => [
            solicitudId, d.usersCompanyId, d.fecha, d.horarioPlantillaId ?? null, d.horaEntrada, d.horaSalida, d.minutosAlmuerzo ?? 60,
            d.horaAlmuerzoInicio ?? null, d.toleranciaEntradaMin ?? 5, d.esDescanso ? 1 : 0,
            d.anteriorHoraEntrada ?? null, d.anteriorHoraSalida ?? null, d.anteriorEsDescanso ?? null, d.anteriorPlantilla ?? null
        ])]
    );
}

// Bloquea la solicitud mientras se resuelve: dos clics en "Aprobar" no la aplican dos veces.
async function findByIdParaActualizar(id, conn = db) {
    const [filas] = await conn.query('SELECT * FROM solicitud_cambio_turno WHERE idsolicitud_cambio_turno = ? FOR UPDATE', [id]);
    return filas[0] ?? null;
}

// Listado con los nombres de quien la pidió, quien la aprueba y quien la resolvió. Filtros opcionales:
// aprobador (bandeja del jefe), solicitante (las mías), estado y rango de creación (financiera).
async function findListado({ aprobadorUsersCompanyId, solicitanteUsersCompanyId, estado, desde, hasta } = {}, conn = db) {
    const condiciones = [];
    const parametros = [];
    if (aprobadorUsersCompanyId) { condiciones.push('s.aprobador_users_company_id = ?'); parametros.push(aprobadorUsersCompanyId); }
    if (solicitanteUsersCompanyId) { condiciones.push('s.solicitante_users_company_id = ?'); parametros.push(solicitanteUsersCompanyId); }
    if (estado) { condiciones.push('s.estado = ?'); parametros.push(estado); }
    if (desde) { condiciones.push('s.creado_en >= ?'); parametros.push(desde); }
    if (hasta) { condiciones.push('s.creado_en < DATE_ADD(?, INTERVAL 1 DAY)'); parametros.push(hasta); }
    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
    const [filas] = await conn.query(
        `SELECT s.*, ${nombreDe('sol')} AS solicitante, ${nombreDe('apr')} AS aprobador, ${nombreDe('res')} AS resuelto_por
         FROM solicitud_cambio_turno s
         JOIN users_company sol ON sol.id = s.solicitante_users_company_id
         JOIN users_company apr ON apr.id = s.aprobador_users_company_id
         LEFT JOIN users_company res ON res.id = s.resuelto_por_users_company_id
         ${where}
         ORDER BY s.estado = 'pendiente' DESC, s.creado_en DESC
         LIMIT 500`,
        parametros
    );
    return filas;
}

async function findById(id, conn = db) {
    const [filas] = await conn.query(
        `SELECT s.*, ${nombreDe('sol')} AS solicitante, ${nombreDe('apr')} AS aprobador, ${nombreDe('res')} AS resuelto_por
         FROM solicitud_cambio_turno s
         JOIN users_company sol ON sol.id = s.solicitante_users_company_id
         JOIN users_company apr ON apr.id = s.aprobador_users_company_id
         LEFT JOIN users_company res ON res.id = s.resuelto_por_users_company_id
         WHERE s.idsolicitud_cambio_turno = ?`,
        [id]
    );
    return filas[0] ?? null;
}

// Los días de varias solicitudes, con el nombre del empleado, su campaña y centro de costo y el de la
// plantilla nueva. Fecha como 'YYYY-MM-DD' para no depender de la zona del driver.
async function findDias(solicitudIds, conn = db) {
    if (solicitudIds.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT d.*, DATE_FORMAT(d.fecha, '%Y-%m-%d') AS fecha, ${nombreDe('uc')} AS empleado, hp.nombre AS plantilla
         FROM solicitud_cambio_turno_dia d
         JOIN users_company uc ON uc.id = d.users_company_id
         LEFT JOIN horario_plantilla hp ON hp.idhorario_plantilla = d.horario_plantilla_id
         WHERE d.solicitud_id IN (?)
         ORDER BY d.solicitud_id, d.fecha, empleado`,
        [solicitudIds]
    );
    return filas;
}

// (empleado, fecha) que ya están en otra solicitud pendiente: una segunda pisaría a la primera.
async function findPendientesQueChocan(empleadoIds, fechas, conn = db) {
    if (empleadoIds.length === 0 || fechas.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT d.users_company_id, DATE_FORMAT(d.fecha, '%Y-%m-%d') AS fecha, s.idsolicitud_cambio_turno
         FROM solicitud_cambio_turno_dia d
         JOIN solicitud_cambio_turno s ON s.idsolicitud_cambio_turno = d.solicitud_id
         WHERE s.estado = 'pendiente' AND d.users_company_id IN (?) AND d.fecha IN (?)`,
        [empleadoIds, fechas]
    );
    return filas;
}

// Solo resuelve una pendiente; devuelve si la resolvió.
async function resolver(id, { estado, motivoRechazo, comentario, resueltoPorUsersCompanyId, resueltoPor }, conn = db) {
    const [resultado] = await conn.query(
        `UPDATE solicitud_cambio_turno
            SET estado = ?, motivo_rechazo = ?, comentario = ?, resuelto_por_users_company_id = ?,
                resuelto_por_user_id = ?, resuelto_por_cuenta_id = ?, resuelta_en = NOW(3)
          WHERE idsolicitud_cambio_turno = ? AND estado = 'pendiente'`,
        [estado, motivoRechazo ?? null, comentario ?? null, resueltoPorUsersCompanyId, resueltoPor?.userId ?? null, resueltoPor?.cuentaId ?? null, id]
    );
    return resultado.affectedRows > 0;
}

module.exports = { insertar, insertarDias, findByIdParaActualizar, findListado, findById, findDias, findPendientesQueChocan, resolver };
