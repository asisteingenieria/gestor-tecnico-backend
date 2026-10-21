const asislockService = require('../../services/asistencia/asislockService');
const pantallaGrisService = require('../../services/asistencia/pantallaGrisService');

async function recibirRegistros(req, res) {
    const resultados = await asislockService.recibirRegistros(req.body.registros);
    res.json({ success: true, resultados });
}

async function salud(req, res) {
    res.json({ success: true, servicio: 'gestor-asistencia', servidor_ahora: new Date().toISOString() });
}

// Pantalla gris (asistencia.md §31).
async function validarPantallaGris(req, res) {
    res.json(await pantallaGrisService.validar({ usuario: req.body.usuario, clave: req.body.clave }));
}

async function cambiarClavePantallaGris(req, res) {
    res.json(await pantallaGrisService.cambiarClave({
        usuario: req.body.usuario,
        claveActual: req.body.clave_actual,
        claveNueva: req.body.clave_nueva
    }));
}

async function listarUsuariosPantallaGris(req, res) {
    res.json(await pantallaGrisService.listarUsuarios());
}

module.exports = { recibirRegistros, salud, validarPantallaGris, cambiarClavePantallaGris, listarUsuariosPantallaGris };
