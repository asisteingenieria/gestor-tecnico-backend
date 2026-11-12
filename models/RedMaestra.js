const db = require('../config/db');
const { CAMPOS_OPCION, tipoPersonal } = require('../utils/redMaestra');

/**
 * Red Maestra (RM) de Claro (claude/modulo recursoshumanos.md §52, migración 101).
 *
 * Quién aparece: los empleados cuyo contrato más reciente es de Claro y está vigente
 * (activo / periodo_prueba), y cualquier empleado que ya tenga datos de RM (ficha o requerimientos),
 * para poder marcar como INACTIVO RM a quien se retiró o cambió de cliente.
 * El cliente es el de la campaña del contrato (o el del contrato si no tiene campaña); se busca por
 * NOMBRE ('CLARO'), no por id, porque los ids de catálogo difieren entre local y producción.
 */
const CLIENTE_RM = 'CLARO';
const ESTADOS_VIGENTES = ['activo', 'periodo_prueba'];

// Contrato más reciente de cada empleado: la misma regla de UserCompany.getJefaturas().
const FROM_EMPLEADO = `
    FROM users_company uc
    JOIN contrato c ON c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = uc.id)
    JOIN estado_contrato esc ON esc.idestado_contrato = c.estado_contrato_idestado_contrato
    LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
    LEFT JOIN cliente cl ON cl.idCliente = COALESCE(cam.Cliente_idCliente, c.Cliente_idCliente)
    LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
    LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
    LEFT JOIN tipo_identificacion ti ON ti.idtipo_identificacion = uc.tipo_identificacion_idtipo_identificacion`;

const ES_CLARO_VIGENTE = `(UPPER(TRIM(cl.nombre)) = ? AND esc.nombre IN (?, ?))`;
const PARAMS_CLARO_VIGENTE = [CLIENTE_RM, ...ESTADOS_VIGENTES];

// Nombre como lo escribe la RM: apellidos y luego nombres.
const NOMBRE_RM = `TRIM(CONCAT_WS(' ', uc.primer_apellido, uc.segundo_apellido, uc.primer_nombre, uc.segundo_nombre))`;

const ULTIMO_REQ = `(SELECT r2.id FROM red_maestra_requerimiento r2 WHERE r2.users_company_id = uc.id
                      ORDER BY r2.fecha_envio IS NULL, r2.fecha_envio DESC, r2.id DESC LIMIT 1)`;

class RedMaestra {
    /** Una fila por empleado con su ficha RM y su último requerimiento. */
    static async listar() {
        const [rows] = await db.query(
            `SELECT
                uc.id,
                uc.numero_identificacion AS cedula,
                ti.codigo AS tipo_documento,
                ${NOMBRE_RM} AS nombre,
                uc.usuario_ssff,
                cam.nombre AS campania,
                cc.nombre AS centro_costo,
                car.nombre AS cargo,
                cl.nombre AS cliente,
                esc.nombre AS estado_contrato,
                ${ES_CLARO_VIGENTE} AS es_claro_vigente,
                rm.id AS rm_id,
                rm.novedades,
                rm.estado_agente_id, oea.valor AS estado_agente,
                rm.cargo_rm_id, ocr.valor AS cargo_rm,
                rm.estado_rm_id, oer.valor AS estado_rm,
                rm.updated_at AS rm_actualizado,
                req.id AS req_id,
                req.numero AS req_numero,
                DATE_FORMAT(req.fecha_envio, '%Y-%m-%d') AS req_fecha_envio,
                oob.valor AS req_observacion,
                oes.valor AS req_estado,
                (SELECT COUNT(*) FROM red_maestra_requerimiento r3 WHERE r3.users_company_id = uc.id) AS total_requerimientos,
                DATE_FORMAT(rt.fecha_retiro, '%Y-%m-%d') AS fecha_retiro,
                DATE_FORMAT(rm.fecha_retiro_rm, '%Y-%m-%d') AS fecha_retiro_rm
             ${FROM_EMPLEADO}
             LEFT JOIN retiro rt ON rt.contrato_idcontrato = c.idcontrato
             LEFT JOIN red_maestra rm ON rm.users_company_id = uc.id
             LEFT JOIN red_maestra_opcion oea ON oea.id = rm.estado_agente_id
             LEFT JOIN red_maestra_opcion ocr ON ocr.id = rm.cargo_rm_id
             LEFT JOIN red_maestra_opcion oer ON oer.id = rm.estado_rm_id
             LEFT JOIN red_maestra_requerimiento req ON req.id = ${ULTIMO_REQ}
             LEFT JOIN red_maestra_opcion oob ON oob.id = req.observacion_id
             LEFT JOIN red_maestra_opcion oes ON oes.id = req.estado_requerimiento_id
             WHERE ${ES_CLARO_VIGENTE}
                OR rm.id IS NOT NULL
                OR req.id IS NOT NULL
             ORDER BY uc.primer_apellido, uc.segundo_apellido, uc.primer_nombre`,
            [...PARAMS_CLARO_VIGENTE, ...PARAMS_CLARO_VIGENTE]
        );
        return rows.map((r) => ({ ...r, es_claro_vigente: Boolean(r.es_claro_vigente), tipo_personal: tipoPersonal(r.cargo) }));
    }

