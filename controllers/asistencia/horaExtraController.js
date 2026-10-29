const horaExtraService = require('../../services/asistencia/horaExtraService');
const { autorDe } = require('./autor');

// El jefe solicita por su equipo (§51): `empleados` es la lista de fichas.
async function solicitar(req, res) {
    const resultado = await horaExtraService.solicitar({
        jefeUsersCompanyId: req.user.users_company_id,
        empleados: req.body.empleados,
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
        jefeUsersCompanyId: req.user.users_company_id,
        empleados: req.body.empleados,
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

async function misSolicitudes(req, res) {
    res.json(await horaExtraService.misSolicitudes({ jefeUsersCompanyId: req.user.users_company_id, estado: req.query.estado }));
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

module.exports = { solicitar, previsualizar, misHorasExtra, misSolicitudes, bandeja, aprobar, rechazar };
