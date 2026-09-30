const { ReglaAsistenciaError } = require('../../errors/AppError');

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

module.exports = {
    assertPuedeIniciarPausa,
    assertPuedeFinalizarPausa,
    assertPuedeMarcarSalida
};
