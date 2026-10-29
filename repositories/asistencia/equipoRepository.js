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

// --- Árbol del director (§51) ---
// El director ve la asistencia de toda la gente que cuelga de él: sus subordinados directos, los de
// ellos y así hacia abajo, siguiendo quién gestiona a quién (GESTOR). Una CTE recursiva; con UNION
// (sin ALL) termina aunque haya ciclos —Geraldin es su propia gestora—, y la ficha raíz se excluye.
const ACTIVOS_CTE = `activos AS (
        SELECT c.users_company_id AS empleado_id, ${GESTOR} AS gestor_id
        FROM contrato c
        JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
        WHERE ec.nombre IN (?, ?) AND ${GESTOR} IS NOT NULL
    )`;

async function idsDelArbol(raizUsersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `WITH RECURSIVE ${ACTIVOS_CTE},
         arbol (id) AS (
            SELECT empleado_id FROM activos WHERE gestor_id = ?
            UNION
            SELECT a.empleado_id FROM activos a JOIN arbol t ON a.gestor_id = t.id
         )
         SELECT id FROM arbol WHERE id <> ?`,
        [...ESTADOS_CONTRATO_ACTIVOS, raizUsersCompanyId, raizUsersCompanyId]
    );
    return filas.map((f) => f.id);
}

// Toda la gente del árbol con lo que muestran las pantallas de equipo. `directo` = la gestiona esta
// ficha (a esos sí les asigna horarios y les pide horas extra); `jefe` = quién la gestiona.
async function listaEmpleadosDelArbol(raizUsersCompanyId, conn = db) {
    const ids = await idsDelArbol(raizUsersCompanyId, conn);
    if (ids.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.nombre_propio, uc.numero_identificacion, car.nombre AS cargo,
                cam.nombre AS campania, c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo,
                ${GESTOR} AS gestor_id, g.nombre_propio AS jefe
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN users_company g ON g.id = ${GESTOR}
         WHERE c.users_company_id IN (?) AND ec.nombre IN (?, ?)
           AND c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2
                                JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                               WHERE c2.users_company_id = c.users_company_id AND ec2.nombre IN (?, ?))
         ORDER BY uc.nombre_propio`,
        [ids, ...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.map((f) => ({ ...f, directo: f.gestor_id === raizUsersCompanyId }));
}

async function esDelArbol(raizUsersCompanyId, empleadoId, conn = db) {
    return (await idsDelArbol(raizUsersCompanyId, conn)).includes(Number(empleadoId));
}

// Hacia arriba: el gestor del empleado, el gestor de ese gestor, etc. Para avisar en vivo a todos los
// "Equipo hoy" que ven a la persona.
async function ancestrosDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `WITH RECURSIVE ${ACTIVOS_CTE},
         arriba (id) AS (
            SELECT gestor_id FROM activos WHERE empleado_id = ?
            UNION
            SELECT a.gestor_id FROM activos a JOIN arriba t ON a.empleado_id = t.id
         )
         SELECT id FROM arriba WHERE id <> ?`,
        [...ESTADOS_CONTRATO_ACTIVOS, usersCompanyId, usersCompanyId]
    );
    return filas.map((f) => f.id);
}

// ¿Gestiona a alguien que a su vez gestiona gente? Es el director: aprueba las horas extra y los
// cambios de turno que piden sus jefes (§51).
async function tieneJefesACargo(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ${GESTOR} = ? AND ec.nombre IN (?, ?) AND c.users_company_id <> ?
           AND EXISTS (SELECT 1 FROM contrato c2
                        JOIN estado_contrato ec2 ON ec2.idestado_contrato = c2.estado_contrato_idestado_contrato
                       WHERE COALESCE(c2.gestor_asistencia_id, c2.jefe_area_id) = c.users_company_id AND ec2.nombre IN (?, ?))
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS, usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.length > 0;
}

// Quién gestiona a esta ficha, con su nombre: a quién le llegan sus solicitudes (§51).
async function gestorConNombreDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT ${GESTOR} AS gestor_id, g.nombre_propio AS gestor
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         JOIN users_company g ON g.id = ${GESTOR}
         WHERE c.users_company_id = ? AND ec.nombre IN (?, ?)
         ORDER BY c.fecha_ingreso DESC
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas[0] ?? null;
}

// Cargo del contrato activo más reciente, para mostrarlo bajo el nombre en la barra del portal.
async function cargoDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT car.nombre AS cargo
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         JOIN cargo car ON car.idcargo = c.cargo_idcargo
         WHERE c.users_company_id = ? AND ec.nombre IN (?, ?)
         ORDER BY c.idcontrato DESC
         LIMIT 1`,
        [usersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas[0]?.cargo || null;
}

module.exports = {
    cargoDe,
    tieneJefesACargo,
    gestorConNombreDe,
    idsDelArbol,
    listaEmpleadosDelArbol,
    esDelArbol,
    ancestrosDe,
    directorUserIdDe, jefeAreaDe, esSubordinado, subordinadosDe, tieneEmpleadosACargo, listaEmpleadosACargo
};
