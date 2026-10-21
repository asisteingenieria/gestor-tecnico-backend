const db = require('../../config/db');

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];

// Corrección 2026-09-23: la jerarquía de "empleados a cargo" del módulo se calcula por
// contrato.jefe_area_id, no por jefe_inmediato_id (decisión original de asistencia.md §2).
// El jefe de área es quien crea horarios y aprueba horas extra de todo su equipo, no solo
// de sus reportes directos — ver asistencia.md §16 para el detalle de la corrección.

// Login (users.id) del jefe de área del contrato activo de un empleado, o null si no
// tiene jefe asignado o el jefe no tiene cuenta de login vinculada.
async function directorUserIdDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT u.id
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         JOIN users u ON u.users_company_id = c.jefe_area_id
         WHERE c.users_company_id = ? AND ec.nombre IN (?, ?)
         ORDER BY c.fecha_ingreso DESC
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas[0]?.id ?? null;
}

// ¿El empleado tiene, en su contrato activo, a este director como jefe de área?
async function esSubordinado(directorUsersCompanyId, empleadoId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE c.users_company_id = ? AND c.jefe_area_id = ? AND ec.nombre IN (?, ?)
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
         WHERE c.jefe_area_id = ? AND ec.nombre IN (?, ?)
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
         WHERE c.jefe_area_id = ? AND ec.nombre IN (?, ?) AND c.users_company_id IN (?)`,
        [directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS, empleadoIds]
    );
    return filas.map((f) => f.users_company_id);
}

async function listaEmpleadosACargo(directorUsersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT DISTINCT uc.id AS users_company_id, uc.nombre_propio, uc.numero_identificacion, car.nombre AS cargo
         FROM users_company uc
         JOIN contrato c ON c.users_company_id = uc.id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         WHERE c.jefe_area_id = ? AND ec.nombre IN (?, ?)
         ORDER BY uc.nombre_propio`,
        [directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas;
}

// Datos de cada persona del equipo como van en el reporte de horas extras (columnas del formato
// V.3): documento, nombre completo, campaña, centro de costo y cargo de su contrato activo.
async function datosParaReporte(directorUsersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.numero_identificacion AS documento,
                TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido)) AS nombre,
                cam.nombre AS campania, cc.nombre AS centro_costo, car.nombre AS cargo
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         WHERE c.jefe_area_id = ? AND ec.nombre IN (?, ?)
           -- si la persona tuviera dos contratos activos con este jefe, el más reciente
           AND c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                                JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                               WHERE c2.users_company_id = c.users_company_id AND c2.jefe_area_id = c.jefe_area_id
                                 AND ec2.nombre IN (?, ?))
         ORDER BY nombre`,
        [directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas;
}

module.exports = { datosParaReporte, directorUserIdDe, esSubordinado, subordinadosDe, tieneEmpleadosACargo, listaEmpleadosACargo };
