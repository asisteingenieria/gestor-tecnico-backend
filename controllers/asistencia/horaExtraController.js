const horaExtraService = require('../../services/asistencia/horaExtraService');

async function solicitar(req, res) {
    const resultado = await horaExtraService.solicitar({
        usersCompanyId: req.user.users_company_id,
        fecha: req.body.fecha,
        minutosEstimados: req.body.minutos_estimados,
        motivo: req.body.motivo,
        solicitadoPorUserId: req.user.id
    });
    res.status(201).json(resultado);
}

async function misHorasExtra(req, res) {
    const resultado = await horaExtraService.misHorasExtra({
        usersCompanyId: req.user.users_company_id,
        estado: req.query.estado
    });
    res.json(resultado);
}

async function bandeja(req, res) {
    const resultado = await horaExtraService.bandeja({
        directorUsersCompanyId: req.user.users_company_id,
        estado: req.query.estado
    });
    res.json(resultado);
}

async function aprobar(req, res) {
    const resultado = await horaExtraService.aprobar({
        directorUsersCompanyId: req.user.users_company_id,
        idhoraExtra: Number(req.params.id),
        minutosAprobados: req.body.minutos_aprobados,
        comentario: req.body.comentario,
        aprobadoPorUserId: req.user.id
    });
    res.json(resultado);
}

async function rechazar(req, res) {
    const resultado = await horaExtraService.rechazar({
        directorUsersCompanyId: req.user.users_company_id,
        idhoraExtra: Number(req.params.id),
        comentario: req.body.comentario,
        aprobadoPorUserId: req.user.id
    });
    res.json(resultado);
}

async function asignar(req, res) {
    const resultado = await horaExtraService.asignar({
        directorUsersCompanyId: req.user.users_company_id,
        empleados: req.body.empleados,
        fecha: req.body.fecha,
        minutos: req.body.minutos,
        motivo: req.body.motivo,
        aprobadoPorUserId: req.user.id
    });
    res.status(201).json(resultado);
}

module.exports = { solicitar, misHorasExtra, bandeja, aprobar, rechazar, asignar };
