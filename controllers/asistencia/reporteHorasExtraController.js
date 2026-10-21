const reporteService = require('../../services/asistencia/reporteHorasExtraService');
const { autorDe } = require('./autor');

// Reporte mensual de horas extras (asistencia.md §32): el jefe de área lo arma y lo envía;
// financiera lo revisa.

// --- Jefe de área ---

async function miReporte(req, res) {
    res.json(await reporteService.miReporte({
        jefeUsersCompanyId: req.user.users_company_id,
        periodo: req.query.periodo
    }));
}

async function guardarBorrador(req, res) {
    res.json(await reporteService.guardarBorrador({
        jefeUsersCompanyId: req.user.users_company_id,
        periodo: req.body.periodo,
        filas: req.body.filas,
        autor: autorDe(req)
    }));
}

async function enviar(req, res) {
    res.json(await reporteService.enviar({
        jefeUsersCompanyId: req.user.users_company_id,
        periodo: req.body.periodo,
        filas: req.body.filas,
        autor: autorDe(req)
    }));
}

// --- Financiera ---

async function resumenDelPeriodo(req, res) {
    res.json(await reporteService.resumenDelPeriodo({ periodo: req.query.periodo }));
}

async function detalle(req, res) {
    res.json(await reporteService.detalle({ idreporte: Number(req.params.id) }));
}

async function aprobar(req, res) {
    res.json(await reporteService.aprobar({ idreporte: Number(req.params.id), revisadoPorUserId: autorDe(req).userId }));
}

async function devolver(req, res) {
    res.json(await reporteService.devolver({
        idreporte: Number(req.params.id),
        observacion: req.body.observacion,
        revisadoPorUserId: autorDe(req).userId
    }));
}

async function fijarFechaLimite(req, res) {
    res.json(await reporteService.fijarFechaLimite({
        periodo: req.params.periodo,
        fechaLimite: req.body.fecha_limite,
        userId: autorDe(req).userId
    }));
}

module.exports = { miReporte, guardarBorrador, enviar, resumenDelPeriodo, detalle, aprobar, devolver, fijarFechaLimite };
