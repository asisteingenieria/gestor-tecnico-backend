const pasivoEquipoRepo = require('../../repositories/asistencia/pasivoEquipoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const pasivoVacacional = require('../../utils/pasivoVacacional');
const { fechaLaboral } = require('../../utils/fechaBogota');

// Pasivo vacacional del equipo (claude/modulo recursoshumanos.md §58.6). Lo ve quien tenga gente en su árbol de
// consulta (coordinador, jefe de área, gestor y director, canVerEquipo, §57): solo su gente, solo en días.
// Mismo cálculo que el de RRHH; el corte general del Excel se pasa aparte para que "con observación" no dependa
// de quién esté en el equipo.
async function pasivo({ usersCompanyId, fecha }) {
    const dia = fecha || fechaLaboral(new Date());
    const ids = await equipoRepo.idsDelArbol(usersCompanyId);
    const [empleados, novedades, corteExcel] = await Promise.all([
        pasivoEquipoRepo.empleadosDe(ids, dia),
        pasivoEquipoRepo.novedadesVacacionesDe(ids),
        pasivoEquipoRepo.fechaCorteExcel()
    ]);
    const resultado = pasivoVacacional.calcular(empleados, novedades, dia, { corteExcel });
    return { fecha: dia, con_valores: false, ...pasivoVacacional.paraEquipo(resultado) };
}

module.exports = { pasivo };
