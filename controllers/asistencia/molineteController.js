const molineteService = require('../../services/asistencia/molineteService');

// API del intermediario del molinete (asistencia.md §80).

async function salud(req, res) {
    res.json({ success: true, servicio: 'gestor-molinete', servidor_ahora: new Date().toISOString() });
}

// Desde dónde leer el molinete y qué áreas: el intermediario no guarda estado propio.
async function estadoLectura(req, res) {
    res.json({ success: true, ...(await molineteService.estadoLectura()) });
}

async function recibirMarcaciones(req, res) {
    res.json({ success: true, ...(await molineteService.recibirLote(req.body.marcaciones)) });
}

module.exports = { salud, estadoLectura, recibirMarcaciones };
