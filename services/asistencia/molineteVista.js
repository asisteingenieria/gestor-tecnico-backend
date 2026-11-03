const marcacionRepo = require('../../repositories/asistencia/molineteMarcacionRepository');
const { molinete } = require('../../domain/asistencia');
const { combinarFechaHora } = require('../../utils/fechaBogota');

// Lo que registró el molinete en un día (asistencia.md §54), para la trazabilidad: cada paso, con
// los cruces intermedios contados. Solo lectura.

const iso = (fecha) => (fecha instanceof Date ? fecha.toISOString() : fecha ?? null);

function rangoDelDia(fecha) {
    const desde = combinarFechaHora(fecha, '00:00:00');
    return { desde, hasta: new Date(desde.getTime() + 24 * 60 * 60 * 1000) };
}

/** { resumen, marcaciones } o null si esa persona no pasó por el molinete ese día. */
async function delDia(usersCompanyId, fecha) {
    const { desde, hasta } = rangoDelDia(fecha);
    const marcaciones = (await marcacionRepo.findDelDia([usersCompanyId], desde, hasta)).map((m) => ({
        ocurrido_en: iso(m.ocurrido_en),
        sentido: m.sentido,
        lector: m.lector,
        resultado: m.resultado,
        accion: m.accion,
        motivo: m.motivo
    }));
    if (marcaciones.length === 0) return null;
    return { resumen: molinete.resumenDelDia(marcaciones), marcaciones };
}

module.exports = { delDia };
