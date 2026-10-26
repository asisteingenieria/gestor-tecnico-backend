const db = require('../../config/db');

// Indicadores de RRHH para el Home de financiera (asistencia.md §37): nómina vigente por campaña,
// ingresos y retiros por mes, y novedades por tipo. Solo lectura.

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];

// Contrato activo más reciente de cada ficha (mismo criterio que empleadoRepository).
const CONTRATO_ACTIVO = `c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                          JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                         WHERE c2.users_company_id = c.users_company_id AND ec2.nombre IN (?, ?))`;

/**
 * Nómina mensual vigente por campaña: salario básico y bonos (no prestacional + cafetería) del
 * registro salarial abierto de cada contrato activo. Los empleados sin salario cuentan en
 * `empleados` pero no suman pesos (`sin_salario` los cuenta).
 */
async function nominaPorCampania(conn = db) {
    const [filas] = await conn.query(
        `SELECT cam.idcampania, COALESCE(cam.nombre, 'Sin campaña') AS campania,
                COUNT(DISTINCT c.users_company_id) AS empleados,
                COALESCE(SUM(hs.salario), 0) AS salarios,
                COALESCE(SUM(COALESCE(hs.bono_no_prestacional, 0) + COALESCE(hs.bono_cafeteria, 0)), 0) AS bonos,
                SUM(hs.idhistorial_salarial IS NULL) AS sin_salario
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN historial_salarial hs ON hs.idhistorial_salarial = (
              SELECT MAX(h2.idhistorial_salarial) FROM historial_salarial h2
               WHERE h2.contrato_idcontrato = c.idcontrato AND h2.fecha_vigencia_fin IS NULL)
         WHERE ec.nombre IN (?, ?) AND ${CONTRATO_ACTIVO}
         GROUP BY cam.idcampania, cam.nombre`,
        [...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.map((f) => ({
        idcampania: f.idcampania,
        campania: f.campania,
        empleados: Number(f.empleados),
        salarios: Number(f.salarios),
        bonos: Number(f.bonos),
        sin_salario: Number(f.sin_salario)
    }));
}

/** Ingresos (por `contrato.fecha_ingreso`) por mes 'YYYY-MM' entre dos fechas. */
async function ingresosPorMes({ desde, hasta }, conn = db) {
    const [filas] = await conn.query(
        `SELECT DATE_FORMAT(c.fecha_ingreso, '%Y-%m') AS periodo, COUNT(DISTINCT c.users_company_id) AS cantidad
         FROM contrato c
         WHERE c.fecha_ingreso BETWEEN ? AND ?
         GROUP BY periodo`,
        [desde, hasta]
    );
    return filas.map((f) => ({ periodo: f.periodo, cantidad: Number(f.cantidad) }));
}

/** Retiros (por `retiro.fecha_retiro`) por mes 'YYYY-MM' entre dos fechas. */
async function retirosPorMes({ desde, hasta }, conn = db) {
    const [filas] = await conn.query(
        `SELECT DATE_FORMAT(r.fecha_retiro, '%Y-%m') AS periodo, COUNT(*) AS cantidad
         FROM retiro r
         WHERE r.fecha_retiro BETWEEN ? AND ?
         GROUP BY periodo`,
        [desde, hasta]
    );
    return filas.map((f) => ({ periodo: f.periodo, cantidad: Number(f.cantidad) }));
}

/** Novedades que se cruzan con el rango, por tipo, con la suma de días. */
async function novedadesPorTipo({ desde, hasta }, conn = db) {
    const [filas] = await conn.query(
        `SELECT tn.nombre AS tipo, COUNT(*) AS cantidad, COALESCE(SUM(n.total_dias), 0) AS dias
         FROM novedad_rrhh n
         JOIN tipo_novedad tn ON tn.idtipo_novedad = n.tipo_novedad_idtipo_novedad
         WHERE n.fecha_inicial <= ? AND COALESCE(n.fecha_final, n.fecha_inicial) >= ?
         GROUP BY tn.idtipo_novedad, tn.nombre
         ORDER BY cantidad DESC`,
        [hasta, desde]
    );
    return filas.map((f) => ({ tipo: f.tipo, cantidad: Number(f.cantidad), dias: Number(f.dias) }));
}

/**
 * Tramos salariales que se cruzan con [desde, hasta], para reconstruir el costo de nómina de
 * cualquier mes (asistencia.md §38). Un tramo es un registro de `historial_salarial` recortado a
 * la vida del contrato:
 *   - empieza en el mayor entre el ingreso del contrato y el inicio de la vigencia;
 *   - termina el día anterior a `fecha_vigencia_fin` (ese día ya rige el salario nuevo), o en la
 *     fecha de retiro. Un contrato retirado/inactivo sin fila en `retiro` se da por terminado el
 *     día de su última actualización (`updated_at`), que es cuando cambió de estado.
 * Fechas como 'YYYY-MM-DD' (columnas DATE: no hay conversión de zona horaria).
 */
async function tramosSalariales({ desde, hasta }, conn = db) {
    const inicio = 'GREATEST(c.fecha_ingreso, hs.fecha_vigencia_inicio)';
    const fin = `LEAST(
        COALESCE(DATE_SUB(hs.fecha_vigencia_fin, INTERVAL 1 DAY), '9999-12-31'),
        COALESCE(r.fecha_retiro, CASE WHEN ec.nombre NOT IN (?, ?) THEN DATE(c.updated_at) END, '9999-12-31'))`;
    const [filas] = await conn.query(
        `SELECT c.idcontrato, c.users_company_id, cam.idcampania, COALESCE(cam.nombre, 'Sin campaña') AS campania,
                DATE_FORMAT(${inicio}, '%Y-%m-%d') AS desde,
                DATE_FORMAT(${fin}, '%Y-%m-%d') AS hasta,
                hs.salario,
                COALESCE(hs.bono_no_prestacional, 0) + COALESCE(hs.bono_cafeteria, 0) AS bonos,
                (SELECT ss.tarifa_arl FROM seguridad_social ss
                  WHERE ss.users_company_id = c.users_company_id AND ss.tipo = 'ARL' AND ss.activa = 1
                  ORDER BY ss.idseguridad_social DESC LIMIT 1) AS tarifa_arl
         FROM historial_salarial hs
         JOIN contrato c ON c.idcontrato = hs.contrato_idcontrato
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN retiro r ON r.contrato_idcontrato = c.idcontrato
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         WHERE ${inicio} <= ? AND ${fin} >= ? AND ${inicio} <= ${fin}`,
        [...ESTADOS_CONTRATO_ACTIVOS, hasta, ...ESTADOS_CONTRATO_ACTIVOS, desde, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.map((f) => ({
        idcontrato: f.idcontrato,
        users_company_id: f.users_company_id,
        idcampania: f.idcampania,
        campania: f.campania,
        desde: f.desde,
        hasta: f.hasta,
        salario: Number(f.salario) || 0,
        bonos: Number(f.bonos) || 0,
        tarifa_arl: f.tarifa_arl == null ? null : Number(f.tarifa_arl)
    }));
}

/** Factores activos del costo de nómina (migraciones 078-080), en orden. */
async function factoresCostoNomina(conn = db) {
    const [filas] = await conn.query(
        'SELECT codigo, nombre, categoria, porcentaje, exonerable, incluye_auxilio FROM factor_costo_nomina WHERE activo = 1 ORDER BY orden, codigo'
    );
    return filas.map((f) => ({
        codigo: f.codigo, nombre: f.nombre, categoria: f.categoria,
        porcentaje: Number(f.porcentaje), exonerable: Number(f.exonerable) === 1,
        incluye_auxilio: Number(f.incluye_auxilio) === 1
    }));
}

/** SMMLV y auxilio de transporte por año (migraciones 079 y 080). */
async function salariosMinimos(conn = db) {
    const [filas] = await conn.query('SELECT anio, valor, auxilio_transporte FROM salario_minimo ORDER BY anio');
    return filas.map((f) => ({
        anio: Number(f.anio),
        valor: Number(f.valor),
        auxilio_transporte: f.auxilio_transporte == null ? null : Number(f.auxilio_transporte)
    }));
}

module.exports = { nominaPorCampania, ingresosPorMes, retirosPorMes, novedadesPorTipo, tramosSalariales, factoresCostoNomina, salariosMinimos };
