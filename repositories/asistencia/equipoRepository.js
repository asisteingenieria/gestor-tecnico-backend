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

module.exports = { directorUserIdDe, esSubordinado, listaEmpleadosACargo };
