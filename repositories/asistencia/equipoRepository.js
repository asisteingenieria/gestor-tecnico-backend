const db = require('../../config/db');

const ESTADOS_CONTRATO_ACTIVOS = ['activo', 'periodo_prueba'];

// Contrato vigente para listar el equipo (§63): es el más reciente de la persona y no tiene un retiro
// registrado. Así un retirado no sale aunque le quede un contrato anterior en 'activo' (traspasos,
// cargues) o un retiro cargado sin cambiar el estado del contrato. Va junto a `ec.nombre IN (activos)`.
const CONTRATO_VIGENTE = (alias) => `${alias}.idcontrato = (SELECT MAX(cv.idcontrato) FROM contrato cv WHERE cv.users_company_id = ${alias}.users_company_id)
           AND NOT EXISTS (SELECT 1 FROM retiro rv WHERE rv.contrato_idcontrato = ${alias}.idcontrato)`;

// Corrección 2026-09-23: la jerarquía de "empleados a cargo" del módulo se calcula por
// contrato.jefe_area_id, no por jefe_inmediato_id (decisión original de asistencia.md §2).
// El jefe de área es quien crea horarios y aprueba horas extra de todo su equipo, no solo
// de sus reportes directos — ver asistencia.md §16 para el detalle de la corrección.
//
// Desde la 082 (§44) quien gestiona puede ser otro: `contrato.gestor_asistencia_id`, cuando el jefe
// de área no usa el sistema (German Arias, dueño de la empresa). NULL = el jefe de área. El jefe de
// área que se muestra en la ficha y en los reportes no cambia; solo cambia quién gestiona.
//
// Backoffice (§87): todo el que tenga un cargo de backoffice —BACKOFFICE, BACKOFFICE OBAMACARE, BACKOFFICE PE,
// COORDINADOR BACKOFFICE PE…— lo gestiona la Jefe de Backoffice (cargo JEFE DE BACKOFFICE), no su jefe de área: ella
// le carga el horario y su gente sale en su Equipo. Los jefes de operaciones ya no los ven. Es regla por cargo, así
// que un backoffice nuevo le llega solo. Si no hay Jefe de Backoffice vigente, vuelve al jefe de área. Un
// `gestor_asistencia_id` puesto a mano sigue mandando. Sin `?`: estos fragmentos van dentro de consultas con
// parámetros posicionales; los literales son constantes del código, no datos de nadie.
const ACTIVOS_SQL = `('${ESTADOS_CONTRATO_ACTIVOS.join("', '")}')`;
const CARGOS_BACKOFFICE = `(SELECT cgb.idcargo FROM cargo cgb
                             WHERE UPPER(cgb.nombre) LIKE '%BACKOFFICE%' AND UPPER(cgb.nombre) NOT LIKE '%JEFE%')`;
const ES_BACKOFFICE = (a) => `${a}.cargo_idcargo IN ${CARGOS_BACKOFFICE}`;
const JEFE_BACKOFFICE = `(SELECT MIN(cjb.users_company_id) FROM contrato cjb
                            JOIN estado_contrato ecjb ON ecjb.idestado_contrato = cjb.estado_contrato_idestado_contrato
                            JOIN cargo cgjb ON cgjb.idcargo = cjb.cargo_idcargo
                           WHERE UPPER(cgjb.nombre) LIKE '%JEFE%BACKOFFICE%' AND ecjb.nombre IN ${ACTIVOS_SQL}
                             AND cjb.idcontrato = (SELECT MAX(cvb.idcontrato) FROM contrato cvb WHERE cvb.users_company_id = cjb.users_company_id)
                             AND NOT EXISTS (SELECT 1 FROM retiro rvb WHERE rvb.contrato_idcontrato = cjb.idcontrato))`;