    /** Ficha RM + datos del Gestor de un empleado, o null si no existe. */
    static async getEmpleado(usersCompanyId) {
        const [rows] = await db.query(
            `SELECT
                uc.id, uc.numero_identificacion AS cedula, ti.codigo AS tipo_documento, ti.nombre AS tipo_documento_nombre,
                ${NOMBRE_RM} AS nombre, uc.usuario_ssff,
                cam.nombre AS campania, cc.nombre AS centro_costo, car.nombre AS cargo, cl.nombre AS cliente,
                esc.nombre AS estado_contrato, ${ES_CLARO_VIGENTE} AS es_claro_vigente,
                rm.novedades, rm.estado_agente_id, rm.cargo_rm_id, rm.estado_rm_id, rm.updated_at AS rm_actualizado,
                u.full_name AS rm_actualizado_por,
                DATE_FORMAT(c.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
                DATE_FORMAT(rt.fecha_retiro, '%Y-%m-%d') AS fecha_retiro, tr.nombre AS tipo_retiro,
                DATE_FORMAT(rm.fecha_retiro_rm, '%Y-%m-%d') AS fecha_retiro_rm, rm.retiro_rm_registrado_en,
                COALESCE(rmf.nombre_propio, rmu.full_name) AS retiro_rm_registrado_por
             ${FROM_EMPLEADO}
             LEFT JOIN retiro rt ON rt.contrato_idcontrato = c.idcontrato
             LEFT JOIN tipo_retiro tr ON tr.idtipo_retiro = rt.tipo_retiro_idtipo_retiro
             LEFT JOIN red_maestra rm ON rm.users_company_id = uc.id
             LEFT JOIN users u ON u.id = rm.actualizado_por
             LEFT JOIN users_company rmf ON rmf.id = rm.retiro_rm_por_users_company_id
             LEFT JOIN users rmu ON rmu.id = rm.retiro_rm_por_user_id
             WHERE uc.id = ?`,
            [...PARAMS_CLARO_VIGENTE, usersCompanyId]
        );
        if (!rows[0]) return null;
        return {
            ...rows[0],
            es_claro_vigente: Boolean(rows[0].es_claro_vigente),
            requerimientos: await this.getRequerimientos(usersCompanyId)
        };
    }

    static async getRequerimientos(usersCompanyId) {
        const [rows] = await db.query(
            `SELECT q.id, q.numero, DATE_FORMAT(q.fecha_envio, '%Y-%m-%d') AS fecha_envio,
                    q.observacion_id, oob.valor AS observacion,
                    q.estado_requerimiento_id, oes.valor AS estado_requerimiento,
                    q.created_at, q.updated_at, u.full_name AS creado_por
             FROM red_maestra_requerimiento q
             LEFT JOIN red_maestra_opcion oob ON oob.id = q.observacion_id
             LEFT JOIN red_maestra_opcion oes ON oes.id = q.estado_requerimiento_id
             LEFT JOIN users u ON u.id = q.creado_por
             WHERE q.users_company_id = ?
             ORDER BY q.fecha_envio IS NULL, q.fecha_envio DESC, q.id DESC`,
            [usersCompanyId]
        );
        return rows;
    }

