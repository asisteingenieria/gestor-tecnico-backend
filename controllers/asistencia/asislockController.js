const asislockService = require('../../services/asistencia/asislockService');
const pantallaGrisService = require('../../services/asistencia/pantallaGrisService');
const asislockConsultaService = require('../../services/asistencia/asislockConsultaService');

async function recibirRegistros(req, res) {
    const resultados = await asislockService.recibirRegistros(req.body.registros);
    res.json({ success: true, resultados });
}

async function salud(req, res) {
    res.json({ success: true, servicio: 'gestor-asistencia', servidor_ahora: new Date().toISOString() });
}

// Consultas por cédula (asistencia.md §58): horario con modalidad y estados del día.
async function horarioEmpleado(req, res) {
    res.json(await asislockConsultaService.horarioPorCedula({
        cedula: req.params.cedula,
        desde: req.query.desde,
        hasta: req.query.hasta
    }));
}

async function estadoEmpleado(req, res) {
    res.json(await asislockConsultaService.estadoPorCedula({ cedula: req.params.cedula, fecha: req.query.fecha }));
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

module.exports = { recibirRegistros, salud, horarioEmpleado, estadoEmpleado, validarPantallaGris, cambiarClavePantallaGris, listarUsuariosPantallaGris };
