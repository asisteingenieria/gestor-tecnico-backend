const db = require('../../config/db');

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];

// Corrección 2026-09-23: la jerarquía de "empleados a cargo" del módulo se calcula por
// contrato.jefe_area_id, no por jefe_inmediato_id (decisión original de asistencia.md §2).
// El jefe de área es quien crea horarios y aprueba horas extra de todo su equipo, no solo
// de sus reportes directos — ver asistencia.md §16 para el detalle de la corrección.
//
// Desde la 082 (§44) quien gestiona puede ser otro: `contrato.gestor_asistencia_id`, cuando el jefe
// de área no usa el sistema (German Arias, dueño de la empresa). NULL = el jefe de área. El jefe de
// área que se muestra en la ficha y en los reportes no cambia; solo cambia quién gestiona.
const GESTOR = 'COALESCE(c.gestor_asistencia_id, c.jefe_area_id)';

// Login (users.id) del jefe de área del contrato activo de un empleado, o null si no
// tiene jefe asignado o el jefe no tiene cuenta de login vinculada.
async function directorUserIdDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT u.id
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         JOIN users u ON u.users_company_id = ${GESTOR}
         WHERE c.users_company_id = ? AND ec.nombre IN (?, ?)
         ORDER BY c.fecha_ingreso DESC
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas[0]?.id ?? null;
}

// Ficha de quien gestiona la asistencia del empleado —su jefe de área, salvo gestor_asistencia_id—,
// para avisarle en vivo a su "Equipo hoy".
async function jefeAreaDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT ${GESTOR} AS gestor_id
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE c.users_company_id = ? AND ec.nombre IN (?, ?)
         ORDER BY c.fecha_ingreso DESC
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas[0]?.gestor_id ?? null;
}

// ¿El empleado tiene, en su contrato activo, a este director como jefe de área?
async function esSubordinado(directorUsersCompanyId, empleadoId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE c.users_company_id = ? AND ${GESTOR} = ? AND ec.nombre IN (?, ?)
         LIMIT 1`,
        [empleadoId, directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.length > 0;
}

// ¿Esta ficha es jefe de área de al menos un contrato activo? Es lo que da acceso a la
// gestión de equipo sin importar el rol de la cuenta (asistencia.md §23).
async function tieneEmpleadosACargo(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ${GESTOR} = ? AND ec.nombre IN (?, ?)
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.length > 0;
}

// De una lista de fichas, las que tienen a este jefe en su contrato activo (una sola consulta
// para la asignación masiva, en vez de una por empleado).
async function subordinadosDe(directorUsersCompanyId, empleadoIds, conn = db) {
    if (empleadoIds.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT DISTINCT c.users_company_id
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ${GESTOR} = ? AND ec.nombre IN (?, ?) AND c.users_company_id IN (?)`,
        [directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS, empleadoIds]
    );
    return filas.map((f) => f.users_company_id);
}

// Con campaña y centro de costo: un mismo jefe tiene centros con horarios distintos y asigna por
// centro (§45).
async function listaEmpleadosACargo(directorUsersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT DISTINCT uc.id AS users_company_id, uc.nombre_propio, uc.numero_identificacion, car.nombre AS cargo,
                cam.nombre AS campania, c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo
         FROM users_company uc
         JOIN contrato c ON c.users_company_id = uc.id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         WHERE ${GESTOR} = ? AND ec.nombre IN (?, ?)
         ORDER BY uc.nombre_propio`,
        [directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas;
}

// ¿Esta ficha es jefe inmediato de alguien con contrato activo? Son los coordinadores, que piden los
// cambios de turno de los empleados (§50).
async function esJefeInmediato(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE c.jefe_inmediato_id = ? AND ec.nombre IN (?, ?)
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.length > 0;
}

// Quién gestiona a cada empleado de la lista, en una consulta: Map empleado → ficha del gestor (o
// ausente si no tiene contrato activo o no tiene jefe).
async function gestoresDe(empleadoIds, conn = db) {
    if (empleadoIds.length === 0) return new Map();
    const [filas] = await conn.query(
        `SELECT c.users_company_id, ${GESTOR} AS gestor_id
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE c.users_company_id IN (?) AND ec.nombre IN (?, ?) AND ${GESTOR} IS NOT NULL
         ORDER BY c.fecha_ingreso`,
        [empleadoIds, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    // Con dos contratos activos gana el más reciente (mismo criterio que jefeAreaDe).
    return new Map(filas.map((f) => [f.users_company_id, f.gestor_id]));
}

// Todos los empleados activos con quien gestiona su asistencia: el coordinador puede pedir el cambio
// de turno de cualquiera (§50) y ve a quién le llega la solicitud.
async function empleadosActivosConGestor(conn = db) {
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.nombre_propio AS nombre, uc.numero_identificacion AS cedula, car.nombre AS cargo,
                cam.nombre AS campania, c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo,
                ${GESTOR} AS gestor_id, g.nombre_propio AS gestor
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN users_company g ON g.id = ${GESTOR}
         WHERE ec.nombre IN (?, ?)
           AND c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                                JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                               WHERE c2.users_company_id = c.users_company_id AND ec2.nombre IN (?, ?))
         ORDER BY uc.nombre_propio`,
        [...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas;
}

module.exports = {
    directorUserIdDe, jefeAreaDe, esSubordinado, subordinadosDe, tieneEmpleadosACargo, listaEmpleadosACargo,
    esJefeInmediato, gestoresDe, empleadosActivosConGestor
};
