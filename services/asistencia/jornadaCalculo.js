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
        minutosExtra: estadoCalculado.minutosExtra,
        minutosSalidaAnticipada: estadoCalculado.minutosSalidaAnticipada,
        desviacionAlmuerzoMin: estadoCalculado.desviacionAlmuerzoMin
    };
}

module.exports = { calcularEstadoConDatos, construirTotales };
