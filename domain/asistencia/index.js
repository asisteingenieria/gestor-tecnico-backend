const calcularJornada = require('./calcularJornada');
const reglas = require('./reglasJornada');
const estados = require('./estadosJornada');
const asislock = require('./asislock');

module.exports = {
    calcularJornada,
    ...reglas,
    ...estados,
    asislock
};
