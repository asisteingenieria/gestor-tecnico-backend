const db = require('../../config/db');

// Agregados mensuales de asistencia por empleado, con su campaña (asistencia.md §35, vista de
// financiera). Una sola consulta agregada (no un recorrido por empleado) para toda la organización
// o una campaña. Los días pasados ya los cierra el cron diario, así que aquí no se normaliza.

const NOMBRE = "TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido))";
const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];
const TRABAJADO = "j.estado IN ('en_curso', 'en_pausa', 'finalizada')";

// Contrato activo más reciente del dueño de la jornada (de ahí campaña y cargo). Estado por nombre,
// sin depender del collation.
const CONTRATO_ACTIVO = `c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                          JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                         WHERE c2.users_company_id = j.users_company_id AND ec2.nombre IN (?, ?))`;

/** Una fila por empleado con los totales del mes y su campaña. `campaniaId` opcional (null = todas). */
async function agregadosPorEmpleado({ campaniaId = null, desde, hasta }, conn = db) {
    const condiciones = ['j.fecha BETWEEN ? AND ?'];
    const parametros = [...ESTADOS_CONTRATO_ACTIVOS, desde, hasta];
    if (campaniaId != null) {
        condiciones.push('c.campania_idcampania = ?');
        parametros.push(campaniaId);
    }

    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id,
                uc.numero_identificacion AS documento,
                ${NOMBRE} AS nombre,
                cam.idcampania,
                cam.nombre AS campania,
                car.nombre AS cargo,
                SUM(${TRABAJADO}) AS dias_trabajados,
                SUM(${TRABAJADO} AND j.minutos_tarde = 0) AS dias_puntuales,
                SUM(${TRABAJADO} AND j.minutos_tarde > 0) AS dias_tarde,
                SUM(j.estado = 'ausente') AS ausencias,
                SUM(j.minutos_trabajados) AS minutos_trabajados,
                SUM(j.minutos_tarde) AS minutos_tarde,
                SUM(j.minutos_extra) AS minutos_extra,
                SUM(j.minutos_pausa_bano) AS minutos_bano,
                SUM(j.minutos_break) AS minutos_break,
                SUM(j.minutos_pausa_almuerzo) AS minutos_almuerzo,
                SUM(j.minutos_capacitacion) AS minutos_capacitacion,
                SUM(j.minutos_salida_anticipada) AS minutos_salida_anticipada
         FROM jornada j
         JOIN users_company uc ON uc.id = j.users_company_id
         JOIN contrato c ON ${CONTRATO_ACTIVO}
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         WHERE ${condiciones.join(' AND ')}
         GROUP BY uc.id, uc.numero_identificacion, nombre, cam.idcampania, cam.nombre, car.nombre
         ORDER BY cam.nombre, nombre`,
        parametros
    );

    const CAMPOS = ['dias_trabajados', 'dias_puntuales', 'dias_tarde', 'ausencias', 'minutos_trabajados',
        'minutos_tarde', 'minutos_extra', 'minutos_bano', 'minutos_break', 'minutos_almuerzo',
        'minutos_capacitacion', 'minutos_salida_anticipada'];
    return filas.map((f) => {
        const fila = {
            users_company_id: f.users_company_id,
            documento: f.documento,
            nombre: f.nombre,
            idcampania: f.idcampania,
            campania: f.campania,
            cargo: f.cargo
        };
        for (const c of CAMPOS) fila[c] = Number(f[c]) || 0;
        fila.porcentaje_puntualidad = fila.dias_trabajados > 0
            ? Math.round((fila.dias_puntuales / fila.dias_trabajados) * 100)
            : null;
        return fila;
    });
}

/** Jornadas día a día de una campaña (para la grilla del calendario cuando se abre una campaña). */
async function jornadasDiaPorCampania({ campaniaId, desde, hasta }, conn = db) {
    const [filas] = await conn.query(
        `SELECT j.users_company_id,
                DATE_FORMAT(j.fecha, '%Y-%m-%d') AS fecha,
                j.estado, j.minutos_tarde, j.minutos_trabajados, j.minutos_extra
         FROM jornada j
         JOIN contrato c ON ${CONTRATO_ACTIVO}
         WHERE j.fecha BETWEEN ? AND ? AND c.campania_idcampania = ?
         ORDER BY j.users_company_id, j.fecha`,
        [...ESTADOS_CONTRATO_ACTIVOS, desde, hasta, campaniaId]
    );
    return filas.map((f) => ({
        users_company_id: f.users_company_id,
        fecha: f.fecha,
        estado: f.estado,
        minutos_tarde: Number(f.minutos_tarde) || 0,
        minutos_trabajados: Number(f.minutos_trabajados) || 0,
        minutos_extra: Number(f.minutos_extra) || 0
    }));
}

module.exports = { agregadosPorEmpleado, jornadasDiaPorCampania };
