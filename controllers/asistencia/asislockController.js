const asislockService = require('../../services/asistencia/asislockService');

async function recibirRegistros(req, res) {
    const resultados = await asislockService.recibirRegistros(req.body.registros);
    res.json({ success: true, resultados });
}

async function salud(req, res) {
    res.json({ success: true, servicio: 'gestor-asistencia', servidor_ahora: new Date().toISOString() });
}

module.exports = { recibirRegistros, salud };