// Fichas con cargo de backoffice (Jefe de Backoffice incluida): solo ellas siguen viendo a un backoffice por ser su
// jefe inmediato o de área (la Coordinadora de Backoffice PE ve a los suyos; un jefe de operaciones no).
const PERSONAL_BACKOFFICE = `(SELECT cpb.users_company_id FROM contrato cpb
                               JOIN estado_contrato ecpb ON ecpb.idestado_contrato = cpb.estado_contrato_idestado_contrato
                               JOIN cargo cgpb ON cgpb.idcargo = cpb.cargo_idcargo
                              WHERE UPPER(cgpb.nombre) LIKE '%BACKOFFICE%' AND ecpb.nombre IN ${ACTIVOS_SQL})`;

// Quién gestiona el contrato con alias `a`.
const gestorDe = (a) => `COALESCE(${a}.gestor_asistencia_id, CASE WHEN ${ES_BACKOFFICE(a)} THEN ${JEFE_BACKOFFICE} END, ${a}.jefe_area_id)`;
const GESTOR = gestorDe('c');

// ¿La línea de mando `col` (jefe_inmediato_id o jefe_area_id) del contrato `a` cuenta para ver a la persona? Siempre,
// salvo que sea backoffice y ese jefe no sea de backoffice (§87).
const lineaVisible = (a, col) => `(NOT ${ES_BACKOFFICE(a)} OR ${a}.${col} IN ${PERSONAL_BACKOFFICE})`;

// "El contrato `a` cuelga de alguien de la lista" por las tres líneas de mando, con la regla de backoffice.
// Lleva tres `?` (la lista, tres veces), en el mismo orden que la condición anterior.
const DEL_ARBOL_SQL = (a = 'c') => `((${lineaVisible(a, 'jefe_inmediato_id')} AND ${a}.jefe_inmediato_id IN (?))
          OR (${lineaVisible(a, 'jefe_area_id')} AND ${a}.jefe_area_id IN (?))
          OR ${gestorDe(a)} IN (?))`;

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
                cam.nombre AS campania, c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo,
                moda.nombre AS modalidad_contrato, c.fecha_ingreso
         FROM users_company uc
         JOIN contrato c ON c.users_company_id = uc.id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN modalidad moda ON moda.idmodalidad = c.modalidad_idmodalidad
         WHERE ${GESTOR} = ? AND ec.nombre IN (?, ?)
           AND ${CONTRATO_VIGENTE('c')}
         ORDER BY uc.nombre_propio`,
        [directorUsersCompanyId, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas;
}

// --- Árbol del director (§51) ---
// El director ve la asistencia de toda la gente que cuelga de él: sus subordinados directos, los de
// ellos y así hacia abajo, siguiendo quién gestiona a quién (GESTOR). Una CTE recursiva; con UNION
// (sin ALL) termina aunque haya ciclos —Geraldin es su propia gestora—, y la ficha raíz se excluye.
//
// Desde §57 el árbol de CONSULTA sigue las tres líneas de mando del contrato activo: jefe inmediato
// (coordinador), jefe de área y GESTOR. Así el coordinador ve a los suyos en "Equipo", el jefe de área a
// toda su área (incluidos los coordinadores que le reportan como jefe inmediato) y el director todo lo de
// abajo. Para ESCRIBIR (horarios, horas extra, correcciones) sigue valiendo solo GESTOR: esSubordinado y
// listaEmpleadosACargo.
// Desde §87 un backoffice cuelga solo de quien lo gestiona (la Jefe de Backoffice) y de sus jefes que sean de backoffice.
const LINEAS_CTE = `lineas AS (
        SELECT c.users_company_id AS empleado_id, c.jefe_inmediato_id AS jefe_id
          FROM contrato c JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ec.nombre IN (?, ?) AND c.jefe_inmediato_id IS NOT NULL AND ${lineaVisible('c', 'jefe_inmediato_id')}
        UNION
        SELECT c.users_company_id, c.jefe_area_id
          FROM contrato c JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ec.nombre IN (?, ?) AND c.jefe_area_id IS NOT NULL AND ${lineaVisible('c', 'jefe_area_id')}
        UNION
        SELECT c.users_company_id, ${GESTOR}
          FROM contrato c JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ec.nombre IN (?, ?) AND ${GESTOR} IS NOT NULL
    )`;
const PARAMS_LINEAS = [...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS, ...ESTADOS_CONTRATO_ACTIVOS];

// ¿Es jefe inmediato, jefe de área o gestor de alguien con contrato activo? Abre las pantallas de
// consulta del equipo (canVerEquipo), no las de gestión (canDirigirEquipo, que es solo GESTOR).
async function tienePersonalACargo(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
           FROM contrato c
           JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
          WHERE ec.nombre IN (?, ?) AND c.users_company_id <> ?
            AND ${DEL_ARBOL_SQL('c')}
          LIMIT 1`,
        [...ESTADOS_CONTRATO_ACTIVOS, usersCompanyId, [usersCompanyId], [usersCompanyId], [usersCompanyId]]
    );
    return filas.length > 0;
}

