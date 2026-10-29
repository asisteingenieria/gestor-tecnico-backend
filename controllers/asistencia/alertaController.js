const alertaService = require('../../services/asistencia/alertaService');
const notificacionAsistenciaService = require('../../services/asistencia/notificacionAsistenciaService');
const { autorDe } = require('./autor');

// Destinatario de las notificaciones de asistencia (084): mi ficha y, si no es cuenta de empleado, mi usuario.
const sesionDe = (req) => ({ usersCompanyId: req.user.users_company_id, userId: autorDe(req).userId });

async function misAlertas(req, res) {
    const resultado = await alertaService.misAlertas({ usersCompanyId: req.user.users_company_id });
    res.json(resultado);
}

async function marcarLeida(req, res) {
    const resultado = await alertaService.marcarLeida({
        usersCompanyId: req.user.users_company_id,
        idalerta: Number(req.params.id)
    });
    res.json(resultado);
}

async function misNotificaciones(req, res) {
    res.json(await notificacionAsistenciaService.misNotificaciones(sesionDe(req)));
}

async function marcarNotificacionLeida(req, res) {
    res.json(await notificacionAsistenciaService.marcarLeida(Number(req.params.id), sesionDe(req)));
}

async function marcarTodasLeidas(req, res) {
    res.json(await notificacionAsistenciaService.marcarTodasLeidas(sesionDe(req)));
}

module.exports = { misAlertas, marcarLeida, misNotificaciones, marcarNotificacionLeida, marcarTodasLeidas };