    /** Todos los requerimientos, para la hoja "Requerimientos" de la descarga. */
    static async getTodosRequerimientos() {
        const [rows] = await db.query(
            `SELECT uc.numero_identificacion AS cedula, ${NOMBRE_RM} AS nombre,
                    q.numero, DATE_FORMAT(q.fecha_envio, '%Y-%m-%d') AS fecha_envio,
                    oob.valor AS observacion, oes.valor AS estado_requerimiento
             FROM red_maestra_requerimiento q
             JOIN users_company uc ON uc.id = q.users_company_id
             LEFT JOIN red_maestra_opcion oob ON oob.id = q.observacion_id
             LEFT JOIN red_maestra_opcion oes ON oes.id = q.estado_requerimiento_id
             ORDER BY uc.primer_apellido, uc.primer_nombre, q.fecha_envio DESC, q.id DESC`
        );
        return rows;
    }

    /** Cédula, nombre y si es vigente de Claro de TODOS los empleados (para resolver el cargue). */
    static async getEmpleadosParaCargue() {
        const [rows] = await db.query(
            `SELECT uc.id, uc.numero_identificacion AS cedula, ${NOMBRE_RM} AS nombre,
                    ${ES_CLARO_VIGENTE} AS es_claro_vigente
             ${FROM_EMPLEADO}`,
            PARAMS_CLARO_VIGENTE
        );
        return rows.map((r) => ({ ...r, es_claro_vigente: Boolean(r.es_claro_vigente) }));
    }

    static async existeEmpleado(usersCompanyId) {
        const [rows] = await db.query('SELECT id FROM users_company WHERE id = ?', [usersCompanyId]);
        return rows.length > 0;
    }

    // ── Nuevos ingresos y retiros (§53) ──────────────────────────────────────────────────────

    /**
     * Historial de registros nuevos de RRHH en Claro: fichas creadas entre dos instantes UTC (el controller
     * convierte las fechas de Bogotá), con su estado en la RM y si ya tienen requerimiento.
     */
    static async ingresos({ desdeUtc, hastaUtc }) {
        const [rows] = await db.query(
            `SELECT uc.id, uc.numero_identificacion AS cedula, ti.codigo AS tipo_documento, ${NOMBRE_RM} AS nombre,
                    uc.usuario_ssff, cam.nombre AS campania, cc.nombre AS centro_costo, car.nombre AS cargo,
                    esc.nombre AS estado_contrato, DATE_FORMAT(c.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
                    uc.created_at AS registrado_en,
                    oer.valor AS estado_rm,
                    (SELECT COUNT(*) FROM red_maestra_requerimiento q WHERE q.users_company_id = uc.id) AS total_requerimientos
             ${FROM_EMPLEADO}
             LEFT JOIN red_maestra rm ON rm.users_company_id = uc.id
             LEFT JOIN red_maestra_opcion oer ON oer.id = rm.estado_rm_id
             WHERE UPPER(TRIM(cl.nombre)) = ? AND uc.created_at >= ? AND uc.created_at < ?
             ORDER BY uc.created_at DESC, uc.id DESC`,
            [CLIENTE_RM, desdeUtc, hastaUtc]
        );
        return rows.map((r) => ({ ...r, tipo_personal: tipoPersonal(r.cargo) }));
    }

