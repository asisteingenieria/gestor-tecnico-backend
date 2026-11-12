const db = require('../../config/db');

// Retiros del equipo para la Red Maestra de Claro (asistencia.md §59, migración 102).
// Quién cuelga de quién lo resuelve equipoRepository.idsDelArbol (tres líneas de mando, §57). Como en las
// novedades del equipo (§56), se cruza por el CONTRATO RETIRADO: el retirado ya no está en el árbol.

// Solo Claro (la Red Maestra es de Claro), por nombre del cliente: los ids difieren entre local y producción.
const CLIENTE_RM = 'CLARO';

const FROM_RETIRO = `
    FROM retiro r
    JOIN contrato c ON c.idcontrato = r.contrato_idcontrato
    JOIN users_company uc ON uc.id = c.users_company_id
    LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
    LEFT JOIN cliente cl ON cl.idCliente = COALESCE(cam.Cliente_idCliente, c.Cliente_idCliente)`;

// El retiro es del contrato más reciente: si lo recontrataron, ese retiro ya no le toca a la Red Maestra.
const ES_RETIRO_VIGENTE_CLARO = `UPPER(TRIM(cl.nombre)) = ?
    AND c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = c.users_company_id)`;

// Contratos retirados que tenían como jefe (inmediato, de área o gestor) a alguien del árbol.
const DEL_ARBOL = '(c.jefe_inmediato_id IN (?) OR c.jefe_area_id IN (?) OR c.gestor_asistencia_id IN (?)) AND c.users_company_id <> ?';

async function listarDelArbol({ idsArbol, raizUsersCompanyId, soloPendientes = false }, conn = db) {
    if (idsArbol.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT uc.id AS empleado_id, uc.nombre_propio AS empleado_nombre, uc.numero_identificacion AS empleado_identificacion,
                car.nombre AS cargo, cam.nombre AS campania, cc.nombre AS centro_costo, ji.nombre_propio AS jefe_inmediato,
                c.fecha_ingreso, r.fecha_retiro, tr.nombre AS tipo_retiro,
                oer.valor AS estado_rm, rm.fecha_retiro_rm, rm.retiro_rm_registrado_en,
                rmf.nombre_propio AS retiro_rm_por_ficha, rmu.full_name AS retiro_rm_por_usuario
         ${FROM_RETIRO}
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN users_company ji ON ji.id = c.jefe_inmediato_id
         LEFT JOIN tipo_retiro tr ON tr.idtipo_retiro = r.tipo_retiro_idtipo_retiro
         LEFT JOIN red_maestra rm ON rm.users_company_id = uc.id
         LEFT JOIN red_maestra_opcion oer ON oer.id = rm.estado_rm_id
         LEFT JOIN users_company rmf ON rmf.id = rm.retiro_rm_por_users_company_id
         LEFT JOIN users rmu ON rmu.id = rm.retiro_rm_por_user_id
         WHERE ${DEL_ARBOL} AND ${ES_RETIRO_VIGENTE_CLARO}
           ${soloPendientes ? 'AND rm.fecha_retiro_rm IS NULL' : ''}
         ORDER BY rm.fecha_retiro_rm IS NOT NULL, r.fecha_retiro DESC, uc.nombre_propio`,
        [idsArbol, idsArbol, idsArbol, raizUsersCompanyId, CLIENTE_RM]
    );
    return filas;
}

async function contarPendientesDelArbol({ idsArbol, raizUsersCompanyId }, conn = db) {
    if (idsArbol.length === 0) return 0;
    const [[fila]] = await conn.query(
        `SELECT COUNT(*) AS total
         ${FROM_RETIRO}
         LEFT JOIN red_maestra rm ON rm.users_company_id = uc.id
         WHERE ${DEL_ARBOL} AND ${ES_RETIRO_VIGENTE_CLARO} AND rm.fecha_retiro_rm IS NULL`,
        [idsArbol, idsArbol, idsArbol, raizUsersCompanyId, CLIENTE_RM]
    );
    return Number(fila.total);
}

// El retiro de Claro de este empleado si cuelga del árbol (para autorizar la escritura), o null.
async function retiroDelArbol({ idsArbol, raizUsersCompanyId, empleadoId }, conn = db) {
    if (idsArbol.length === 0) return null;
    const [filas] = await conn.query(
        `SELECT uc.id AS empleado_id, c.fecha_ingreso, r.fecha_retiro
         ${FROM_RETIRO}
         WHERE ${DEL_ARBOL} AND ${ES_RETIRO_VIGENTE_CLARO} AND uc.id = ?
         LIMIT 1`,
        [idsArbol, idsArbol, idsArbol, raizUsersCompanyId, CLIENTE_RM, empleadoId]
    );
    return filas[0] || null;
}

// Fecha del retiro en la Red Maestra (NULL la borra). Quién la registró: la ficha del jefe o el usuario.
async function guardarFechaRetiroRm({ empleadoId, fecha, porUsersCompanyId = null, porUserId = null }, conn = db) {
    await conn.query(
        `INSERT INTO red_maestra (users_company_id, fecha_retiro_rm, retiro_rm_por_users_company_id, retiro_rm_por_user_id, retiro_rm_registrado_en)
         VALUES (?, ?, ?, ?, IF(? IS NULL, NULL, NOW()))
         ON DUPLICATE KEY UPDATE
            fecha_retiro_rm = VALUES(fecha_retiro_rm),
            retiro_rm_por_users_company_id = VALUES(retiro_rm_por_users_company_id),
            retiro_rm_por_user_id = VALUES(retiro_rm_por_user_id),
            retiro_rm_registrado_en = VALUES(retiro_rm_registrado_en)`,
        [empleadoId, fecha, fecha ? porUsersCompanyId : null, fecha ? porUserId : null, fecha]
    );
}

// Datos del contrato recién retirado para avisar a sus jefes, o null si no es un retiro de Claro.
async function contratoRetiradoParaAviso(empleadoId, conn = db) {
    const [filas] = await conn.query(
        `SELECT uc.id AS empleado_id, uc.nombre_propio AS nombre, r.fecha_retiro,
                c.jefe_inmediato_id, c.jefe_area_id, c.gestor_asistencia_id
         ${FROM_RETIRO}
         WHERE uc.id = ? AND ${ES_RETIRO_VIGENTE_CLARO}
         LIMIT 1`,
        [empleadoId, CLIENTE_RM]
    );
    return filas[0] || null;
}

module.exports = { listarDelArbol, contarPendientesDelArbol, retiroDelArbol, guardarFechaRetiroRm, contratoRetiradoParaAviso };
