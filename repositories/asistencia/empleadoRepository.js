const db = require('../../config/db');

// Fichas de RRHH con ese número de identificación. Puede haber más de una si la misma cifra
// existe con dos tipos de documento distintos (CC y CE, p. ej.): quien llama decide qué hacer.
async function findPorNumeroIdentificacion(numero, conn = db) {
    const [filas] = await conn.query(
        'SELECT id FROM users_company WHERE numero_identificacion = ?',
        [numero]
    );
    return filas.map((f) => f.id);
}

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];
const NOMBRE = "TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido))";

// Contrato activo más reciente de cada ficha (para financiera, que ve a todos por campaña, §32).
const CONTRATO_ACTIVO = `c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                          JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                         WHERE c2.users_company_id = c.users_company_id AND ec2.nombre IN (?, ?))`;

/** Campañas con su número de empleados activos. */
async function findCampaniasConEmpleados(conn = db) {
    const [filas] = await conn.query(
        `SELECT cam.idcampania, cam.nombre, COUNT(DISTINCT c.users_company_id) AS empleados
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         JOIN campania cam ON cam.idcampania = c.campania_idcampania
         WHERE ec.nombre IN (?, ?)
         GROUP BY cam.idcampania
         ORDER BY cam.nombre`,
        ESTADOS_CONTRATO_ACTIVOS
    );
    return filas.map((f) => ({ ...f, empleados: Number(f.empleados) }));
}

/** Empleados activos de una campaña (o de todas, con campaniaId null), con su jefe de área. */
async function findActivosPorCampania(campaniaId, conn = db) {
    const condiciones = ['ec.nombre IN (?, ?)', CONTRATO_ACTIVO];
    const parametros = [...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS];
    if (campaniaId) {
        condiciones.push('c.campania_idcampania = ?');
        parametros.push(campaniaId);
    }
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.numero_identificacion AS cedula, ${NOMBRE} AS nombre,
                cam.idcampania, cam.nombre AS campania, car.nombre AS cargo,
                c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo,
                TRIM(CONCAT_WS(' ', j.primer_nombre, j.primer_apellido)) AS jefe_area
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN users_company j ON j.id = c.jefe_area_id
         WHERE ${condiciones.join(' AND ')}
         ORDER BY nombre`,
        parametros
    );
    return filas;
}

/** Nombre, campaña y centro de costo del contrato activo de una ficha, o null si no tiene contrato activo. */
async function findActivo(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.numero_identificacion AS cedula, ${NOMBRE} AS nombre,
                cam.idcampania, cam.nombre AS campania, car.nombre AS cargo,
                c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         WHERE uc.id = ? AND ec.nombre IN (?, ?) AND ${CONTRATO_ACTIVO}`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas[0] ?? null;
}

module.exports = { findPorNumeroIdentificacion, findCampaniasConEmpleados, findActivosPorCampania, findActivo };
