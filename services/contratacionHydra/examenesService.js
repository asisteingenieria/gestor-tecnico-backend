const { NoEncontradoError } = require('../../errors/AppError');
const loteRepo = require('../../repositories/contratacionHydra/loteRepository');
const candidatoRepo = require('../../repositories/contratacionHydra/candidatoRepository');
const verificacionRepo = require('../../repositories/contratacionHydra/verificacionRepository');
const examenRepo = require('../../repositories/contratacionHydra/examenRepository');
const envioRepo = require('../../repositories/contratacionHydra/envioRepository');
const { cargarResolver, evaluarCandidato, recalcularEstadoLote } = require('./evaluacionService');
const { enTransaccion } = require('./transaccion');
const { aplicarEventoExamen, NOMBRE_EVENTO } = require('../../domain/contratacionHydra');

// Exámenes médicos de SST (migración 089, conexionhydra.md §16): SST marca asistencia y
// resultado; Hydra decide la continuidad de quien no asistió. Cada evento queda en la
// traza, actualiza el estado del examen y recalcula el candidato y el lote en la misma
// transacción. Las marcas de SST se avisan a Hydra por el outbox.

/**
 * Aplica un evento sobre un candidato y su lote ya bloqueados (orden lote → candidato).
 * Lo usan las marcas de SST y la decisión que llega de Hydra.
 */
async function registrarEvento(conn, { lote, candidato, evento, nota, origen, usuarioId, usuarioHydra }) {
    const resultado = aplicarEventoExamen({
        estadoCandidato: candidato.estado,
        examenEstado: candidato.examen_estado,
        evento,
        nota
    });

    const eventoId = await examenRepo.insertar({
        candidatoId: candidato.idhydra_candidato, evento, nota: resultado.nota, origen, usuarioId, usuarioHydra
    }, conn);
    await candidatoRepo.actualizarExamen(candidato.idhydra_candidato, resultado.examenEstado, conn);

    let estado;
    if (resultado.candidatoSale) {
        estado = resultado.candidatoSale;
        const motivo = resultado.candidatoSale === 'no_apto'
            ? `No aprobó los exámenes médicos: ${resultado.nota}`
            : `Selección no da continuidad (no asistió a exámenes médicos)${resultado.nota ? `: ${resultado.nota}` : ''}`;
        await candidatoRepo.actualizarEstado(candidato.idhydra_candidato, estado, motivo.slice(0, 255), conn);
    } else {
        // Aprobar el examen puede dejarlo listo; volver a "asistió" lo saca de listo.
        const resolver = await cargarResolver(conn);
        const verificaciones = await verificacionRepo.findByCandidato(candidato.idhydra_candidato, conn);
        ({ estado } = evaluarCandidato({
            candidato: { ...candidato, examen_estado: resultado.examenEstado }, lote, resolver, verificaciones
        }));
        if (estado !== candidato.estado) {
            await candidatoRepo.actualizarEstado(candidato.idhydra_candidato, estado, null, conn);
        }
    }

    const loteEstado = await recalcularEstadoLote(lote, conn);
    const marca = await examenRepo.findById(eventoId, conn);
    return { estado, examenEstado: resultado.examenEstado, loteEstado, marca };
}

/** Marca de SST: asistió / no asistió / aprobó / no aprobó. */
async function marcarExamen({ id, evento, nota, usuarioId }) {
    return enTransaccion(async (conn) => {
        const base = await candidatoRepo.findById(id, conn);
        if (!base) throw new NoEncontradoError('El candidato no existe');
        const lote = await loteRepo.findByIdParaActualizar(base.hydra_lote_id, conn);
        const candidato = await candidatoRepo.findByIdParaActualizar(id, conn);

        const r = await registrarEvento(conn, { lote, candidato, evento, nota, origen: 'gestor', usuarioId });

        // Aviso a Hydra (conexionhydra.md §16): selección necesita saber sobre todo el
        // "no asistió" (decide la continuidad) y el "no aprobó" (sale del proceso).
        await envioRepo.insertar({
            tipo: 'candidato_examen',
            hydraCandidatoExternoId: candidato.hydra_candidato_externo_id,
            payload: {
                hydra_candidato_id: candidato.hydra_candidato_externo_id,
                evento,
                descripcion: NOMBRE_EVENTO[evento],
                nota: r.marca.nota,
                marcado_por: r.marca.marcado_por,
                marcado_en: new Date(r.marca.creado_en).toISOString(),
                lote_externo_id: lote.lote_externo_id
            }
        }, conn);

        return {
            success: true,
            lote_estado: r.loteEstado,
            candidato: {
                id,
                estado: r.estado,
                examen_estado: r.examenEstado,
                examenes: await examenRepo.findByCandidato(id, conn)
            }
        };
    });
}

async function examenesDeCandidato(id) {
    return examenRepo.findByCandidato(id);
}

module.exports = { registrarEvento, marcarExamen, examenesDeCandidato };
