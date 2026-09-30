const consultaService = require('../../services/asistencia/consultaService');

async function miHorario(req, res) {
    const resultado = await consultaService.miHorario({
        usersCompanyId: req.user.users_company_id,
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

async function estadoDeHoy(req, res) {
    const resultado = await consultaService.estadoDeHoy(req.user.users_company_id);
    res.json(resultado);
}

async function trazabilidad(req, res) {
    const resultado = await consultaService.trazabilidad({
        usersCompanyId: req.user.users_company_id,
        fecha: req.params.fecha
    });
    res.json(resultado);
}

async function misJornadas(req, res) {
    const resultado = await consultaService.misJornadas({
        usersCompanyId: req.user.users_company_id,
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

async function misEstadisticas(req, res) {
    const resultado = await consultaService.misEstadisticas({
        usersCompanyId: req.user.users_company_id,
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

module.exports = { miHorario, estadoDeHoy, trazabilidad, misJornadas, misEstadisticas };
