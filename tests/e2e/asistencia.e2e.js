/**
 * Prueba end-to-end del módulo de asistencia: HTTP real contra el backend + BD local.
 *
 *   npm run test:e2e              levanta su propio servidor en el puerto 5099
 *   npm run test:e2e -- --conservar   deja los datos del día para mirarlos en el frontend
 *   E2E_BASE=http://localhost:5001 E2E_ASISLOCK_KEY=... node tests/e2e/asistencia.e2e.js
 *                                 usa un servidor ya levantado
 *
 * Requiere el seed (`node scripts/seedEmpleadosAsistencia.js`), la migración 065 y, para la
 * sección 7, al menos una cuenta de empleado por cédula (`node scripts/crearCuentasEmpleados.js --aplicar`).
 * Toca solo datos de prueba: horarios, jornadas, horas extra y registros AsisLock del día de
 * hoy de las fichas 7-12 del seed, que borra al empezar y al terminar. La cuenta por cédula que
 * usa para probar el cambio de contraseña queda restaurada.
 *
 * Arma los horarios alrededor de la hora actual: correrla entre las 04:00 y las 23:40 Bogotá.
 * No va en `npm test` (que corre sin servidor ni BD): por eso no termina en `.test.js`.
 */
const path = require('path');
const { spawn } = require('child_process');
const db = require('../../config/db');
const bcrypt = require('bcryptjs');

const PUERTO_PROPIO = 5099;
const API_KEY = process.env.E2E_ASISLOCK_KEY || 'e2e-clave-local';
let BASE = process.env.E2E_BASE;
let servidor = null;

// Sin E2E_BASE levanta el backend con una clave de AsisLock propia (sin tocar .env).
async function levantarServidor() {
    if (BASE) return;
    BASE = `http://localhost:${PUERTO_PROPIO}`;
    servidor = spawn(process.execPath, ['index.js'], {
        cwd: path.join(__dirname, '..', '..'),
        env: { ...process.env, PORT: String(PUERTO_PROPIO), ASISLOCK_API_KEY: API_KEY, NODE_ENV: 'development' },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    let errores = '';
    servidor.stderr.on('data', (d) => { errores += d; });
    for (let i = 0; i < 50; i++) {
        try {
            const r = await fetch(`${BASE}/api/integraciones/asislock/v1/salud`, { headers: { 'x-api-key': API_KEY } });
            if (r.ok) return;
        } catch { /* todavía no escucha */ }
        if (servidor.exitCode !== null) break;
        await new Promise((ok) => setTimeout(ok, 200));
    }
    throw new Error(`El servidor de prueba no levantó en el puerto ${PUERTO_PROPIO}\n${errores}`);
}
const CLAVE_SEED = 'Prueba123*';
const EMP = { director: 7, e1: 8, e2: 9, e3: 10, e4: 11, e5: 12 };
const CEDULA_DIRECTOR = '9000000001';
const CEDULA_E4 = '9000000005';
const CEDULA_E5 = '9000000006'; // envíos sin id (sección 6b)
const ASISLOCK_IDS = [990001, 990002, 990003, 990004];

let ok = 0; let fallos = 0;
const fallidos = [];
function check(nombre, condicion, detalle) {
    if (condicion) { ok++; console.log(`  ✔ ${nombre}`); }
    else { fallos++; fallidos.push(nombre); console.log(`  ✘ ${nombre}${detalle !== undefined ? `\n      → ${JSON.stringify(detalle).slice(0, 400)}` : ''}`); }
}
const seccion = (t) => console.log(`\n== ${t} ==`);

async function http(metodo, ruta, { token, body, headers = {} } = {}) {
    const r = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        headers: { 'content-type': 'application/json', ...(token ? { 'x-auth-token': token } : {}), ...headers },
        body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
    });
    const texto = await r.text();
    let json; try { json = JSON.parse(texto); } catch { json = texto; }
    return { status: r.status, body: json };
}
const login = async (username, password) => http('POST', '/api/auth/login', { body: { username, password } });

// --- hora de Bogotá ---
const ahora = new Date();
const bogota = (d) => new Date(d.getTime() - 5 * 3600000);
const fechaBog = (d) => bogota(d).toISOString().slice(0, 10);
const horaBog = (d) => bogota(d).toISOString().slice(11, 19);
const mas = (min) => new Date(ahora.getTime() + min * 60000);
const HOY = fechaBog(ahora);

async function limpiar() {
    const ids = Object.values(EMP);
    await db.query(`DELETE FROM jornada WHERE fecha = ? AND users_company_id IN (?)`, [HOY, ids]);
    await db.query(`DELETE FROM horario_asignado WHERE fecha = ? AND users_company_id IN (?)`, [HOY, ids]);
    await db.query(`DELETE FROM hora_extra WHERE fecha = ? AND users_company_id IN (?)`, [HOY, ids]);
    await db.query(`DELETE FROM asislock_registro WHERE asislock_id IN (?)`, [ASISLOCK_IDS]);
    await db.query(`DELETE FROM asislock_registro WHERE usuario = ? AND fecha_reportada = ?`, [CEDULA_E5, HOY]);
    await db.query(`DELETE FROM login_biometrico WHERE asislock_id IN (?) OR (usuario = ? AND fecha = ?)`, [ASISLOCK_IDS, CEDULA_E5, HOY]);
    await db.query(`DELETE FROM horario_plantilla WHERE nombre LIKE 'E2E %'`);
}

const evento = (body, tipo) => (body?.eventos ?? body?.linea_tiempo ?? body?.timeline ?? []).filter?.((e) => e.tipo === tipo) ?? [];

