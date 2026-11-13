const { ReglaAsistenciaError } = require('../../errors/AppError');
const { combinarFechaHora } = require('../../utils/fechaBogota');

function assertPuedeIniciarPausa(estadoCalculado, tipo) {
    if (estadoCalculado.estado === 'pendiente') {
        throw new ReglaAsistenciaError('No se puede iniciar una pausa sin haber marcado entrada');
    }
    if (estadoCalculado.estado === 'finalizada') {
        throw new ReglaAsistenciaError('La jornada ya fue finalizada');
    }
    if (estadoCalculado.pausaActiva) {
        throw new ReglaAsistenciaError(`Ya hay una pausa de ${estadoCalculado.pausaActiva.tipo} activa`);
    }
    if (estadoCalculado.desconexionActiva) {
        throw new ReglaAsistenciaError('Estás desconectado de AsisLock: vuelve a iniciar sesión allí para continuar la jornada');
    }
}

function assertPuedeFinalizarPausa(estadoCalculado, tipo) {
    if (!estadoCalculado.pausaActiva) {
        throw new ReglaAsistenciaError('No hay una pausa activa para cerrar');
    }
    if (estadoCalculado.pausaActiva.tipo !== tipo) {
        throw new ReglaAsistenciaError(`La pausa activa es de ${estadoCalculado.pausaActiva.tipo}, no de ${tipo}`);
    }
}

function assertPuedeMarcarSalida(estadoCalculado) {
    if (estadoCalculado.estado === 'pendiente') {
        throw new ReglaAsistenciaError('No se puede marcar salida sin haber marcado entrada');
    }
    if (estadoCalculado.estado === 'finalizada') {
        throw new ReglaAsistenciaError('La jornada ya fue finalizada');
    }
    if (!estadoCalculado.puedeMarcarSalida) {
        throw new ReglaAsistenciaError('Aún no se habilita el marcaje de salida');
    }
}

// "No ha llegado" (asistencia.md §62): sin entrada hoy, con turno de trabajo y la hora de entrada ya
// pasó. Sin horario o en su día de descanso no se sabe si debía venir: no cuenta. El estado 'ausente'
// lo pone el cierre nocturno; esto es su equivalente en vivo, durante el día.
function noHaLlegado(estadoCalculado, horario, ahora) {
    if (estadoCalculado.estado !== 'pendiente') return false;
    if (!horario || horario.es_descanso || !horario.hora_entrada) return false;
    return ahora >= combinarFechaHora(horario.fecha, horario.hora_entrada);
}

module.exports = {
    noHaLlegado,
    assertPuedeIniciarPausa,
    assertPuedeFinalizarPausa,
    assertPuedeMarcarSalida
};
