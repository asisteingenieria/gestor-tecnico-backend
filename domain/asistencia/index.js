const calcularJornada = require('./calcularJornada');
const reglas = require('./reglasJornada');
const estados = require('./estadosJornada');
const asislock = require('./asislock');
const molinete = require('./molinete');
const pantallaGris = require('./pantallaGris');
const reporteHorasExtra = require('./reporteHorasExtra');

module.exports = {
    calcularJornada,
    ...reglas,
    ...estados,
    asislock,
    molinete,
    pantallaGris,
    reporteHorasExtra
};