    /** Retirados de Claro (el retiro es de su contrato más reciente) con su fecha de retiro en la RM. */
    static async retiros({ desde, hasta }) {
        const condiciones = ['UPPER(TRIM(cl.nombre)) = ?', 'esc.nombre = ?'];
        const params = [CLIENTE_RM, 'retirado'];
        if (desde) { condiciones.push('rt.fecha_retiro >= ?'); params.push(desde); }
        if (hasta) { condiciones.push('rt.fecha_retiro <= ?'); params.push(hasta); }
        const [rows] = await db.query(
            `SELECT uc.id, uc.numero_identificacion AS cedula, ti.codigo AS tipo_documento, ${NOMBRE_RM} AS nombre,
                    uc.usuario_ssff, cam.nombre AS campania, cc.nombre AS centro_costo, car.nombre AS cargo,
                    DATE_FORMAT(c.fecha_ingreso, '%Y-%m-%d') AS fecha_ingreso,
                    DATE_FORMAT(rt.fecha_retiro, '%Y-%m-%d') AS fecha_retiro, tr.nombre AS tipo_retiro,
                    ji.nombre_propio AS jefe_inmediato, ja.nombre_propio AS jefe_area,
                    oer.valor AS estado_rm,
                    DATE_FORMAT(rm.fecha_retiro_rm, '%Y-%m-%d') AS fecha_retiro_rm, rm.retiro_rm_registrado_en,
                    COALESCE(rmf.nombre_propio, rmu.full_name) AS retiro_rm_registrado_por
             ${FROM_EMPLEADO}
             JOIN retiro rt ON rt.contrato_idcontrato = c.idcontrato
             LEFT JOIN tipo_retiro tr ON tr.idtipo_retiro = rt.tipo_retiro_idtipo_retiro
             LEFT JOIN users_company ji ON ji.id = c.jefe_inmediato_id
             LEFT JOIN users_company ja ON ja.id = c.jefe_area_id
             LEFT JOIN red_maestra rm ON rm.users_company_id = uc.id
             LEFT JOIN red_maestra_opcion oer ON oer.id = rm.estado_rm_id
             LEFT JOIN users_company rmf ON rmf.id = rm.retiro_rm_por_users_company_id
             LEFT JOIN users rmu ON rmu.id = rm.retiro_rm_por_user_id
             WHERE ${condiciones.join(' AND ')}
             ORDER BY rm.fecha_retiro_rm IS NOT NULL, rt.fecha_retiro DESC, uc.primer_apellido`,
            params
        );
        return rows.map((r) => ({ ...r, tipo_personal: tipoPersonal(r.cargo), pendiente: !r.fecha_retiro_rm }));
    }

    /** Retiro de Claro de su contrato más reciente, o null (para que el admin registre la fecha RM). */
    static async getRetiroClaro(usersCompanyId) {
        const [rows] = await db.query(
            `SELECT uc.id, c.fecha_ingreso, rt.fecha_retiro
             ${FROM_EMPLEADO}
             JOIN retiro rt ON rt.contrato_idcontrato = c.idcontrato
             WHERE uc.id = ? AND UPPER(TRIM(cl.nombre)) = ?`,
            [usersCompanyId, CLIENTE_RM]
        );
        return rows[0] || null;
    }

    /** Fecha del retiro en la RM registrada por el admin (null la borra). */
    static async guardarFechaRetiroRm(usersCompanyId, fecha, userId) {
        await db.query(
            `INSERT INTO red_maestra (users_company_id, fecha_retiro_rm, retiro_rm_por_users_company_id, retiro_rm_por_user_id, retiro_rm_registrado_en)
             VALUES (?, ?, NULL, ?, IF(? IS NULL, NULL, NOW()))
             ON DUPLICATE KEY UPDATE
                fecha_retiro_rm = VALUES(fecha_retiro_rm),
                retiro_rm_por_users_company_id = NULL,
                retiro_rm_por_user_id = VALUES(retiro_rm_por_user_id),
                retiro_rm_registrado_en = VALUES(retiro_rm_registrado_en)`,
            [usersCompanyId, fecha, fecha ? userId : null, fecha]
        );
    }

    // ── Listas ────────────────────────────────────────────────────────────────────────────────

