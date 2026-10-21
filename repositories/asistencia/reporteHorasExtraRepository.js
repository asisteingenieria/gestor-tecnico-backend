const db = require('../../config/db');

// Reporte mensual de horas extras de cada jefe de área a financiera (migración 072,
// asistencia.md §32). Los instantes se ponen en la BD con UTC_TIMESTAMP().

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];
const CLASES = ['recargo_nocturno', 'extras_diurnas', 'extras_nocturnas', 'dominicales_festivas', 'extras_dominicales_festivas'];
const NOMBRE = "TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido))";

async function findPorJefeYPeriodo(jefeUsersCompanyId, periodo, conn = db) {
    const [rows] = await conn.query(
        'SELECT * FROM reporte_horas_extra WHERE jefe_users_company_id = ? AND periodo = ?',
        [jefeUsersCompanyId, periodo]
    );
    return rows[0] ?? null;
}

/** Bloquea el reporte (si existe) para guardarlo o enviarlo sin carreras. */
async function findPorJefeYPeriodoParaActualizar(jefeUsersCompanyId, periodo, conn) {
    const [rows] = await conn.query(
        'SELECT * FROM reporte_horas_extra WHERE jefe_users_company_id = ? AND periodo = ? FOR UPDATE',
        [jefeUsersCompanyId, periodo]
    );
    return rows[0] ?? null;
}

async function findById(id, conn = db) {
    const [rows] = await conn.query(
        `SELECT r.*, ${NOMBRE} AS jefe_nombre, uc.numero_identificacion AS jefe_documento,
                p.fecha_limite
           FROM reporte_horas_extra r
           JOIN users_company uc ON uc.id = r.jefe_users_company_id
           LEFT JOIN periodo_horas_extra p ON p.periodo = r.periodo
          WHERE r.idreporte_horas_extra = ?`,
        [id]
    );
    return rows[0] ?? null;
}

async function findByIdParaActualizar(id, conn) {
    const [rows] = await conn.query('SELECT * FROM reporte_horas_extra WHERE idreporte_horas_extra = ? FOR UPDATE', [id]);
    return rows[0] ?? null;
}

async function findDetalle(reporteId, conn = db) {
    const [rows] = await conn.query(
        `SELECT users_company_id, documento, nombre, campania, centro_costo, cargo, minutos_aprobados,
                ${CLASES.join(', ')}, aclaraciones
           FROM reporte_horas_extra_detalle
          WHERE reporte_id = ?
          ORDER BY nombre`,
        [reporteId]
    );
    // DECIMAL llega como texto desde mysql2.
    return rows.map((r) => {
        const fila = { ...r };
        for (const c of CLASES) fila[c] = Number(r[c]);
        return fila;
    });
}

async function crear({ periodo, jefeUsersCompanyId }, conn = db) {
    const [r] = await conn.query(
        'INSERT INTO reporte_horas_extra (periodo, jefe_users_company_id) VALUES (?, ?)',
        [periodo, jefeUsersCompanyId]
    );
    return r.insertId;
}

/** Reemplaza todas las filas del reporte (dentro de la transacción de quien llama). */
async function reemplazarDetalle(reporteId, filas, conn) {
    await conn.query('DELETE FROM reporte_horas_extra_detalle WHERE reporte_id = ?', [reporteId]);
    if (filas.length === 0) return;
    const columnas = ['reporte_id', 'users_company_id', 'documento', 'nombre', 'campania', 'centro_costo', 'cargo', 'minutos_aprobados', ...CLASES, 'aclaraciones'];
    const valores = filas.map((f) => [
        reporteId, f.users_company_id, f.documento, f.nombre, f.campania, f.centro_costo, f.cargo, f.minutos_aprobados,
        ...CLASES.map((c) => f[c]), f.aclaraciones
    ]);
    await conn.query(`INSERT INTO reporte_horas_extra_detalle (${columnas.join(', ')}) VALUES ?`, [valores]);
}

