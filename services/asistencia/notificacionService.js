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

module.exports = { notificarDirector };
