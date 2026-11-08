const db = require('../../config/db');

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];

// Historial de novedades del equipo (asistencia.md §56). Quién cuelga de quién lo resuelve
// equipoRepository.idsDelArbol: las tres líneas de mando (jefe inmediato, jefe de área, gestor), §57.

// Novedades cuyo contrato tenía como jefe (inmediato, de área o gestor) a alguien del árbol. Se cruza
// por el contrato de la novedad, así que salen también las de quienes ya se retiraron. Sin diagnóstico
// ni documentos: el SELECT nombra solo lo que el jefe puede ver.
async function listarDelArbol({ idsArbol, raizUsersCompanyId, desde, hasta, empleadoId, tipoNovedadId }, conn = db) {
    if (idsArbol.length === 0) return [];
    const condiciones = [
        '(c.jefe_inmediato_id IN (?) OR c.jefe_area_id IN (?) OR c.gestor_asistencia_id IN (?))',
        'c.users_company_id <> ?'
    ];
    const params = [idsArbol, idsArbol, idsArbol, raizUsersCompanyId];
    // Se cruzan con el rango: una incapacidad que empezó antes y sigue dentro del periodo también sale.
    if (desde) {
        condiciones.push('COALESCE(nr.fecha_final, nr.fecha_inicial) >= ?');
        params.push(desde);
    }
    if (hasta) {
        condiciones.push('nr.fecha_inicial <= ?');
        params.push(hasta);
    }
    if (empleadoId) {
        condiciones.push('c.users_company_id = ?');
        params.push(empleadoId);
    }
    if (tipoNovedadId) {
        condiciones.push('nr.tipo_novedad_idtipo_novedad = ?');
        params.push(tipoNovedadId);
    }

    const [filas] = await conn.query(
        `SELECT nr.idnovedad_rrhh, nr.fecha_inicial, nr.fecha_final, nr.fecha_retorno, nr.total_dias,
                nr.origen_incapacidad, nr.accidente_transito, nr.observaciones,
                tn.idtipo_novedad AS tipo_novedad_id, tn.nombre AS tipo_novedad,
                uc.id AS empleado_id, uc.nombre_propio AS empleado_nombre,
                uc.numero_identificacion AS empleado_identificacion,
                car.nombre AS cargo, cam.nombre AS campania, cc.nombre AS centro_costo,
                ji.nombre_propio AS jefe_inmediato,
                (ec.nombre IN (?, ?)) AS contrato_vigente,
                (SELECT COUNT(*) FROM tipo_novedad_soporte tns WHERE tns.tipo_novedad_id = nr.tipo_novedad_idtipo_novedad) AS soportes_requeridos,
                (SELECT COUNT(*) FROM novedad_rrhh_soporte nrs
                   JOIN tipo_novedad_soporte tns ON tns.tipo_soporte_novedad_id = nrs.tipo_soporte_novedad_id
                                                AND tns.tipo_novedad_id = nr.tipo_novedad_idtipo_novedad
                  WHERE nrs.novedad_rrhh_id = nr.idnovedad_rrhh) AS soportes_cargados,
                (SELECT COUNT(*) FROM empleado_archivo ea WHERE ea.novedad_rrhh_id = nr.idnovedad_rrhh) AS documentos_expediente
           FROM novedad_rrhh nr
           JOIN contrato c ON c.idcontrato = nr.contrato_idcontrato
           JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
           JOIN users_company uc ON uc.id = c.users_company_id
           JOIN tipo_novedad tn ON tn.idtipo_novedad = nr.tipo_novedad_idtipo_novedad
           LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
           LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
           LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
           LEFT JOIN users_company ji ON ji.id = c.jefe_inmediato_id
          WHERE ${condiciones.join(' AND ')}
          ORDER BY nr.fecha_inicial DESC, uc.nombre_propio`,
        [...ESTADOS_CONTRATO_ACTIVOS, ...params]
    );
    return filas;
}

module.exports = { listarDelArbol };
