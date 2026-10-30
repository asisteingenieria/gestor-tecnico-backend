const catalogoRepo = require('../../repositories/contratacionHydra/catalogoRepository');
const loteRepo = require('../../repositories/contratacionHydra/loteRepository');
const candidatoRepo = require('../../repositories/contratacionHydra/candidatoRepository');
const {
    CATALOGOS,
    crearResolverCatalogo,
    mapearPayloadHydra,
    evaluarCompletitud,
    estadoCandidato,
    estadoLote
} = require('../../domain/contratacionHydra');

// Piezas compartidas por la recepción (Fase 2) y la UI de RRHH (Fase 3): cargar el
// resolutor de catálogos y evaluar un candidato de staging.

async function cargarResolver(conn) {
    const [catalogos, mapeos] = await Promise.all([
        catalogoRepo.findCatalogos(CATALOGOS, conn),
        catalogoRepo.findMapeos(conn)
    ]);
    return crearResolverCatalogo({ catalogos, mapeos });
}

// `fecha_ingreso_sugerida` es DATE: mysql2 la entrega como Date a medianoche UTC (el pool
// corre en +00:00), así que el día UTC ES la fecha de negocio guardada.
function fechaDeNegocio(valor) {
    if (!valor) return null;
    if (valor instanceof Date) return valor.toISOString().slice(0, 10);
    return String(valor).slice(0, 10);
}

/**
 * Evalúa un candidato de staging. La lista de valores sin mapear NO se guarda: se
 * recalcula re-mapeando `datos_hydra` con el resolutor vigente, para que un mapeo que
 * RRHH agregue después se aplique sin migrar datos (conexionhydra.md §13.1).
 *
 * @param {object} candidato   fila de hydra_candidato (o equivalente antes de insertar)
 * @param {object} lote        fila de hydra_lote
 * @param {Function} resolver  de cargarResolver
 * @param {Array} verificaciones filas de hydra_candidato_verificacion
 */
function evaluarCandidato({ candidato, lote, resolver, verificaciones = [] }) {
    const { sinMapear } = mapearPayloadHydra(candidato.datos_hydra, resolver, {
        fechaIngresoSugerida: fechaDeNegocio(lote.fecha_ingreso_sugerida)
    });
    const completitud = evaluarCompletitud(candidato.datos_empleado, verificaciones, {
        sinMapear,
        reintegroPendiente: candidato.users_company_existente_id != null
    });
    return {
        completitud,
        sinMapear,
        estado: estadoCandidato(candidato.estado, completitud, candidato.examen_estado)
    };
}

// El estado del lote se deriva de sus candidatos; se recalcula después de cualquier cambio
// a uno de ellos, dentro de la misma transacción (el lote ya debe estar bloqueado).
async function recalcularEstadoLote(lote, conn) {
    const estados = await candidatoRepo.findEstadosByLote(lote.idhydra_lote, conn);
    const nuevo = estadoLote(lote.estado, estados);
    if (nuevo !== lote.estado) await loteRepo.actualizarEstado(lote.idhydra_lote, nuevo, conn);
    return nuevo;
}

module.exports = { cargarResolver, evaluarCandidato, fechaDeNegocio, recalcularEstadoLote };
