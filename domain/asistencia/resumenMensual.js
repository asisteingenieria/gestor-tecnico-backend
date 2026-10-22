// Resumen mensual de asistencia de un equipo (asistencia.md §35). Puro: recibe las jornadas ya
// leídas de la BD y arma, por empleado, los totales del mes y la grilla día a día (para la vista
// del jefe). Sin E/S.

// Estados que cuentan como día trabajado (no pendiente ni ausente).
const TRABAJADO = new Set(['en_curso', 'en_pausa', 'finalizada']);

const CAMPOS_MINUTOS = {
    minutos_trabajados: 'minutos_trabajados',
    minutos_tarde: 'minutos_tarde',
    minutos_extra: 'minutos_extra',
    minutos_bano: 'minutos_pausa_bano',
    minutos_break: 'minutos_break',
    minutos_almuerzo: 'minutos_pausa_almuerzo',
    minutos_capacitacion: 'minutos_capacitacion',
    minutos_salida_anticipada: 'minutos_salida_anticipada'
};

const fechaCelda = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));
const num = (v) => Number(v) || 0;

/** Totales del mes + grilla día a día de un empleado, a partir de sus jornadas. */
function resumenDeJornadas(jornadas) {
    const trabajadas = jornadas.filter((j) => TRABAJADO.has(j.estado));
    const diasTrabajados = trabajadas.length;
    const diasPuntuales = trabajadas.filter((j) => num(j.minutos_tarde) === 0).length;

    const resumen = {
        dias_trabajados: diasTrabajados,
        dias_puntuales: diasPuntuales,
        dias_tarde: trabajadas.filter((j) => num(j.minutos_tarde) > 0).length,
        ausencias: jornadas.filter((j) => j.estado === 'ausente').length,
        porcentaje_puntualidad: diasTrabajados > 0 ? Math.round((diasPuntuales / diasTrabajados) * 100) : null
    };
    for (const [salida, columna] of Object.entries(CAMPOS_MINUTOS)) {
        resumen[salida] = jornadas.reduce((acc, j) => acc + num(j[columna]), 0);
    }
    resumen.dias = jornadas.map((j) => ({
        fecha: fechaCelda(j.fecha),
        estado: j.estado,
        minutos_tarde: num(j.minutos_tarde),
        minutos_trabajados: num(j.minutos_trabajados),
        minutos_extra: num(j.minutos_extra)
    }));
    return resumen;
}

/** Totales del equipo (suma de los de cada empleado) + puntualidad global. */
function totalesEquipo(empleados) {
    const campos = ['dias_trabajados', 'ausencias', 'dias_tarde', ...Object.keys(CAMPOS_MINUTOS)];
    const t = Object.fromEntries(campos.map((c) => [c, 0]));
    for (const e of empleados) for (const c of campos) t[c] += num(e[c]);
    const diasTrabajados = empleados.reduce((a, e) => a + num(e.dias_trabajados), 0);
    const puntuales = empleados.reduce((a, e) => a + num(e.dias_puntuales), 0);
    t.empleados = empleados.length;
    t.porcentaje_puntualidad = diasTrabajados > 0 ? Math.round((puntuales / diasTrabajados) * 100) : null;
    return t;
}

module.exports = { resumenDeJornadas, totalesEquipo };