    static async getOpciones({ soloActivas = false } = {}) {
        const [rows] = await db.query(
            `SELECT o.id, o.campo, o.valor, o.orden, o.activo,
                    (SELECT COUNT(*) FROM red_maestra r WHERE r.estado_agente_id = o.id OR r.cargo_rm_id = o.id OR r.estado_rm_id = o.id)
                  + (SELECT COUNT(*) FROM red_maestra_requerimiento q WHERE q.observacion_id = o.id OR q.estado_requerimiento_id = o.id) AS usos
             FROM red_maestra_opcion o
             ${soloActivas ? 'WHERE o.activo = 1' : ''}
             ORDER BY o.campo, o.orden, o.valor`
        );
        return rows.map((o) => ({ ...o, activo: Boolean(o.activo) }));
    }

    static async getOpcion(id) {
        const [rows] = await db.query('SELECT id, campo, valor, orden, activo FROM red_maestra_opcion WHERE id = ?', [id]);
        return rows[0] || null;
    }

    static async buscarOpcionPorValor(campo, valor, excluirId = null) {
        const [rows] = await db.query(
            `SELECT id FROM red_maestra_opcion WHERE campo = ? AND UPPER(TRIM(valor)) = UPPER(TRIM(?))
             ${excluirId ? 'AND id <> ?' : ''}`,
            excluirId ? [campo, valor, excluirId] : [campo, valor]
        );
        return rows[0] || null;
    }

    static async crearOpcion({ campo, valor }, conn = db) {
        const [[{ siguiente }]] = await conn.query(
            'SELECT COALESCE(MAX(orden), 0) + 1 AS siguiente FROM red_maestra_opcion WHERE campo = ?',
            [campo]
        );
        const [res] = await conn.query(
            'INSERT INTO red_maestra_opcion (campo, valor, orden) VALUES (?, ?, ?)',
            [campo, valor, siguiente]
        );
        return res.insertId;
    }

    static async actualizarOpcion(id, { valor, activo }) {
        const sets = [];
        const params = [];
        if (valor !== undefined) { sets.push('valor = ?'); params.push(valor); }
        if (activo !== undefined) { sets.push('activo = ?'); params.push(activo ? 1 : 0); }
        if (!sets.length) return;
        await db.query(`UPDATE red_maestra_opcion SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    }

    /**
     * Comprueba que cada id de lista pertenezca a su campo. Devuelve el primer campo inválido o null.
     * @param valores { campo: id|null }
     */
    static async validarOpciones(valores) {
        const pares = Object.entries(valores).filter(([, id]) => id !== null && id !== undefined);
        if (!pares.length) return null;
        const [rows] = await db.query(
            'SELECT id, campo FROM red_maestra_opcion WHERE id IN (?)',
            [pares.map(([, id]) => id)]
        );
        const campoDe = new Map(rows.map((r) => [r.id, r.campo]));
        const invalido = pares.find(([campo, id]) => campoDe.get(Number(id)) !== campo);
        return invalido ? invalido[0] : null;
    }

    // ── Ficha y requerimientos ───────────────────────────────────────────────────────────────

    /** Guarda la ficha RM tal cual (un campo vacío se borra). */
    static async guardarFicha(usersCompanyId, data, userId) {
        await db.query(
            `INSERT INTO red_maestra (users_company_id, novedades, estado_agente_id, cargo_rm_id, estado_rm_id, actualizado_por)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE novedades = VALUES(novedades), estado_agente_id = VALUES(estado_agente_id),
                cargo_rm_id = VALUES(cargo_rm_id), estado_rm_id = VALUES(estado_rm_id), actualizado_por = VALUES(actualizado_por)`,
            [usersCompanyId, data.novedades, data.estado_agente_id, data.cargo_rm_id, data.estado_rm_id, userId]
        );
    }

    static async getRequerimiento(id) {
        const [rows] = await db.query('SELECT * FROM red_maestra_requerimiento WHERE id = ?', [id]);
        return rows[0] || null;
    }

    static async buscarRequerimiento(usersCompanyId, numero, excluirId = null) {
        const [rows] = await db.query(
            `SELECT id FROM red_maestra_requerimiento WHERE users_company_id = ? AND numero = ?
             ${excluirId ? 'AND id <> ?' : ''}`,
            excluirId ? [usersCompanyId, numero, excluirId] : [usersCompanyId, numero]
        );
        return rows[0] || null;
    }

    static async crearRequerimiento(usersCompanyId, data, userId) {
        const [res] = await db.query(
            `INSERT INTO red_maestra_requerimiento
                (users_company_id, numero, fecha_envio, observacion_id, estado_requerimiento_id, creado_por)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [usersCompanyId, data.numero, data.fecha_envio, data.observacion_id, data.estado_requerimiento_id, userId]
        );
        return res.insertId;
    }

