const equipoRepo = require('../../repositories/asistencia/equipoRepository');

// Best-effort: una notificación fallida nunca debe tumbar el marcaje que la originó.
async function notificarDirector(usersCompanyId, evento, datos = {}) {
    try {
        const directorUserId = await equipoRepo.directorUserIdDe(usersCompanyId);
        if (!directorUserId) return;
        global.sendMessageToUser(directorUserId, 'asistencia:evento', { tipo: evento, usersCompanyId, ...datos });
    } catch (error) {
        console.error('[asistencia] Error notificando al director:', error.message);
    }
}

// Cambió la jornada de un empleado (marcaje en el portal o aviso de AsisLock): su monitor y el
// "Equipo hoy" de su jefe recargan solos, sin que nadie tenga que refrescar la página. Va por las
// salas de Socket.IO por ficha (`asistencia:suscribir` en index.js), que sirven igual a cuentas de
// `users` y de `cuenta_empleado`. Solo avisa: cada pantalla vuelve a pedir su estado a la API.
async function notificarCambioJornada(usersCompanyId, evento, datos = {}) {
    try {
        global.emitirAsistencia?.(usersCompanyId, 'asistencia:mi-jornada', { tipo: evento });
        const jefeId = await equipoRepo.jefeAreaDe(usersCompanyId);
        if (jefeId) global.emitirAsistencia?.(jefeId, 'asistencia:equipo', { tipo: evento, usersCompanyId });
    } catch (error) {
        console.error('[asistencia] Error avisando el cambio de jornada:', error.message);
    }
    await notificarDirector(usersCompanyId, evento, datos);
}

module.exports = { notificarDirector, notificarCambioJornada };
