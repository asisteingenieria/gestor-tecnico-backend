const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const parametroRepo = require('../../repositories/asistencia/parametroRepository');
const { calcularJornada } = require('../../domain/asistencia');

// Reúne eventos + horario + horas extra aprobadas + parámetros y llama al dominio.
// Punto único usado por marcajeService y equipoService para que el cálculo en vivo
// y los ajustes manuales del director nunca diverjan.
async function calcularEstadoConDatos(usersCompanyId, fecha, jornadaId, ahora, conn) {
    const eventos = jornadaId ? await eventoRepo.findByJornada(jornadaId, conn) : [];
    const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha, conn);
    const horasExtraAprobadas = await horaExtraRepo.findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha, conn);
    const parametros = await parametroRepo.obtener(conn);
    const estadoCalculado = calcularJornada(eventos, horario, ahora, horasExtraAprobadas, parametros);
    return { estadoCalculado, eventos, horario };
}

// Lo mismo que calcularEstadoConDatos para muchas personas a la vez (tableros en vivo del jefe y de
// financiera, §47): jornadas, eventos, horarios y horas extra en una consulta cada uno, en vez de
// cinco por persona. Devuelve Map users_company_id → { estadoCalculado, horario }.
function agrupar(filas, clave) {
    const mapa = new Map();
    for (const fila of filas) {
        if (!mapa.has(fila[clave])) mapa.set(fila[clave], []);
        mapa.get(fila[clave]).push(fila);
    }
    return mapa;
}

async function calcularEstadosDelDia(usersCompanyIds, fecha, ahora) {
    if (usersCompanyIds.length === 0) return new Map();
    const [jornadas, horarios, horasExtra, parametros] = await Promise.all([
        jornadaRepo.findPorFechaVarios(usersCompanyIds, fecha),
        horarioRepo.findRangoPorEmpleados(usersCompanyIds, fecha, fecha),
        horaExtraRepo.findAprobadasPorEmpleadosYFecha(usersCompanyIds, fecha),
        parametroRepo.obtener()
    ]);
    const jornadaPorEmpleado = new Map(jornadas.map((j) => [j.users_company_id, j]));
    const eventosPorJornada = agrupar(await eventoRepo.findByJornadas(jornadas.map((j) => j.idjornada)), 'jornada_id');
    const horarioPorEmpleado = new Map(horarios.map((h) => [h.users_company_id, h]));
    const horasExtraPorEmpleado = agrupar(horasExtra, 'users_company_id');

    return new Map(usersCompanyIds.map((id) => {
        const jornada = jornadaPorEmpleado.get(id);
        const eventos = jornada ? eventosPorJornada.get(jornada.idjornada) || [] : [];
        const horario = horarioPorEmpleado.get(id) ?? null;
        const estadoCalculado = calcularJornada(eventos, horario, ahora, horasExtraPorEmpleado.get(id) || [], parametros);
        return [id, { estadoCalculado, horario }];
    }));
}

function construirTotales(estadoCalculado, eventos) {
    const entrada = eventos.find((e) => e.tipo === 'entrada');
    const salida = eventos.find((e) => e.tipo === 'salida');
    return {
        estado: estadoCalculado.estado,
        horaEntradaReal: entrada ? entrada.ocurrido_en : null,
        horaSalidaReal: salida ? salida.ocurrido_en : null,
        minutosTarde: estadoCalculado.minutosTarde,
        minutosTrabajados: estadoCalculado.minutosTrabajados,
        minutosPausaBano: estadoCalculado.minutosPausaBano,
        minutosPausaAlmuerzo: estadoCalculado.minutosPausaAlmuerzo,
        minutosBreak: estadoCalculado.minutosBreak,
        minutosCapacitacion: estadoCalculado.minutosCapacitacion,
        minutosDesconexion: estadoCalculado.minutosDesconexion,
        minutosExtra: estadoCalculado.minutosExtra,
        minutosSalidaAnticipada: estadoCalculado.minutosSalidaAnticipada,
        desviacionAlmuerzoMin: estadoCalculado.desviacionAlmuerzoMin
    };
}

module.exports = { calcularEstadoConDatos, calcularEstadosDelDia, construirTotales };
