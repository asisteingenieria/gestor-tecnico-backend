const equipoService = require('../../services/asistencia/equipoService');
const { autorDe } = require('./autor');

async function permisos(req, res) {
    res.json(await equipoService.permisosEquipo(req.user.users_company_id));
}

// Sin filtros: su equipo. `alcance=todas` o `campania_id`: solo quien ve todas las campañas (§68).
async function equipo(req, res) {
    const resultado = await equipoService.equipo(req.user.users_company_id, {
        alcance: req.query.alcance,
        campaniaId: req.query.campania_id ? Number(req.query.campania_id) : null
    });
    res.json(resultado);
}

async function campanias(req, res) {
    res.json(await equipoService.campaniasVisibles(req.user.users_company_id));
}

async function jornadasDe(req, res) {
    const resultado = await equipoService.jornadasDe({
        directorUsersCompanyId: req.user.users_company_id,
        empleadoId: Number(req.params.empleadoId),
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

async function trazabilidadDe(req, res) {
    const resultado = await equipoService.trazabilidadDe({
        directorUsersCompanyId: req.user.users_company_id,
        empleadoId: Number(req.params.empleadoId),
        fecha: req.params.fecha
    });
    res.json(resultado);
}

async function estadisticasEquipo(req, res) {
    const resultado = await equipoService.estadisticasEquipo({
        directorUsersCompanyId: req.user.users_company_id,
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

async function resumenMensual(req, res) {
    const resultado = await equipoService.resumenMensualEquipo({
        directorUsersCompanyId: req.user.users_company_id,
        periodo: req.query.periodo,
        campaniaId: req.query.campania_id ? Number(req.query.campania_id) : null
    });
    res.json(resultado);
}

async function registrarEventoManual(req, res) {
    const resultado = await equipoService.registrarEventoManual({
        directorUsersCompanyId: req.user.users_company_id,
        jornadaId: Number(req.params.id),
        tipo: req.body.tipo,
        nota: req.body.nota,
        registradoPor: autorDe(req)
    });
    res.json(resultado);
}

module.exports = { permisos, equipo, campanias,jornadasDe, trazabilidadDe, estadisticasEquipo, resumenMensual, registrarEventoManual };
