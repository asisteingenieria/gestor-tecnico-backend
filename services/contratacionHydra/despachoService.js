const config = require('../../config/integracionHydra');
const { NoEncontradoError, ReglaContratacionError } = require('../../errors/AppError');
const envioRepo = require('../../repositories/contratacionHydra/envioRepository');
const clienteHydra = require('./clienteHydra');
const { enTransaccion } = require('./transaccion');
const { decidirResultadoEnvio, RUTA_POR_TIPO } = require('../../domain/contratacionHydra');

// Despacho del outbox hacia Hydra (conexionhydra.md §7.1). Lo corre
// scripts/despacharEnviosHydra.js por cron. Cada envío va en su propia transacción: la
// fila queda bloqueada (SKIP LOCKED) mientras dura la llamada HTTP, que tiene timeout.

async function despacharUno() {
    return enTransaccion(async (conn) => {
        const envio = await envioRepo.findSiguienteParaDespacho(conn);
        if (!envio) return null;

        const resultado = await clienteHydra.enviar(RUTA_POR_TIPO[envio.tipo], envio.payload, envio.idempotency_key);
        const decision = decidirResultadoEnvio(
            { status: resultado.status, codigo: resultado.codigo, intentosPrevios: envio.intentos },
            config.outbox
        );
        await envioRepo.registrarResultado(envio.idhydra_envio_saliente, { ...decision, error: resultado.error }, conn);

        return { id: envio.idhydra_envio_saliente, tipo: envio.tipo, estado: decision.estado, error: resultado.error };
    });
}

async function despacharPendientes() {
    if (!config.salidaConfigurada) {
        return { configurado: false, procesados: [] };
    }
    const procesados = [];
    for (let i = 0; i < config.outbox.enviosPorCorrida; i += 1) {
        const resultado = await despacharUno();
        if (!resultado) break;
        procesados.push(resultado);
    }
    return { configurado: true, procesados };
}

async function listarEnvios({ estado }) {
    return { success: true, configurado: config.salidaConfigurada, envios: await envioRepo.findAll({ estado }) };
}

async function reintentarEnvio(id) {
    const estado = await envioRepo.findEstadoById(id);
    if (!estado) throw new NoEncontradoError('El envío no existe');
    if (!(await envioRepo.reintentar(id))) {
        throw new ReglaContratacionError(`Solo se puede reintentar un envío fallido (este está "${estado}")`);
    }
    return { success: true, message: 'El envío se reintentará en la próxima corrida del despachador' };
}

module.exports = { despacharPendientes, listarEnvios, reintentarEnvio };