/** Un borrador o un reporte devuelto pasa a enviado; devuelve si cambió. */
async function marcarEnviado(id, enviadoPor, conn) {
    const [r] = await conn.query(
        `UPDATE reporte_horas_extra
            SET estado = 'enviado', enviado_en = UTC_TIMESTAMP(), veces_enviado = veces_enviado + 1,
                enviado_por_user_id = ?, enviado_por_cuenta_id = ?
          WHERE idreporte_horas_extra = ? AND estado IN ('borrador', 'devuelto')`,
        [enviadoPor?.userId ?? null, enviadoPor?.cuentaId ?? null, id]
    );
    return r.affectedRows > 0;
}

/** Aprueba o devuelve un reporte enviado; devuelve si cambió. */
async function revisar(id, { estado, observacion, revisadoPorUserId }, conn = db) {
    const [r] = await conn.query(
        `UPDATE reporte_horas_extra
            SET estado = ?, observacion_financiera = ?, revisado_en = UTC_TIMESTAMP(), revisado_por_user_id = ?
          WHERE idreporte_horas_extra = ? AND estado = 'enviado'`,
        [estado, observacion ?? null, revisadoPorUserId ?? null, id]
    );
    return r.affectedRows > 0;
}

/** Reportes del mes con sus totales por clase (para la bandeja de financiera). */
async function listarDelPeriodo(periodo, conn = db) {
    const [rows] = await conn.query(
        `SELECT r.idreporte_horas_extra, r.periodo, r.jefe_users_company_id, r.estado, r.enviado_en, r.veces_enviado,
                r.revisado_en, r.observacion_financiera,
                ${NOMBRE} AS jefe_nombre, uc.numero_identificacion AS jefe_documento,
                COUNT(d.idreporte_horas_extra_detalle) AS empleados,
                ${CLASES.map((c) => `COALESCE(SUM(d.${c}), 0) AS ${c}`).join(', ')}
           FROM reporte_horas_extra r
           JOIN users_company uc ON uc.id = r.jefe_users_company_id
           LEFT JOIN reporte_horas_extra_detalle d ON d.reporte_id = r.idreporte_horas_extra
          WHERE r.periodo = ?
          GROUP BY r.idreporte_horas_extra
          ORDER BY jefe_nombre`,
        [periodo]
    );
    return rows.map((r) => {
        const fila = { ...r, empleados: Number(r.empleados) };
        for (const c of CLASES) fila[c] = Number(r[c]);
        return fila;
    });
}

/** Todas las fichas que hoy son jefe de área de algún contrato activo, con el tamaño de su equipo. */
async function findJefesDeArea(conn = db) {
    const [rows] = await conn.query(
        `SELECT uc.id AS jefe_users_company_id, ${NOMBRE} AS jefe_nombre, uc.numero_identificacion AS jefe_documento,
                COUNT(DISTINCT c.users_company_id) AS personas_a_cargo
           FROM contrato c
           JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
           JOIN users_company uc ON uc.id = c.jefe_area_id
          WHERE ec.nombre IN (?, ?)
          GROUP BY uc.id
          ORDER BY jefe_nombre`,
        ESTADOS_CONTRATO_ACTIVOS
    );
    return rows.map((r) => ({ ...r, personas_a_cargo: Number(r.personas_a_cargo) }));
}

/** Estado de los reportes de un jefe en varios meses (para la campana). */
async function findEstadosDeJefe(jefeUsersCompanyId, periodos, conn = db) {
    if (periodos.length === 0) return {};
    const [rows] = await conn.query(
        'SELECT periodo, estado, observacion_financiera FROM reporte_horas_extra WHERE jefe_users_company_id = ? AND periodo IN (?)',
        [jefeUsersCompanyId, periodos]
    );
    return Object.fromEntries(rows.map((r) => [r.periodo, r]));
}

async function findDevueltosDeJefe(jefeUsersCompanyId, conn = db) {
    const [rows] = await conn.query(
        `SELECT periodo, revisado_en, observacion_financiera FROM reporte_horas_extra
          WHERE jefe_users_company_id = ? AND estado = 'devuelto' ORDER BY periodo DESC`,
        [jefeUsersCompanyId]
    );
    return rows;
}

module.exports = {
    findDevueltosDeJefe,
    findPorJefeYPeriodo,
    findPorJefeYPeriodoParaActualizar,
    findById,
    findByIdParaActualizar,
    findDetalle,
    crear,
    reemplazarDetalle,
    marcarEnviado,
    revisar,
    listarDelPeriodo,
    findJefesDeArea,
    findEstadosDeJefe
};
