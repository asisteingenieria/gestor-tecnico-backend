const calcularJornada = require('./calcularJornada');
const reglas = require('./reglasJornada');
const estados = require('./estadosJornada');
const asislock = require('./asislock');
const pantallaGris = require('./pantallaGris');

module.exports = {
    calcularJornada,
    ...reglas,
    ...estados,
    asislock,
    pantallaGris
};
