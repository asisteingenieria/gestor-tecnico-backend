// Verifica, sin escribir nada, que este servidor está listo para la conexión con Hydra
// (conexionhydra.md §14, Fase 9). Correrlo en el servidor de Gestor después de poner el
// .env y aplicar las migraciones 059-061, y antes de la prueba con un candidato:
//
//   node scripts/verificarConexionHydra.js
//   node scripts/verificarConexionHydra.js --gestor-url http://127.0.0.1:5001/api/integraciones/hydra/v1
//
// Revisa: credenciales en el .env (sin mostrarlas), versión de MySQL, tablas del staging,
// salud de Hydra y que Hydra acepte la firma de Gestor. Con --gestor-url además firma una
// consulta contra el propio Gestor con las credenciales de entrada (útil para probar el
// camino por nginx). Sale con código 1 si algo falla.

require('dotenv').config({ quiet: true });
const db = require('../config/db');
const config = require('../config/integracionHydra');
const { firmar } = require('../utils/firmaHydra');
const diagnostico = require('../repositories/contratacionHydra/diagnosticoRepository');

const resultados = [];
const anotar = (ok, que, detalle = '') => {
    resultados.push(ok);
    console.log(`${ok ? '  OK ' : ' FALLA'}  ${que}${detalle ? ` — ${detalle}` : ''}`);
};

function argumento(nombre) {
    const i = process.argv.indexOf(nombre);
    return i > -1 ? process.argv[i + 1] : null;
}

// MySQL 8.0+ (SKIP LOCKED) o MariaDB 10.6+.
function versionSoportada(version) {
    const [mayor, menor] = version.split('.').map((n) => parseInt(n, 10));
    if (/mariadb/i.test(version)) return mayor > 10 || (mayor === 10 && menor >= 6);
    return mayor >= 8;
}

async function peticionFirmada(url, metodo, credencial, cuerpo) {
    const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const respuesta = await fetch(url, {
        method: metodo,
        headers: {
            ...(texto ? { 'Content-Type': 'application/json' } : {}),
            'X-Api-Key': credencial.apiKey,
            'X-Timestamp': timestamp,
            'X-Signature': firmar(credencial.secreto, timestamp, texto)
        },
        body: texto || undefined,
        signal: AbortSignal.timeout(config.outbox.timeoutMs)
    });
    return respuesta.status;
}

async function verificarBaseDeDatos() {
    console.log('\nBase de datos');
    const version = await diagnostico.versionMysql();
    anotar(versionSoportada(version), `Versión ${version}`, versionSoportada(version) ? '' : 'el despachador usa FOR UPDATE SKIP LOCKED (MySQL 8+)');

    const tablas = await diagnostico.tablasPresentes();
    const faltantes = tablas.filter((t) => !t.existe).map((t) => t.nombre);
    anotar(faltantes.length === 0, 'Tablas del staging (059-061)', faltantes.length ? `faltan: ${faltantes.join(', ')}` : '');

    if (faltantes.includes('hydra_envio_saliente')) return;
    const outbox = await diagnostico.resumenOutbox();
    console.log(`        Outbox hacia Hydra: ${outbox.length ? outbox.map((f) => `${f.estado} ${f.total}`).join(' · ') : 'vacío'}`);
}

async function verificarHydra() {
    console.log('\nGestor → Hydra (avisos)');
    if (!config.salidaConfigurada) {
        anotar(false, 'HYDRA_CALLBACK_URL / _API_KEY / _HMAC_SECRET', 'faltan en el .env');
        return;
    }
    anotar(true, 'Credenciales de salida en el .env', config.salida.url);

    const salud = `${new URL(config.salida.url).origin}/api/health`;
    try {
        const r = await fetch(salud, { signal: AbortSignal.timeout(config.outbox.timeoutMs) });
        anotar(r.ok, `Salud de Hydra (${salud})`, `HTTP ${r.status}`);
    } catch (error) {
        anotar(false, `Salud de Hydra (${salud})`, `sin respuesta: ${error.cause?.code ?? error.name}`);
        return;
    }

    // Un cuerpo vacío firmado: si la firma pasa, Hydra lo rechaza por validación (400).
    // 401 = clave o secreto no coinciden con GESTOR_CALLBACK_* de Hydra; 503 = Hydra sin
    // configurar. No crea ni cambia nada en Hydra.
    try {
        const status = await peticionFirmada(`${config.salida.url}/descartes`, 'POST', config.salida, {});
        const explicacion = { 400: 'firma aceptada', 401: 'Hydra rechazó la firma: revisar que coincidan con GESTOR_CALLBACK_API_KEY / _HMAC_SECRET', 503: 'Hydra no tiene GESTOR_CALLBACK_* configuradas' };
        anotar(status === 400, 'Hydra acepta la firma de Gestor', `HTTP ${status}${explicacion[status] ? ` · ${explicacion[status]}` : ''}`);
    } catch (error) {
        anotar(false, 'Hydra acepta la firma de Gestor', `sin respuesta: ${error.cause?.code ?? error.name}`);
    }
}

async function verificarEntrada(gestorUrl) {
    console.log('\nHydra → Gestor (lotes)');
    if (!config.configurada) {
        anotar(false, 'HYDRA_API_KEY / HYDRA_HMAC_SECRET', 'faltan en el .env: la API de integración responde 503');
        return;
    }
    anotar(true, 'Credenciales de entrada en el .env');
    if (!gestorUrl) {
        console.log('        (sin --gestor-url: no se prueba el camino HTTP hasta Gestor)');
        return;
    }
    // Candidato inexistente: con firma válida responde 404; 401 = firma rechazada.
    try {
        const status = await peticionFirmada(`${gestorUrl.replace(/\/+$/, '')}/candidatos/999999999`, 'GET', config.credencialesEntrantes[0]);
        anotar(status === 404, `Gestor acepta la firma de Hydra (${gestorUrl})`, `HTTP ${status}${status === 403 ? ' · bloqueado por la lista blanca de nginx' : ''}`);
    } catch (error) {
        anotar(false, `Gestor acepta la firma de Hydra (${gestorUrl})`, `sin respuesta: ${error.cause?.code ?? error.name}`);
    }
}

(async () => {
    try {
        await verificarBaseDeDatos();
        await verificarEntrada(argumento('--gestor-url'));
        await verificarHydra();
    } catch (error) {
        anotar(false, 'Error inesperado', error.message);
    } finally {
        await db.end();
    }
    const fallas = resultados.filter((ok) => !ok).length;
    console.log(fallas ? `\n${fallas} verificación(es) fallaron.` : '\nTodo listo.');
    process.exitCode = fallas ? 1 : 0;
})();
