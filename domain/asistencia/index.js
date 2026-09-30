const calcularJornada = require('./calcularJornada');
const reglas = require('./reglasJornada');
const estados = require('./estadosJornada');

module.exports = {
    calcularJornada,
    ...reglas,
    ...estados
};
