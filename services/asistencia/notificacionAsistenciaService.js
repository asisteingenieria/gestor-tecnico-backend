const notificacionRepo = require('../../repositories/asistencia/notificacionAsistenciaRepository');
const { NoEncontradoError } = require('../../errors/AppError');

// Campana del portal (migración 084): las notificaciones de asistencia dirigidas a mi ficha o a mi
// usuario. `sesion` = { usersCompanyId, userId } (userId null en una cuenta de empleado).
async function misNotificaciones(sesion) {
    return notificacionRepo.findPara(sesion);
}

async function marcarLeida(id, sesion) {
    const ok = await notificacionRepo.marcarLeida(id, sesion);
    if (!ok) throw new NoEncontradoError('Notificación no encontrada');
    return { success: true };
}

async function marcarTodasLeidas(sesion) {
    await notificacionRepo.marcarTodasLeidas(sesion);
    return { success: true };
}

// Después del commit: avisa por socket a cada destinatario para que su campana recargue. Las fichas
// por su sala (`asistencia:<users_company_id>`); financiera por la sala de monitores, que es solo
// suya (index.js). Best-effort: un socket caído no deshace lo que ya se guardó.
function avisarEnVivo(notificaciones) {
    try {
        const fichas = new Set(notificaciones.map((n) => n.usersCompanyId).filter(Boolean));
        for (const ficha of fichas) global.emitirAsistencia?.(ficha, 'asistencia:notificacion', {});
        if (notificaciones.some((n) => n.userId)) global.emitirMonitoresAsistencia?.('asistencia:notificacion', {});
    } catch (error) {
        console.error('[asistencia] Error avisando notificaciones:', error.message);
    }
}

module.exports = { misNotificaciones, marcarLeida, marcarTodasLeidas, avisarEnVivo };