async function idsDelArbol(raizUsersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `WITH RECURSIVE ${LINEAS_CTE},
         arbol (id) AS (
            SELECT empleado_id FROM lineas WHERE jefe_id = ?
            UNION
            SELECT l.empleado_id FROM lineas l JOIN arbol t ON l.jefe_id = t.id
         )
         SELECT id FROM arbol WHERE id <> ?`,
        [...PARAMS_LINEAS, raizUsersCompanyId, raizUsersCompanyId]
    );
    return filas.map((f) => f.id);
}

// Toda la gente del árbol con lo que muestran las pantallas de equipo. `directo` = la gestiona esta
// ficha (a esos sí les asigna horarios y les pide horas extra); `jefe` = quién la gestiona;
// `jefe_inmediato` = su coordinador.
async function listaEmpleadosDelArbol(raizUsersCompanyId, conn = db) {
    const ids = await idsDelArbol(raizUsersCompanyId, conn);
    if (ids.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.nombre_propio, uc.numero_identificacion, car.nombre AS cargo,
                cam.nombre AS campania, c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo,
                ${GESTOR} AS gestor_id, g.nombre_propio AS jefe,
                c.jefe_inmediato_id, ji.nombre_propio AS jefe_inmediato
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         LEFT JOIN users_company g ON g.id = ${GESTOR}
         LEFT JOIN users_company ji ON ji.id = c.jefe_inmediato_id
         WHERE c.users_company_id IN (?) AND ec.nombre IN (?, ?)
           AND ${CONTRATO_VIGENTE('c')}
         ORDER BY uc.nombre_propio`,
        [ids, ...ESTADOS_CONTRATO_ACTIVOS]
    );
    return filas.map((f) => ({ ...f, directo: f.gestor_id === raizUsersCompanyId }));
}

async function esDelArbol(raizUsersCompanyId, empleadoId, conn = db) {
    return (await idsDelArbol(raizUsersCompanyId, conn)).includes(Number(empleadoId));
}

// Hacia arriba por las mismas tres líneas: coordinador, jefe de área, gestor y los de ellos. Para avisar
// en vivo a todos los "Equipo hoy" que ven a la persona.
async function ancestrosDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `WITH RECURSIVE ${LINEAS_CTE},
         arriba (id) AS (
            SELECT jefe_id FROM lineas WHERE empleado_id = ?
            UNION
            SELECT l.jefe_id FROM lineas l JOIN arriba t ON l.empleado_id = t.id
         )
         SELECT id FROM arriba WHERE id <> ?`,
        [...PARAMS_LINEAS, usersCompanyId, usersCompanyId]
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
                       WHERE ${gestorDe('c2')} = c.users_company_id AND ec2.nombre IN (?, ?))
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

// --- Novedades de asistencia (cambio de turno y libre, §86) ---
// Las pide solo el coordinador (§86): quien tiene cargo de coordinador en su contrato vigente y es el jefe inmediato
// (`jefe_inmediato_id`) de la persona, siempre que no sea también quien la gestiona —ese es el jefe de operaciones,
// que solo aprueba—. El cargo se exige porque en RRHH hay agentes, formadores y otros cargos que figuran como jefe
// inmediato de alguien: ellos no piden. Cada fila trae quién gestiona al empleado (`gestor_id`/`gestor`), que es quien
// aprueba. Sin gestor la fila sale igual, para que la pantalla diga que falta asignarlo. Contrato vigente (§63).
const CARGO_COORDINADOR = '%COORDINADOR%';
// Un backoffice solo lo pide un coordinador de backoffice (§87).
const SOLICITABLES_WHERE = `c.jefe_inmediato_id = ? AND ${lineaVisible('c', 'jefe_inmediato_id')} AND NOT (${GESTOR} <=> ?) AND c.users_company_id <> ? AND ec.nombre IN (?, ?)
           AND ${CONTRATO_VIGENTE('c')}
           AND EXISTS (SELECT 1
                       FROM contrato cs
                       JOIN estado_contrato ecs ON ecs.idestado_contrato = cs.estado_contrato_idestado_contrato
                       JOIN cargo cgs ON cgs.idcargo = cs.cargo_idcargo
                       WHERE cs.users_company_id = ? AND ecs.nombre IN (?, ?) AND ${CONTRATO_VIGENTE('cs')}
                         AND UPPER(cgs.nombre) LIKE ?)`;
// Parámetros de SOLICITABLES_WHERE, en orden.
const paramsSolicitables = (id) => [id, id, id, ...ESTADOS_CONTRATO_ACTIVOS, id, ...ESTADOS_CONTRATO_ACTIVOS, CARGO_COORDINADOR];

async function solicitablesDe(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT uc.id AS users_company_id, uc.nombre_propio, uc.numero_identificacion, car.nombre AS cargo,
                cam.nombre AS campania, c.centro_costo_idcentro_costo AS centro_costo_id, cc.nombre AS centro_costo,
                ${GESTOR} AS gestor_id, g.nombre_propio AS gestor
         FROM contrato c
         JOIN users_company uc ON uc.id = c.users_company_id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         LEFT JOIN users_company g ON g.id = ${GESTOR}
         LEFT JOIN cargo car ON car.idcargo = c.cargo_idcargo
         LEFT JOIN campania cam ON cam.idcampania = c.campania_idcampania
         LEFT JOIN centro_costo cc ON cc.idcentro_costo = c.centro_costo_idcentro_costo
         WHERE ${SOLICITABLES_WHERE}
         ORDER BY uc.nombre_propio`,
        paramsSolicitables(usersCompanyId)
    );
    return filas;
}

// De una lista de fichas, las que esta ficha puede pedir, con el gestor de cada una (una consulta).
async function solicitablesEntre(usersCompanyId, empleadoIds, conn = db) {
    if (empleadoIds.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT c.users_company_id, ${GESTOR} AS gestor_id
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ${SOLICITABLES_WHERE} AND c.users_company_id IN (?)`,
        [...paramsSolicitables(usersCompanyId), empleadoIds]
    );
    return filas;
}

async function tieneSolicitables(usersCompanyId, conn = db) {
    const [filas] = await conn.query(
        `SELECT 1
         FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ${SOLICITABLES_WHERE}
         LIMIT 1`,
        paramsSolicitables(usersCompanyId)
    );
    return filas.length > 0;
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
    gestorDe,
    DEL_ARBOL_SQL,
    cargoDe,
    solicitablesDe,
    solicitablesEntre,
    tieneSolicitables,
    tieneJefesACargo,
    gestorConNombreDe,
    tienePersonalACargo,
    idsDelArbol,
    listaEmpleadosDelArbol,
    esDelArbol,
    ancestrosDe,
    directorUserIdDe, jefeAreaDe, esSubordinado, subordinadosDe, tieneEmpleadosACargo, listaEmpleadosACargo
};
