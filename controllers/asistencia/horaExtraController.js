const horaExtraService = require('../../services/asistencia/horaExtraService');
const { autorDe } = require('./autor');

async function solicitar(req, res) {
    const resultado = await horaExtraService.solicitar({
        usersCompanyId: req.user.users_company_id,
        fecha: req.body.fecha,
        horaInicio: req.body.hora_inicio,
        horaFin: req.body.hora_fin,
        motivo: req.body.motivo,
        solicitadoPor: autorDe(req)
    });
    res.status(201).json(resultado);
}

async function previsualizar(req, res) {
    const resultado = await horaExtraService.previsualizar({
        usersCompanyId: req.user.users_company_id,
        fecha: req.body.fecha,
        horaInicio: req.body.hora_inicio,
        horaFin: req.body.hora_fin
    });
    res.json(resultado);
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
        tramos: req.body.tramos,
        comentario: req.body.comentario,
        aprobadoPor: autorDe(req)
    });
    res.json(resultado);
}

async function rechazar(req, res) {
    const resultado = await horaExtraService.rechazar({
        directorUsersCompanyId: req.user.users_company_id,
        idhoraExtra: Number(req.params.id),
        comentario: req.body.comentario,
        aprobadoPor: autorDe(req)
    });
    res.json(resultado);
}

async function asignar(req, res) {
    const resultado = await horaExtraService.asignar({
        directorUsersCompanyId: req.user.users_company_id,
        empleados: req.body.empleados,
        fecha: req.body.fecha,
        minutos: req.body.minutos,
        clase: req.body.clase,
        motivo: req.body.motivo,
        aprobadoPor: autorDe(req)
    });
    res.status(201).json(resultado);
}

module.exports = { solicitar, previsualizar, misHorasExtra, bandeja, aprobar, rechazar, asignar };