    static async actualizarRequerimiento(id, data) {
        await db.query(
            `UPDATE red_maestra_requerimiento
             SET numero = ?, fecha_envio = ?, observacion_id = ?, estado_requerimiento_id = ?
             WHERE id = ?`,
            [data.numero, data.fecha_envio, data.observacion_id, data.estado_requerimiento_id, id]
        );
    }

    static async eliminarRequerimiento(id) {
        await db.query('DELETE FROM red_maestra_requerimiento WHERE id = ?', [id]);
    }

    // ── Cargue masivo ────────────────────────────────────────────────────────────────────────

    /**
     * Aplica las filas resueltas (utils/redMaestra.resolverFilas) en una sola transacción.
     * Una celda vacía NO borra lo que ya hay: el cargue solo agrega o reemplaza.
     * Los valores que no existían en las listas se crean primero.
     */
    static async aplicarCargue(filas, opcionesNuevas, userId) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const idNuevo = new Map(); // campo|VALOR → id
            for (const o of opcionesNuevas) {
                const [existe] = await conn.query(
                    'SELECT id FROM red_maestra_opcion WHERE campo = ? AND UPPER(TRIM(valor)) = UPPER(TRIM(?))',
                    [o.campo, o.valor]
                );
                idNuevo.set(`${o.campo}|${o.valor}`, existe[0] ? existe[0].id : await this.crearOpcion(o, conn));
            }
            const idDe = (campo, ref) => {
                if (!ref) return null;
                return ref.id ?? idNuevo.get(`${campo}|${ref.nuevo}`) ?? null;
            };

            let fichas = 0;
            let requerimientos = 0;
            for (const f of filas) {
                const ficha = [f.novedades, idDe('estado_agente', f.ids.estado_agente), idDe('cargo_rm', f.ids.cargo_rm), idDe('estado_rm', f.ids.estado_rm)];
                if (ficha.some((v) => v !== null)) {
                    await conn.query(
                        `INSERT INTO red_maestra (users_company_id, novedades, estado_agente_id, cargo_rm_id, estado_rm_id, actualizado_por)
                         VALUES (?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            novedades = COALESCE(VALUES(novedades), novedades),
                            estado_agente_id = COALESCE(VALUES(estado_agente_id), estado_agente_id),
                            cargo_rm_id = COALESCE(VALUES(cargo_rm_id), cargo_rm_id),
                            estado_rm_id = COALESCE(VALUES(estado_rm_id), estado_rm_id),
                            actualizado_por = VALUES(actualizado_por)`,
                        [f.users_company_id, ...ficha, userId]
                    );
                    fichas++;
                }
                if (f.requerimiento) {
                    await conn.query(
                        `INSERT INTO red_maestra_requerimiento
                            (users_company_id, numero, fecha_envio, observacion_id, estado_requerimiento_id, creado_por)
                         VALUES (?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            fecha_envio = COALESCE(VALUES(fecha_envio), fecha_envio),
                            observacion_id = COALESCE(VALUES(observacion_id), observacion_id),
                            estado_requerimiento_id = COALESCE(VALUES(estado_requerimiento_id), estado_requerimiento_id)`,
                        [f.users_company_id, f.requerimiento, f.fecha_envio,
                            idDe('observacion', f.ids.observacion), idDe('estado_requerimiento', f.ids.estado_requerimiento), userId]
                    );
                    requerimientos++;
                }
            }

            await conn.commit();
            return { fichas, requerimientos, opciones_creadas: opcionesNuevas.length };
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

RedMaestra.CAMPOS_OPCION = CAMPOS_OPCION;

module.exports = RedMaestra;
