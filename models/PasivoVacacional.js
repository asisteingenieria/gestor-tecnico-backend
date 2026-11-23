const db = require('../config/db');

// Datos para el pasivo vacacional calculado (utils/pasivoVacacional.js, claude/modulo recursoshumanos.md §58).

class PasivoVacacional {
    /**
     * Empleados vigentes en `fecha`: contrato más reciente con ingreso hasta esa fecha y sin retiro a esa fecha
     * (un retirado después de `fecha` sí cuenta, para poder calcular el cierre de un mes pasado).
     * `ids` (opcional): solo esas fichas, para el pasivo del equipo de un jefe (§58.6).
     */
    static async getEmpleados(fecha, ids = null) {
        if (ids && ids.length === 0) return [];
        const [rows] = await db.query(
            `SELECT uc.id AS users_company_id, uc.numero_identificacion,
                    ti.codigo AS tipo_identificacion,
                    CONCAT_WS(' ', uc.primer_apellido, uc.segundo_apellido, uc.primer_nombre, uc.segundo_nombre) AS nombre,
                    car.nombre AS cargo, ar.nombre AS area, cam.nombre AS campania,
                    c.fecha_ingreso, hs.salario,
                    vs.idvacaciones_saldo AS saldo_id, vs.fecha_corte, vs.dias_disfrutados_corte, vs.dias_compensados,
                    vs.origen, vs.nota, vs.ajustado_en
             FROM users_company uc
             JOIN contrato c ON c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = uc.id)
             LEFT JOIN tipo_identificacion ti ON ti.idtipo_identificacion = uc.tipo_identificacion_idtipo_identificacion
             LEFT JOIN estado_contrato esc ON esc.idestado_contrato = c.estado_contrato_idestado_contrato
             LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
             LEFT JOIN area ar ON ar.idarea = c.area_idarea
             LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
             LEFT JOIN retiro r ON r.idretiro = (SELECT MAX(r2.idretiro) FROM retiro r2 WHERE r2.contrato_idcontrato = c.idcontrato)
             LEFT JOIN historial_salarial hs ON hs.idhistorial_salarial = (
                 SELECT MAX(h2.idhistorial_salarial) FROM historial_salarial h2
                  WHERE h2.contrato_idcontrato = c.idcontrato AND h2.fecha_vigencia_fin IS NULL)
             LEFT JOIN vacaciones_saldo vs ON vs.users_company_id = uc.id
             WHERE c.fecha_ingreso IS NOT NULL AND c.fecha_ingreso <= ?
               AND (esc.nombre IS NULL OR esc.nombre NOT IN ('retirado', 'inactivo') OR r.fecha_retiro > ?)
               ${ids ? 'AND uc.id IN (?)' : ''}
             ORDER BY c.fecha_ingreso DESC, uc.primer_apellido, uc.segundo_apellido, uc.primer_nombre`,
            ids ? [fecha, fecha, ids] : [fecha, fecha]
        );
        return rows;
    }

    /** Novedades de tipo Vacaciones de todos los empleados, o solo de `ids`. */
    static async getNovedadesVacaciones(ids = null) {
        if (ids && ids.length === 0) return [];
        const [rows] = await db.query(
            `SELECT c.users_company_id, nr.fecha_inicial, nr.total_dias,
                    nr.modalidad_vacaciones, nr.dias_disfrutados, nr.dias_compensados
             FROM novedad_rrhh nr
             JOIN tipo_novedad tn ON tn.idtipo_novedad = nr.tipo_novedad_idtipo_novedad
             JOIN contrato c ON c.idcontrato = nr.contrato_idcontrato
             WHERE tn.nombre = 'Vacaciones'${ids ? ' AND c.users_company_id IN (?)' : ''}`,
            ids ? [ids] : []
        );
        return rows;
    }

    /** Fecha de corte más reciente de los saldos cargados del Excel (la general, para "con observación"). */
    static async fechaCorteExcel() {
        const [[fila]] = await db.query(
            `SELECT DATE_FORMAT(MAX(fecha_corte), '%Y-%m-%d') AS corte FROM vacaciones_saldo WHERE origen = 'excel'`
        );
        return fila ? fila.corte : null;
    }
}

PasivoVacacional.empleadoExiste = async function empleadoExiste(usersCompanyId) {
    const [[fila]] = await db.query('SELECT id FROM users_company WHERE id = ?', [usersCompanyId]);
    return Boolean(fila);
};

/**
 * Financiera ajusta el saldo inicial de un empleado (§58.2, migración 108): guarda el saldo con origen
 * 'financiera' y deja el antes/después en vacaciones_saldo_ajuste, en una transacción.
 */
PasivoVacacional.ajustarSaldo = async function ajustarSaldo(usersCompanyId, datos, userId) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const [[antes]] = await conn.query(
            `SELECT fecha_corte, dias_disfrutados_corte, dias_compensados
             FROM vacaciones_saldo WHERE users_company_id = ? FOR UPDATE`,
            [usersCompanyId]
        );
        await conn.query(
            `INSERT INTO vacaciones_saldo
                (users_company_id, fecha_corte, dias_disfrutados_corte, dias_compensados, origen, nota, ajustado_por_user_id, ajustado_en)
             VALUES (?, ?, ?, ?, 'financiera', ?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE fecha_corte = VALUES(fecha_corte),
                dias_disfrutados_corte = VALUES(dias_disfrutados_corte),
                dias_compensados = VALUES(dias_compensados),
                origen = 'financiera', nota = VALUES(nota),
                ajustado_por_user_id = VALUES(ajustado_por_user_id), ajustado_en = VALUES(ajustado_en)`,
            [usersCompanyId, datos.fecha_corte, datos.dias_disfrutados, datos.dias_compensados, datos.nota, userId]
        );
        await conn.query(
            `INSERT INTO vacaciones_saldo_ajuste
                (users_company_id, fecha_corte_antes, dias_disfrutados_antes, dias_compensados_antes,
                 fecha_corte, dias_disfrutados, dias_compensados, nota, user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [usersCompanyId, antes ? antes.fecha_corte : null, antes ? antes.dias_disfrutados_corte : null,
                antes ? antes.dias_compensados : null, datos.fecha_corte, datos.dias_disfrutados, datos.dias_compensados,
                datos.nota, userId]
        );
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
};

/** Historial de ajustes de financiera de un empleado, el más reciente primero. */
PasivoVacacional.historialAjustes = async function historialAjustes(usersCompanyId) {
    const [rows] = await db.query(
        `SELECT a.idvacaciones_saldo_ajuste AS id, a.fecha_corte_antes, a.dias_disfrutados_antes, a.dias_compensados_antes,
                a.fecha_corte, a.dias_disfrutados, a.dias_compensados, a.nota, a.created_at,
                COALESCE(u.full_name, u.username) AS usuario
         FROM vacaciones_saldo_ajuste a
         LEFT JOIN users u ON u.id = a.user_id
         WHERE a.users_company_id = ?
         ORDER BY a.created_at DESC, a.idvacaciones_saldo_ajuste DESC`,
        [usersCompanyId]
    );
    return rows;
};

module.exports = PasivoVacacional;
