const db = require('../../config/db');
const config = require('../../config/integracionAsislock');
const envioRepo = require('../../repositories/asistencia/asislockEnvioRepository');
const { decidirResultadoEnvio } = require('../../domain/contratacionHydra');

// Despacho del outbox hacia AsisLock (asistencia.md §31). Lo corre
// scripts/despacharEnviosAsislock.js por cron. Cada aviso va en su propia transacción: la fila
// queda bloqueada (SKIP LOCKED) mientras dura la llamada HTTP, que tiene timeout. La política
// de reintentos es la misma del outbox hacia Hydra.

/** POST <ASISLOCK_CALLBACK_URL>/usuarios. Nunca lanza por la respuesta: devuelve { status, codigo, error }. */
async function enviar(payload, idempotencyKey) {
    try {
        const respuesta = await fetch(`${config.salida.url}/usuarios`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.salida.apiKey,
                'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(config.outbox.timeoutMs)
        });
        let codigo = null;
        let mensaje = null;
        try {
            const json = await respuesta.json();
            codigo = json?.codigo ?? null;
            mensaje = json?.message ?? json?.mensaje ?? null;
        } catch {
            // Cuerpo vacío o no JSON: basta con el status.
        }
        return {
            status: respuesta.status,
            codigo,
            error: respuesta.ok ? null : `HTTP ${respuesta.status}${codigo ? ` ${codigo}` : ''}${mensaje ? `: ${mensaje}` : ''}`
        };
    } catch (error) {
        return { status: null, codigo: null, error: `Sin respuesta de AsisLock: ${error.cause?.code ?? error.name}` };
    }
}

async function despacharUno() {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const envio = await envioRepo.findSiguienteParaDespacho(conn);
        if (!envio) {
            await conn.commit();
            return null;
        }
        const payload = typeof envio.payload === 'string' ? JSON.parse(envio.payload) : envio.payload;
        const resultado = await enviar(payload, envio.idempotency_key);
        const decision = decidirResultadoEnvio(
            { status: resultado.status, codigo: resultado.codigo, intentosPrevios: envio.intentos },
            config.outbox
        );
        await envioRepo.registrarResultado(envio.idasislock_envio_saliente, { ...decision, error: resultado.error }, conn);
        await conn.commit();
        return { id: envio.idasislock_envio_saliente, evento: envio.evento, usuario: envio.usuario, estado: decision.estado, error: resultado.error };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function despacharPendientes() {
    if (!config.salidaConfigurada) return { configurado: false, procesados: [] };
    const procesados = [];
    for (let i = 0; i < config.outbox.enviosPorCorrida; i += 1) {
        const resultado = await despacharUno();
        if (!resultado) break;
        procesados.push(resultado);
    }
    return { configurado: true, procesados };
}

module.exports = { despacharPendientes };
