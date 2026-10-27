const db = require('../../config/db');

// Reporte mensual de horas extras calculado en vivo desde `hora_extra` (asistencia.md §32). No hay
// tablas de reporte: se agregan las horas aprobadas del mes por empleado y clase. El salario sale
// del historial salarial vigente (para que financiera calcule el dinero). Todo parametrizado.

const NOMBRE = "TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido))";
const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];

// Contrato activo más reciente del empleado dueño de la hora extra (de ahí salen campaña, cargo,
// centro de costo y el jefe de área). Comparar el estado por nombre, sin depender del collation.
const CONTRATO_HE = `c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                      JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                     WHERE c2.users_company_id = he.users_company_id AND ec2.nombre IN (?, ?))`;

// Salario mensual vigente del contrato (el renglón sin fecha de fin, el más reciente).
const SALARIO_VIGENTE = `(SELECT hs.salario FROM historial_salarial hs
                          WHERE hs.contrato_idcontrato = c.idcontrato AND hs.fecha_vigencia_fin IS NULL
                          ORDER BY hs.idhistorial_salarial DESC LIMIT 1)`;

// Los minutos por clase salen de los tramos (una hora extra puede repartirse en varias clases,
// migración 074). El LEFT JOIN multiplica la hora extra por sus tramos; el SUM los recompone.
const sumaClase = (clase) => `SUM(CASE WHEN het.clase = '${clase}' THEN het.minutos ELSE 0 END)`;

/**
 * Horas extra aprobadas del mes, una fila por empleado con los minutos sumados por clase, sus datos
 * y el salario vigente. `jefeId` limita al equipo de un jefe de área; `campaniaId` filtra por
 * campaña (ambos opcionales: financiera los omite para ver a todos).
 */
async function reporteDelMes({ jefeId = null, campaniaId = null, desde, hasta }, conn = db) {
    const condiciones = ["he.estado = 'aprobada'", 'he.fecha BETWEEN ? AND ?'];
    const parametros = [...ESTADOS_CONTRATO_ACTIVOS, desde, hasta];
    if (jefeId != null) {
        // El equipo que gestiona (082, §44): el mismo de "Equipo hoy" y de los horarios.
        condiciones.push('COALESCE(c.gestor_asistencia_id, c.jefe_area_id) = ?');
        parametros.push(jefeId);
    }
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
                cc.nombre AS centro_costo,
                car.nombre AS cargo,
                ${SALARIO_VIGENTE} AS salario,
                ${sumaClase('recargo_nocturno')} AS recargo_nocturno,
                ${sumaClase('extras_diurnas')} AS extras_diurnas,
                ${sumaClase('extras_nocturnas')} AS extras_nocturnas,
                ${sumaClase('dominicales_festivas')} AS dominicales_festivas,
                ${sumaClase('extras_dominicales_festivas')} AS extras_dominicales_festivas,
                GROUP_CONCAT(DISTINCT NULLIF(TRIM(he.motivo), '') ORDER BY he.fecha SEPARATOR ' | ') AS aclaraciones
         FROM hora_extra he
         LEFT JOIN hora_extra_tramo het ON het.idhora_extra = he.idhora_extra
         JOIN users_company uc ON uc.id = he.users_company_id
         JOIN contrato c ON ${CONTRATO_HE}
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         WHERE ${condiciones.join(' AND ')}
         GROUP BY uc.id, uc.numero_identificacion, nombre, cam.idcampania, cam.nombre, cc.nombre, car.nombre, salario
         ORDER BY cam.nombre, nombre`,
        parametros
    );
    // Los minutos por clase vienen como minutos (enteros); el dominio los pasa a horas.
    return filas.map((f) => ({
        users_company_id: f.users_company_id,
        documento: f.documento,
        nombre: f.nombre,
        idcampania: f.idcampania,
        campania: f.campania,
        centro_costo: f.centro_costo,
        cargo: f.cargo,
        salario: f.salario != null ? Number(f.salario) : null,
        minutos: {
            recargo_nocturno: Number(f.recargo_nocturno) || 0,
            extras_diurnas: Number(f.extras_diurnas) || 0,
            extras_nocturnas: Number(f.extras_nocturnas) || 0,
            dominicales_festivas: Number(f.dominicales_festivas) || 0,
            extras_dominicales_festivas: Number(f.extras_dominicales_festivas) || 0
        },
        aclaraciones: f.aclaraciones || null
    }));
}

module.exports = { reporteDelMes };
