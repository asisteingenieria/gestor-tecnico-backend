// Datos del pasivo vacacional del equipo de un jefe (claude/modulo recursoshumanos.md §58.6). El SQL es el mismo
// del pasivo de RRHH (models/PasivoVacacional.js), filtrado por las fichas del árbol: no se duplica la consulta.
const PasivoVacacional = require('../../models/PasivoVacacional');

const empleadosDe = (ids, fecha) => PasivoVacacional.getEmpleados(fecha, ids);
const novedadesVacacionesDe = (ids) => PasivoVacacional.getNovedadesVacaciones(ids);
const fechaCorteExcel = () => PasivoVacacional.fechaCorteExcel();

module.exports = { empleadosDe, novedadesVacacionesDe, fechaCorteExcel };
