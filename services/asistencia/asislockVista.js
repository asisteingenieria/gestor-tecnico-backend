const registroRepo = require('../../repositories/asistencia/asislockRegistroRepository');
const { asislock } = require('../../domain/asistencia');

// Lo que AsisLock reportó de un día, para mostrarlo al empleado y a su jefe (Mi jornada,
// Equipo hoy y trazabilidad). Solo lectura: el cálculo de la jornada no depende de esto.

const iso = (fecha) => (fecha instanceof Date ? fecha.toISOString() : fecha ?? null);

function aVista(r) {
    return {
        evento: r.evento,
        ocurrido_en: iso(r.ocurrido_en),
        resultado: r.resultado,
        accion: r.accion,
        motivo: r.motivo,
        modalidad: asislock.modalidadIngreso(r.conectado_biometrico),
        conectado_biometrico: r.conectado_biometrico,
        estado_conexion: r.estado_conexion,
        ip_local: r.ip_local,
        ip_publica: r.ip_publica,
        aplicativo: r.aplicativo
    };
}

// { [users_company_id]: resumen | null } con una sola consulta para todo el equipo.
async function resumenesDelDia(usersCompanyIds, fecha) {
    const filas = await registroRepo.findDelDia(usersCompanyIds, fecha);
    const porEmpleado = new Map(usersCompanyIds.map((id) => [id, []]));
    for (const fila of filas) porEmpleado.get(fila.users_company_id)?.push(aVista(fila));
    return Object.fromEntries([...porEmpleado].map(([id, registros]) => [id, asislock.resumenDelDia(registros)]));
}

async function delDia(usersCompanyId, fecha) {
    const registros = (await registroRepo.findDelDia([usersCompanyId], fecha)).map(aVista);
    return { resumen: asislock.resumenDelDia(registros), registros };
}

module.exports = { resumenesDelDia, delDia };