async function main() {
    if (fechaBog(mas(-240)) !== HOY || fechaBog(mas(15)) !== HOY) {
        throw new Error('La prueba arma horarios de -4 h a +15 min: córrela entre las 04:00 y las 23:40 hora Bogotá');
    }
    await levantarServidor();
    console.log(`Servidor ${BASE} · fecha Bogotá ${HOY} · hora Bogotá ${horaBog(ahora)}`);
    await limpiar();

    seccion('1. Autenticación y permisos');
    const sinToken = await http('GET', '/api/asistencia/mi-jornada/hoy');
    check('sin token → 401', sinToken.status === 401, sinToken);
    const sesiones = {};
    // El jefe del seed entra con su cuenta por cédula (§26); su antigua cuenta director_operaciones
    // quedó desactivada por la 067.
    const viejo = await login('director.operaciones', CLAVE_SEED);
    check('la cuenta director_operaciones desactivada ya no entra → 403', viejo.status === 403, viejo);
    for (const [k, u] of [['director', CEDULA_DIRECTOR], ['e1', 'empleado1'], ['e2', 'empleado2'], ['e3', 'empleado3'], ['e4', 'empleado4']]) {
        const r = await login(u, CLAVE_SEED);
        check(`login ${u}`, r.status === 200 && r.body.token, r);
        sesiones[k] = r.body.token;
    }
    const prohibido = await http('GET', '/api/asistencia/equipo', { token: sesiones.e1 });
    check('empleado no entra a /equipo → 403', prohibido.status === 403, prohibido);

    seccion('1b. Empleado con gente a cargo gestiona su equipo sin rol de director (§23)');
    let plantillaJefe1 = null;
    // empleado5 pasa a reportar a empleado1 solo durante esta sección.
    const [[contratoE5]] = await db.query(
        `SELECT c.idcontrato, c.jefe_area_id FROM contrato c
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE c.users_company_id = ? AND ec.nombre IN ('activo', 'periodo_prueba')
         ORDER BY c.fecha_ingreso DESC LIMIT 1`,
        [EMP.e5]
    );
    await db.query('UPDATE contrato SET jefe_area_id = ? WHERE idcontrato = ?', [EMP.e1, contratoE5.idcontrato]);
    try {
        const me = await http('GET', '/api/auth/me', { token: sesiones.e1 });
        check('/auth/me de empleado1 trae es_jefe_equipo = true', me.body?.es_jefe_equipo === true, me.body);
        const relogin = await login('empleado1', CLAVE_SEED);
        check('login de empleado1 trae esJefeEquipo = true', relogin.body?.user?.esJefeEquipo === true, relogin.body?.user);
        const eq = await http('GET', '/api/asistencia/equipo', { token: sesiones.e1 });
        const ids = Array.isArray(eq.body) ? eq.body.map((e) => e.users_company_id) : [];
        check('empleado1 ve solo a empleado5 en /equipo', eq.status === 200 && ids.length === 1 && ids[0] === EMP.e5, eq);
        const asignarE1 = (empleados) => http('POST', '/api/asistencia/horarios', {
            token: sesiones.e1,
            body: { empleados, desde: HOY, hasta: HOY, hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 60 }
        });
        let r1b = await asignarE1([EMP.e5]);
        check('empleado1 asigna horario a empleado5 → 201', r1b.status === 201, r1b);
        const [[asig]] = await db.query('SELECT idhorario_asignado FROM horario_asignado WHERE users_company_id = ? AND fecha = ?', [EMP.e5, HOY]);
        if (asig) {
            const del = await http('DELETE', `/api/asistencia/horarios/${asig.idhorario_asignado}`, { token: sesiones.e1 });
            check('empleado1 elimina esa asignación → 200', del.status === 200, del);
        }
        r1b = await asignarE1([EMP.e2]);
        check('empleado1 no puede asignar a empleado2, que no está a su cargo → 403', r1b.status === 403, r1b);

        // Plantillas por dueño (§25): la del jefe es solo suya.
        r1b = await http('POST', '/api/asistencia/horarios/plantillas', {
            token: sesiones.e1,
            body: { nombre: 'E2E plantilla jefe1', hora_entrada: '07:00:00', hora_salida: '16:00:00', minutos_almuerzo: 60, tolerancia_entrada_min: 5 }
        });
        check('empleado1 crea su propia plantilla → 201', r1b.status === 201, r1b);
        plantillaJefe1 = r1b.body?.idhorario_plantilla ?? null;
        const [[deDirector]] = await db.query(
            "SELECT idhorario_plantilla AS id FROM horario_plantilla WHERE activo = 1 AND dueno_users_company_id = ? LIMIT 1", [EMP.director]
        );
        const listaJefe1 = await http('GET', '/api/asistencia/horarios/plantillas', { token: sesiones.e1 });
        const idsJefe1 = Array.isArray(listaJefe1.body) ? listaJefe1.body.map((p) => p.idhorario_plantilla) : [];
        check('empleado1 ve solo sus plantillas', listaJefe1.status === 200 && idsJefe1.length === 1 && idsJefe1[0] === plantillaJefe1, listaJefe1.body);
        if (deDirector) {
            r1b = await http('PUT', `/api/asistencia/horarios/plantillas/${deDirector.id}`, { token: sesiones.e1, body: { nombre: 'E2E no debería' } });
            check('empleado1 no puede editar una plantilla del director → 404', r1b.status === 404, r1b);
            r1b = await http('DELETE', `/api/asistencia/horarios/plantillas/${deDirector.id}`, { token: sesiones.e1 });
            check('ni eliminarla → 404', r1b.status === 404, r1b);
        }
        const meE2 = await http('GET', '/api/auth/me', { token: sesiones.e2 });
        check('empleado2 (sin gente a cargo) trae es_jefe_equipo = false', meE2.body?.es_jefe_equipo === false, meE2.body);
    } finally {
        await db.query('UPDATE contrato SET jefe_area_id = ? WHERE idcontrato = ?', [contratoE5.jefe_area_id, contratoE5.idcontrato]);
        await db.query('DELETE FROM horario_asignado WHERE fecha = ? AND users_company_id = ?', [HOY, EMP.e5]);
    }
    const yaNo = await http('GET', '/api/asistencia/equipo', { token: sesiones.e1 });
    check('al quitarle el equipo, empleado1 pierde el acceso en el acto (mismo token) → 403', yaNo.status === 403, yaNo);

    seccion('2. Director: plantillas y horarios');
    const plantilla = await http('POST', '/api/asistencia/horarios/plantillas', {
        token: sesiones.director,
        body: { nombre: 'E2E Turno', hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 60, tolerancia_entrada_min: 5 }
    });
    check('crear plantilla → 201', plantilla.status === 201, plantilla);
    const plantillaId = plantilla.body?.idhorario_plantilla ?? plantilla.body?.id ?? plantilla.body?.plantilla?.idhorario_plantilla;
    const lista = await http('GET', '/api/asistencia/horarios/plantillas', { token: sesiones.director });
    check('la plantilla aparece en el listado', lista.status === 200 && JSON.stringify(lista.body).includes('E2E Turno'), lista.status);
    check('el director no ve la plantilla de empleado1', !JSON.stringify(lista.body).includes('E2E plantilla jefe1'), lista.body);
    if (plantillaJefe1) {
        const ajena = await http('POST', '/api/asistencia/horarios', {
            token: sesiones.director,
            body: { empleados: [EMP.e1], desde: HOY, hasta: HOY, plantilla_id: plantillaJefe1 }
        });
        check('el director no puede asignar con la plantilla de otro jefe → 404', ajena.status === 404, ajena);
    }
    if (plantillaId) {
        const upd = await http('PUT', `/api/asistencia/horarios/plantillas/${plantillaId}`, { token: sesiones.director, body: { nombre: 'E2E Turno editado' } });
        check('editar plantilla → 200', upd.status === 200, upd);
    }

    // Horarios de hoy, armados alrededor de la hora actual:
    //  e1: entró hace 1 h (llega tarde) y sale en 5 min (la salida ya está habilitada)
    //  e2 y e3: salen en 3 h (la salida aún está bloqueada)
    //  e4 (AsisLock): entró hace 4 h y sale en 5 min
    const asignar = async (empleados, entrada, salida) => http('POST', '/api/asistencia/horarios', {
        token: sesiones.director,
        body: { empleados, desde: HOY, hasta: HOY, hora_entrada: horaBog(entrada), hora_salida: horaBog(salida), minutos_almuerzo: 60 }
    });
    let r = await asignar([EMP.e1], mas(-60), mas(5));
    check('asignar horario a empleado1', r.status === 201, r);
    r = await asignar([EMP.e2, EMP.e3], mas(-10), mas(180));
    check('asignación masiva a empleado2 y empleado3', r.status === 201, r);
    r = await asignar([EMP.e4], mas(-240), mas(5));
    check('asignar horario a empleado4', r.status === 201, r);
    const horarios = await http('GET', `/api/asistencia/horarios?desde=${HOY}&hasta=${HOY}`, { token: sesiones.director });
    check('consultar horarios del día', horarios.status === 200 && JSON.stringify(horarios.body).includes(String(EMP.e4)), horarios.status);

    const ajeno = await db.query(
        `SELECT users_company_id AS id FROM contrato WHERE users_company_id NOT IN (?) AND (jefe_area_id IS NULL OR jefe_area_id <> ?) LIMIT 1`,
        [Object.values(EMP), EMP.director]
    ).then(([f]) => f[0]?.id).catch(() => null);
    if (ajeno) {
        r = await asignar([ajeno], mas(-60), mas(60));
        check(`no puede asignar horario a un empleado ajeno (${ajeno}) → 403/404`, [403, 404].includes(r.status), r);
        const t = await http('GET', `/api/asistencia/equipo/${ajeno}/jornadas`, { token: sesiones.director });
        check('no puede ver jornadas de un empleado ajeno → 403/404', [403, 404].includes(t.status), t);
    }

    seccion('3. Empleado1: jornada completa en Gestor');
    let hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e1 });
    check('mi-jornada/hoy antes de marcar → 200', hoy.status === 200, hoy);
    const entrada = await http('POST', '/api/asistencia/mi-jornada/entrada', { token: sesiones.e1 });
    check('marcar entrada', entrada.status === 200, entrada);
    const entrada2 = await http('POST', '/api/asistencia/mi-jornada/entrada', { token: sesiones.e1 });
    check('segunda entrada es idempotente (200)', entrada2.status === 200, entrada2);
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e1 });
    check('minutos_tarde ≈ 55 (60 − 5 de tolerancia)', Math.abs((hoy.body.minutos_tarde ?? -99) - 55) <= 1, hoy.body.minutos_tarde);
    check('alerta llegada_tarde', (hoy.body.alertas ?? []).includes('llegada_tarde'), hoy.body.alertas);
    check('puede_marcar_salida = true (faltan 5 min)', hoy.body.puede_marcar_salida === true, hoy.body.puede_marcar_salida);
    check('servidor_ahora presente', Boolean(hoy.body.servidor_ahora), hoy.body);

    r = await http('POST', '/api/asistencia/mi-jornada/pausa', { token: sesiones.e1, body: { tipo: 'bano' } });
    check('iniciar pausa de baño', r.status === 200, r);
    r = await http('POST', '/api/asistencia/mi-jornada/pausa', { token: sesiones.e1, body: { tipo: 'almuerzo' } });
    check('segunda pausa con una abierta → 422', r.status === 422, r);
    r = await http('POST', '/api/asistencia/mi-jornada/pausa', { token: sesiones.e1, body: { tipo: 'siesta' } });
    check('tipo de pausa inválido → 400', r.status === 400, r);
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e1 });
    check('estado en_pausa con pausa_activa', hoy.body.estado === 'en_pausa' && hoy.body.pausa_activa, { estado: hoy.body.estado, pausa: hoy.body.pausa_activa });
    r = await http('POST', '/api/asistencia/mi-jornada/pausa/fin', { token: sesiones.e1 });
    check('finalizar pausa', r.status === 200, r);
    r = await http('POST', '/api/asistencia/mi-jornada/pausa/fin', { token: sesiones.e1 });
    check('finalizar sin pausa abierta → 409/422', [409, 422].includes(r.status), r);
    r = await http('POST', '/api/asistencia/mi-jornada/pausa', { token: sesiones.e1, body: { tipo: 'almuerzo' } });
    check('iniciar almuerzo', r.status === 200, r);
    r = await http('POST', '/api/asistencia/mi-jornada/salida', { token: sesiones.e1 });
    check('salida con almuerzo abierto (lo cierra o lo exige cerrar)', [200, 409, 422].includes(r.status), r);
    if (r.status !== 200) {
        await http('POST', '/api/asistencia/mi-jornada/pausa/fin', { token: sesiones.e1 });
        r = await http('POST', '/api/asistencia/mi-jornada/salida', { token: sesiones.e1 });
        check('salida tras cerrar el almuerzo', r.status === 200, r);
    }
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e1 });
    check('jornada finalizada', hoy.body.estado === 'finalizada', hoy.body.estado);
    const [[jE1]] = await db.query('SELECT minutos_salida_anticipada FROM jornada WHERE users_company_id = ? AND fecha = ?', [EMP.e1, HOY]);
    check('salida anticipada guardada (≈5 min)', Math.abs((jE1?.minutos_salida_anticipada ?? -99) - 5) <= 1, jE1);
    r = await http('POST', '/api/asistencia/mi-jornada/salida', { token: sesiones.e1 });
    check('segunda salida → rechazada (409/422)', [409, 422].includes(r.status), r);
    r = await http('POST', '/api/asistencia/mi-jornada/pausa', { token: sesiones.e1, body: { tipo: 'bano' } });
    check('pausa tras la salida → rechazada', [409, 422].includes(r.status), r);
    const traza = await http('GET', `/api/asistencia/mi-jornada/${HOY}/trazabilidad`, { token: sesiones.e1 });
    check('trazabilidad del día → 200', traza.status === 200, traza);
    const tiposTraza = JSON.stringify(traza.body);
    check('trazabilidad trae entrada, baño, almuerzo y salida',
        ['entrada', 'inicio_bano', 'fin_bano', 'inicio_almuerzo', 'salida'].every((t) => tiposTraza.includes(`"${t}"`)), traza.body);
    r = await http('GET', `/api/asistencia/mis-jornadas?desde=${HOY}&hasta=${HOY}`, { token: sesiones.e1 });
    check('mis-jornadas devuelve la de hoy', r.status === 200 && JSON.stringify(r.body).includes('finalizada'), r);
    r = await http('GET', `/api/asistencia/mis-estadisticas?desde=${HOY}&hasta=${HOY}`, { token: sesiones.e1 });
    check('mis-estadisticas → 200', r.status === 200, r);
    const pct = JSON.stringify(r.body).match(/"(?:puntualidad|porcentaje_puntualidad)[^"]*":\s*(-?[\d.]+)/);
    if (pct) check('puntualidad dentro de 0-100', Number(pct[1]) >= 0 && Number(pct[1]) <= 100, pct[1]);
    r = await http('GET', `/api/asistencia/mi-horario?desde=${HOY}&hasta=${HOY}`, { token: sesiones.e1 });
    check('mi-horario devuelve el turno asignado', r.status === 200 && JSON.stringify(r.body).includes(horaBog(mas(5)).slice(0, 5)), r);
    r = await http('GET', '/api/asistencia/mi-jornada/2026-13-45/trazabilidad', { token: sesiones.e1 });
    check('fecha inválida → 400', r.status === 400, r);

    seccion('4. Empleado2: salida bloqueada y horas extra');
    await http('POST', '/api/asistencia/mi-jornada/entrada', { token: sesiones.e2 });
    r = await http('POST', '/api/asistencia/mi-jornada/salida', { token: sesiones.e2 });
    check('salida 3 h antes → 422', r.status === 422, r);
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e2 });
    check('puede_marcar_salida = false y segundos_para_habilitar > 0',
        hoy.body.puede_marcar_salida === false && hoy.body.segundos_para_habilitar_salida > 0, hoy.body);
    // Desde §51 las horas extra las pide el jefe y las aprueba SU jefe (el director). En el seed el
    // director (ficha 7) no tiene quien lo gestione: durante esta parte empleado4 hace de su director.
    r = await http('POST', '/api/asistencia/horas-extra/solicitar', { token: sesiones.e2, body: { empleados: [EMP.e2], fecha: HOY, hora_inicio: '22:00', hora_fin: '23:00', motivo: 'E2E' } });
    check('el empleado ya no solicita horas extra → 403', r.status === 403, r);
    r = await http('POST', '/api/asistencia/horas-extra/solicitar', { token: sesiones.director, body: { empleados: [EMP.e2], fecha: HOY, hora_inicio: '22:00', hora_fin: '23:00', motivo: 'E2E' } });
    check('jefe sin director en RRHH no puede solicitar → 422', r.status === 422, r);
    await db.query('UPDATE contrato SET gestor_asistencia_id = ? WHERE users_company_id = ?', [EMP.e4, EMP.director]);
    try {
        // Franja 22:00-23:00 → siempre nocturna: el servidor la clasifica solo en tramos (migración 074).
        const prev = await http('POST', '/api/asistencia/horas-extra/previsualizar', { token: sesiones.director, body: { empleados: [EMP.e2], fecha: HOY, hora_inicio: '22:00', hora_fin: '23:00' } });
        check('previsualizar clasificación por persona → 200, 60 min', prev.status === 200 && prev.body?.[0]?.minutos === 60, prev.body);
        const sol = await http('POST', '/api/asistencia/horas-extra/solicitar', { token: sesiones.director, body: { empleados: [EMP.e2, EMP.e3], fecha: HOY, hora_inicio: '22:00', hora_fin: '23:00', motivo: 'E2E cierre de campaña' } });
        check('el jefe solicita para dos de su equipo → 201, una solicitud por persona', sol.status === 201 && sol.body?.ids?.length === 2, sol.body);
        r = await http('POST', '/api/asistencia/horas-extra/solicitar', { token: sesiones.director, body: { empleados: [EMP.director], fecha: HOY, hora_inicio: '22:00', hora_fin: '23:00', motivo: 'E2E' } });
        check('no puede pedir para alguien fuera de su equipo → 403', r.status === 403, r);
        r = await http('GET', '/api/asistencia/horas-extra/mias', { token: sesiones.director });
        check('el jefe ve sus solicitudes pendientes', Array.isArray(r.body) && r.body.filter((h) => h.motivo === 'E2E cierre de campaña' && h.estado === 'pendiente').length === 2, r.body);
        r = await http('GET', '/api/asistencia/horas-extra?estado=pendiente', { token: sesiones.director });
        check('no le llegan a su propia bandeja', Array.isArray(r.body) && !r.body.some((h) => h.motivo === 'E2E cierre de campaña'), r.body);
        const bandeja = await http('GET', '/api/asistencia/horas-extra?estado=pendiente', { token: sesiones.e4 });
        const deE2 = (Array.isArray(bandeja.body) ? bandeja.body : []).find((h) => h.motivo === 'E2E cierre de campaña' && h.users_company_id === EMP.e2);
        const deE3 = (Array.isArray(bandeja.body) ? bandeja.body : []).find((h) => h.motivo === 'E2E cierre de campaña' && h.users_company_id === EMP.e3);
        check('le llegan al director con tramos y nombres', Boolean(deE2 && deE3) && Array.isArray(deE2.tramos) && Boolean(deE2.empleado && deE2.solicitante), bandeja.body);
        if (deE2) {
            r = await http('PUT', `/api/asistencia/horas-extra/${deE2.idhora_extra}/aprobar`, { token: sesiones.director, body: {} });
            check('el jefe no puede aprobar lo que él pidió → 404', r.status === 404, r);
            r = await http('PUT', `/api/asistencia/horas-extra/${deE2.idhora_extra}/aprobar`, { token: sesiones.e4, body: { tramos: [{ clase: 'extras_nocturnas', minutos: 45 }], comentario: 'E2E ok' } });
            check('el director aprueba ajustando los tramos → 200', r.status === 200, r);
            r = await http('PUT', `/api/asistencia/horas-extra/${deE2.idhora_extra}/rechazar`, { token: sesiones.e4, body: { comentario: 'E2E' } });
            check('rechazar una ya aprobada → 409', r.status === 409, r);
        }
        if (deE3) {
            r = await http('PUT', `/api/asistencia/horas-extra/${deE3.idhora_extra}/rechazar`, { token: sesiones.e4, body: { comentario: 'E2E sin presupuesto' } });
            check('el director rechaza la otra → 200', r.status === 200, r);
        }
        r = await http('GET', '/api/asistencia/mis-notificaciones', { token: sesiones.director });
        const avisos = Array.isArray(r.body) ? r.body.filter((n) => n.hora_extra_id) : [];
        check('al jefe le llegan la aprobación y el rechazo con su motivo',
            avisos.some((n) => n.tipo === 'hora_extra_aprobada') && avisos.some((n) => n.tipo === 'hora_extra_rechazada' && n.mensaje.includes('E2E sin presupuesto')), r.body);
    } finally {
        await db.query('UPDATE contrato SET gestor_asistencia_id = NULL WHERE users_company_id = ?', [EMP.director]);
        await db.query('DELETE FROM notificacion_asistencia WHERE hora_extra_id IN (SELECT idhora_extra FROM hora_extra WHERE fecha = ? AND users_company_id IN (?))', [HOY, Object.values(EMP)]);
    }
    r = await http('GET', '/api/asistencia/mis-horas-extra?estado=aprobada', { token: sesiones.e2 });
    check('empleado2 ve su hora extra aprobada (45 min)', JSON.stringify(r.body).includes('"minutos_aprobados":45'), r.body);
    r = await http('POST', '/api/asistencia/horas-extra/asignar', { token: sesiones.director, body: { empleados: [EMP.e3], fecha: HOY, minutos: 30, clase: 'extras_diurnas' } });
    check('asignar horas extra ya aprobadas ya no existe → 404', r.status === 404, r);
    // El reporte del jefe se arma solo desde los tramos aprobados (migración 074).
    r = await http('GET', `/api/asistencia/reporte-horas-extra?periodo=${HOY.slice(0, 7)}`, { token: sesiones.director });
    check('reporte del jefe → 200 y suma los tramos aprobados', r.status === 200 && JSON.stringify(r.body).includes('total_horas'), r.body);

    seccion('5. Director: equipo, trazabilidad y evento manual');
    const equipo = await http('GET', '/api/asistencia/equipo', { token: sesiones.director });
    check('equipo → 200', equipo.status === 200, equipo);
    const eq = JSON.stringify(equipo.body);
    check('equipo incluye a los 4 empleados con horario', [EMP.e1, EMP.e2, EMP.e3, EMP.e4].every((id) => eq.includes(`:${id},`) || eq.includes(`:${id}}`)), equipo.body);
    r = await http('GET', `/api/asistencia/equipo/${EMP.e1}/jornada/${HOY}/trazabilidad`, { token: sesiones.director });
    check('trazabilidad de empleado1 vista por el director', r.status === 200 && JSON.stringify(r.body).includes('"salida"'), r.status);
    r = await http('GET', `/api/asistencia/equipo/${EMP.e1}/jornadas?desde=${HOY}&hasta=${HOY}`, { token: sesiones.director });
    check('jornadas de empleado1', r.status === 200, r);
    r = await http('GET', `/api/asistencia/equipo/estadisticas?desde=${HOY}&hasta=${HOY}`, { token: sesiones.director });
    check('estadísticas del equipo', r.status === 200, r);
    const [[jE2]] = await db.query('SELECT idjornada FROM jornada WHERE users_company_id = ? AND fecha = ?', [EMP.e2, HOY]);
    r = await http('POST', `/api/asistencia/equipo/jornada/${jE2.idjornada}/evento`, { token: sesiones.director, body: { tipo: 'inicio_bano' } });
    check('evento manual sin nota → 400', r.status === 400, r);
    r = await http('POST', `/api/asistencia/equipo/jornada/${jE2.idjornada}/evento`, { token: sesiones.director, body: { tipo: 'inicio_bano', nota: 'E2E corrección' } });
    check('evento manual con nota → 200/201', [200, 201].includes(r.status), r);
    const [[ev]] = await db.query("SELECT origen, nota FROM jornada_evento WHERE jornada_id = ? AND tipo = 'inicio_bano'", [jE2.idjornada]);
    check("evento manual guardado con origen='director'", ev?.origen === 'director' && ev?.nota === 'E2E corrección', ev);
    // Director marcando su propia asistencia
    r = await http('POST', '/api/asistencia/mi-jornada/entrada', { token: sesiones.director });
    check('el director marca su propia entrada (sin horario, 200 o 422 explicado)', [200, 422].includes(r.status), r);

    seccion('6. API AsisLock');
    const RUTA = '/api/integraciones/asislock/v1';
    r = await http('GET', `${RUTA}/salud`, { headers: { 'x-api-key': API_KEY } });
    check('salud → 200', r.status === 200, r);
    r = await http('POST', `${RUTA}/registros`, { body: { registros: [] } });
    check('sin clave → 401', r.status === 401, r);
    r = await http('POST', `${RUTA}/registros`, { headers: { 'x-api-key': 'mala' }, body: { registros: [] } });
    check('clave errada → 401', r.status === 401, r);
    const fila = (id, horaLogin, horaLogout, usuario = CEDULA_E4) => ({ id, usuario, fecha: HOY, hora_login: horaLogin, hora_logout: horaLogout, estado_conexion: 'CONECTADO', aplicativo: 'E2E' });
    const enviar = (registros) => http('POST', `${RUTA}/registros`, { headers: { 'x-api-key': API_KEY }, body: { registros } });
    r = await enviar([{ ...fila(ASISLOCK_IDS[0], horaBog(mas(-230)), null), id: String(ASISLOCK_IDS[0]) }]);
    check('id como texto → 400 (el error que vio AsisLock)', r.status === 400 && JSON.stringify(r.body).includes('registros[0].id'), r);
    r = await enviar([{ ...fila(ASISLOCK_IDS[0], horaBog(mas(-230)), null), id: 0 }]);
    check('id 0 → 400', r.status === 400, r);

    // login hace 230 min → entrada
    r = await enviar([fila(ASISLOCK_IDS[0], horaBog(mas(-230)), null)]);
    check('login → entrada', r.status === 200 && JSON.stringify(r.body).includes('"entrada"'), r.body);
    r = await enviar([fila(ASISLOCK_IDS[0], horaBog(mas(-230)), null)]);
    check('reenvío del mismo login → duplicado', JSON.stringify(r.body).includes('duplicado'), r.body);
    // logout hace 120 min → desconexión (antes de la ventana de salida)
    r = await enviar([fila(ASISLOCK_IDS[0], horaBog(mas(-230)), horaBog(mas(-120)))]);
    check('logout temprano → desconexión', JSON.stringify(r.body).includes('desconexion'), r.body);
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e4 });
    check('empleado4 aparece desconectado (en_pausa)', hoy.body.estado === 'en_pausa', { estado: hoy.body.estado });
    r = await http('POST', '/api/asistencia/mi-jornada/pausa', { token: sesiones.e4, body: { tipo: 'bano' } });
    check('no puede iniciar baño mientras está desconectado → 422', r.status === 422, r);
    // login hace 100 min → reconexión
    r = await enviar([fila(ASISLOCK_IDS[1], horaBog(mas(-100)), null)]);
    check('nuevo login → reconexión', JSON.stringify(r.body).includes('reconexion'), r.body);
    // logout ahora (salida en 5 min, ventana de 10) → salida
    r = await enviar([fila(ASISLOCK_IDS[1], horaBog(mas(-100)), horaBog(mas(-1)))]);
    check('logout dentro de la ventana → salida', JSON.stringify(r.body).includes('"salida"'), r.body);
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e4 });
    check('jornada de empleado4 finalizada', hoy.body.estado === 'finalizada', hoy.body.estado);
    const [copias] = await db.query('SELECT asislock_id, usuario, hora_login, hora_logout, estado_conexion FROM login_biometrico WHERE asislock_id IN (?) ORDER BY asislock_id', [ASISLOCK_IDS.slice(0, 2)]);
    check('login_biometrico: una fila por id, con login y logout (064)', copias.length === 2 && copias.every((c) => c.hora_login && c.hora_logout && c.usuario === CEDULA_E4), copias);
    check("login_biometrico: estado_conexion como texto ('CONECTADO')", copias.every((c) => c.estado_conexion === 'CONECTADO'), copias);
    r = await enviar([fila(ASISLOCK_IDS[0], horaBog(mas(-230)), null)]);
    const [[sigueConLogout]] = await db.query('SELECT hora_logout FROM login_biometrico WHERE asislock_id = ?', [ASISLOCK_IDS[0]]);
    check('reenvío atrasado sin logout no borra el logout guardado', r.status === 200 && sigueConLogout.hora_logout !== null, sigueConLogout);
    check('minutos trabajados ≈ 229 − 20 desconectado = 209', Math.abs((hoy.body.minutos_trabajados ?? 0) - 209) <= 2, hoy.body.minutos_trabajados);
    r = await enviar([fila(ASISLOCK_IDS[2], horaBog(mas(-50)), null, '0000000001')]);
    check('cédula inexistente → rechazado empleado_no_encontrado', JSON.stringify(r.body).includes('empleado_no_encontrado'), r.body);
    r = await enviar([fila(ASISLOCK_IDS[3], horaBog(mas(60)), null, '9000000006')]);
    check('hora en el futuro → rechazado hora_futura', JSON.stringify(r.body).includes('hora_futura'), r.body);
    const [[{ orig }]] = await db.query(
        "SELECT COUNT(*) AS orig FROM jornada_evento e JOIN jornada j ON j.idjornada = e.jornada_id WHERE j.users_company_id = ? AND j.fecha = ? AND e.origen = 'asislock'",
        [EMP.e4, HOY]
    );
    check("eventos de empleado4 guardados con origen='asislock' (4)", orig === 4, orig);

    seccion('6b. API AsisLock sin id (otro sistema, migración 064)');
    // empleado5 no tiene horario hoy: todo logout es desconexión.
    const sinId = (horaLogin, horaLogout) => ({ usuario: CEDULA_E5, fecha: HOY, hora_login: horaLogin, hora_logout: horaLogout, estado_conexion: 1, aplicativo: 'E2E sin id', conectado_biometrico: 'Teletrabajo' });
    const loginSinId = horaBog(mas(-200));
    const logoutSinId = horaBog(mas(-100));
    r = await enviar([sinId(loginSinId, null)]);
    check('login sin id → entrada', r.status === 200 && r.body.resultados[0].id === null && r.body.resultados[0].login?.accion === 'entrada', r.body);
    r = await enviar([sinId(loginSinId, null)]);
    check('reenvío del login sin id → duplicado', r.body.resultados?.[0].login?.resultado === 'duplicado', r.body);
    r = await enviar([{ ...sinId(null, logoutSinId), estado_conexion: 0, conectado_biometrico: null }]);
    check('logout suelto sin id → desconexión', r.body.resultados?.[0].logout?.accion === 'desconexion', r.body);
    r = await enviar([{ ...sinId(null, logoutSinId), estado_conexion: 0, conectado_biometrico: null }]);
    check('reenvío del logout sin id → duplicado', r.body.resultados?.[0].logout?.resultado === 'duplicado', r.body);
    // La sección 6 dejó una sesión con id de esta misma cédula (990004, abierta): no debe tocarla.
    let [sesionesE5] = await db.query('SELECT asislock_id, hora_login, hora_logout, conectado_biometrico FROM login_biometrico WHERE usuario = ? AND fecha = ? AND asislock_id IS NULL', [CEDULA_E5, HOY]);
    const [[conId]] = await db.query('SELECT hora_logout FROM login_biometrico WHERE asislock_id = ?', [ASISLOCK_IDS[3]]);
    check('el logout sin id no cierra la sesión con id de la misma cédula', conId.hora_logout === null, conId);
    check('login_biometrico: el logout sin id cerró su sesión abierta (1 fila, conserva Teletrabajo)',
        sesionesE5.length === 1 && sesionesE5[0].asislock_id === null && sesionesE5[0].hora_login === loginSinId
            && sesionesE5[0].hora_logout === logoutSinId && sesionesE5[0].conectado_biometrico === 'Teletrabajo', sesionesE5);
    r = await enviar([sinId(horaBog(mas(-50)), null)]);
    check('nuevo login sin id → reconexión', r.body.resultados?.[0].login?.accion === 'reconexion', r.body);
    [sesionesE5] = await db.query('SELECT 1 FROM login_biometrico WHERE usuario = ? AND fecha = ? AND asislock_id IS NULL', [CEDULA_E5, HOY]);
    check('login_biometrico: la segunda sesión es otra fila (2)', sesionesE5.length === 2, sesionesE5.length);

    seccion('6c. Lo que reporta AsisLock en las pantallas (§30)');
    r = await http('GET', '/api/asistencia/equipo', { token: sesiones.director });
    const e5Equipo = r.body.find?.((e) => e.users_company_id === EMP.e5);
    const e4Equipo = r.body.find?.((e) => e.users_company_id === EMP.e4);
    check('Equipo hoy: empleado5 entró en teletrabajo y está conectado',
        e5Equipo?.asislock?.modalidad === 'teletrabajo' && e5Equipo.asislock.conectado === true && horaBog(new Date(e5Equipo.asislock.primer_login)) === loginSinId, e5Equipo?.asislock);
    check('Equipo hoy: empleado4 (sin dato de biométrico) aparece desconectado tras su logout',
        e4Equipo?.asislock?.modalidad === null && e4Equipo.asislock.conectado === false && e4Equipo.asislock.aplicativo === 'E2E', e4Equipo?.asislock);
    check('Equipo hoy: quien no tiene registros de AsisLock lleva asislock null',
        r.body.find?.((e) => e.users_company_id === EMP.e1)?.asislock === null, r.body.find?.((e) => e.users_company_id === EMP.e1)?.asislock);
    r = await http('GET', `/api/asistencia/equipo/${EMP.e5}/jornada/${HOY}/trazabilidad`, { token: sesiones.director });
    const regE5 = r.body.asislock?.registros ?? [];
    check('trazabilidad del jefe: los 3 avisos de empleado5 (login, logout, login) con su resultado',
        regE5.map((x) => `${x.evento}:${x.accion}`).join(',') === 'login:entrada,logout:desconexion,login:reconexion', regE5);
    check('trazabilidad: el login lleva la modalidad y el logout no', regE5[0]?.modalidad === 'teletrabajo' && regE5[1]?.modalidad === null, regE5);
    hoy = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: sesiones.e4 });
    check('Mi jornada: empleado4 ve su último evento de AsisLock (logout)', hoy.body.asislock?.ultimo_evento?.evento === 'logout', hoy.body.asislock);

    seccion('7. Cuenta de empleado por cédula (063, en cuenta_empleado desde la 065)');
    const [[enUsers]] = await db.query(
        `SELECT COUNT(*) AS n FROM users u JOIN users_company uc ON uc.id = u.users_company_id
          WHERE u.role = 'empleado' AND u.username = TRIM(uc.numero_identificacion)`
    );
    check('ninguna cuenta por cédula quedó en users (065)', enUsers.n === 0, enUsers);
    const [[cuenta]] = await db.query(
        `SELECT idcuenta_empleado AS id, usuario AS username, password, debe_cambiar_password, users_company_id AS ficha
           FROM cuenta_empleado WHERE debe_cambiar_password = 1 LIMIT 1`
    );
    if (!cuenta) {
        check('existe una cuenta de empleado con cambio pendiente', false, 'correr scripts/crearCuentasEmpleados.js --aplicar');
    } else {
        try {
            const ses = await login(cuenta.username, cuenta.username);
            check('login con cédula/cédula → 200 con debeCambiarPassword', ses.status === 200 && ses.body.user?.debeCambiarPassword === true, ses.body.user ?? ses);
            check("la sesión es de cuenta de empleado (tipoCuenta 'empleado', rol empleado)", ses.body.user?.tipoCuenta === 'empleado' && ses.body.user?.role === 'empleado', ses.body.user);
            const tk = ses.body.token;
            r = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: tk });
            check('antes de cambiar la clave → 403 CAMBIO_PASSWORD_REQUERIDO', r.status === 403 && r.body.codigo === 'CAMBIO_PASSWORD_REQUERIDO', r);
            r = await http('GET', '/api/auth/me', { token: tk });
            check('/api/auth/me responde con la ficha de la cuenta', r.status === 200 && r.body.tipo_cuenta === 'empleado' && r.body.username === cuenta.username, r);
            r = await http('PUT', '/api/auth/change-password', { token: tk, body: { currentPassword: cuenta.username, newPassword: cuenta.username } });
            check('nueva clave igual a la cédula → 400', r.status === 400, r);
            r = await http('PUT', '/api/auth/change-password', { token: tk, body: { currentPassword: cuenta.username, newPassword: 'E2e-Nueva-123' } });
            check('cambio válido → 200 con token nuevo', r.status === 200 && r.body.token, r);
            const tkNuevo = r.body.token;
            r = await http('GET', '/api/asistencia/mi-jornada/hoy', { token: tkNuevo });
            check('con el token nuevo ya entra a asistencia', r.status === 200, r);
            r = await http('GET', '/api/users', { token: tkNuevo });
            check('la cuenta de empleado no entra a otros módulos (/api/users) → 403', r.status === 403, r);
            r = await http('GET', '/api/users-company/catalogos', { token: tkNuevo });
            check('ni a RRHH (/api/users-company) → 403', r.status === 403, r);
            r = await login(cuenta.username, cuenta.username);
            check('la cédula ya no sirve como clave → 400', r.status === 400, r);

            // La cuenta de empleado como jefe: empleado5 le reporta solo durante esta prueba.
            const [[cE5]] = await db.query(
                `SELECT c.idcontrato, c.jefe_area_id FROM contrato c
                 JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
                 WHERE c.users_company_id = ? AND ec.nombre IN ('activo', 'periodo_prueba')
                 ORDER BY c.fecha_ingreso DESC LIMIT 1`,
                [EMP.e5]
            );
            await db.query('UPDATE contrato SET jefe_area_id = ? WHERE idcontrato = ?', [cuenta.ficha, cE5.idcontrato]);
            try {
                r = await http('GET', '/api/auth/me', { token: tkNuevo });
                check('la cuenta de empleado con gente a cargo trae es_jefe_equipo = true', r.body?.es_jefe_equipo === true, r.body);
                r = await http('POST', '/api/asistencia/horarios', {
                    token: tkNuevo,
                    body: { empleados: [EMP.e5], desde: HOY, hasta: HOY, hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 60 }
                });
                check('la cuenta de empleado jefe asigna horario a empleado5 → 201', r.status === 201, r);
                const [[asig]] = await db.query('SELECT creado_por_user_id, creado_por_cuenta_id FROM horario_asignado WHERE users_company_id = ? AND fecha = ?', [EMP.e5, HOY]);
                check('horario_asignado guarda la autoría en creado_por_cuenta_id', asig?.creado_por_cuenta_id === cuenta.id && asig?.creado_por_user_id === null, asig);
            } finally {
                await db.query('UPDATE contrato SET jefe_area_id = ? WHERE idcontrato = ?', [cE5.jefe_area_id, cE5.idcontrato]);
                await db.query('DELETE FROM horario_asignado WHERE fecha = ? AND users_company_id = ?', [HOY, EMP.e5]);
            }
        } finally {
            await db.query('UPDATE cuenta_empleado SET password = ?, debe_cambiar_password = ? WHERE idcuenta_empleado = ?', [cuenta.password, cuenta.debe_cambiar_password, cuenta.id]);
            const [[restaurada]] = await db.query('SELECT password FROM cuenta_empleado WHERE idcuenta_empleado = ?', [cuenta.id]);
            check(`cuenta ${cuenta.username} restaurada a su estado original`, await bcrypt.compare(cuenta.username, restaurada.password));
        }
    }
}

main()
    .catch((e) => { fallos++; fallidos.push(`excepción: ${e.message}`); console.error(e); })
    .finally(async () => {
        if (!process.argv.includes('--conservar')) await limpiar().catch((e) => console.error('limpieza:', e.message));
        if (servidor) servidor.kill();
        console.log(`\nResultado: ${ok} OK · ${fallos} fallos`);
        if (fallidos.length) console.log(fallidos.map((f) => ` - ${f}`).join('\n'));
        process.exit(fallos ? 1 : 0);
    });
