const financieraService = require('../../services/asistencia/financieraService');

// Trazabilidad de asistencia por campaña para financiera (asistencia.md §32).

async function campanias(req, res) {
    res.json(await financieraService.campanias());
}

async function empleados(req, res) {
    res.json(await financieraService.empleados({ campaniaId: req.query.campania_id ? Number(req.query.campania_id) : null }));
}

async function jornadasDe(req, res) {
    res.json(await financieraService.jornadasDe({
        empleadoId: Number(req.params.empleadoId),
        desde: req.query.desde,
        hasta: req.query.hasta
    }));
}

async function trazabilidadDe(req, res) {
    res.json(await financieraService.trazabilidadDe({ empleadoId: Number(req.params.empleadoId), fecha: req.params.fecha }));
}

module.exports = { campanias, empleados, jornadasDe, trazabilidadDe };
