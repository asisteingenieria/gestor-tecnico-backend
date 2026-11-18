// Resumen mensual de asistencia de un equipo (asistencia.md §35). Puro: recibe las jornadas ya
// leídas de la BD y arma, por empleado, los totales del mes y la grilla día a día (para la vista
// del jefe). Sin E/S.

// Estados que cuentan como día trabajado (no pendiente ni ausente).
const TRABAJADO = new Set(['en_curso', 'en_pausa', 'finalizada']);

const CAMPOS_MINUTOS = {
    minutos_trabajados: 'minutos_trabajados',
    minutos_tarde: 'minutos_tarde',
    // Retraso exacto (§72); minutos_tarde va redondeado y decide puntual/tarde.
    segundos_tarde: 'segundos_tarde',
    minutos_extra: 'minutos_extra',
    minutos_bano: 'minutos_pausa_bano',
    minutos_break: 'minutos_break',
    minutos_almuerzo: 'minutos_pausa_almuerzo',
    minutos_capacitacion: 'minutos_capacitacion',
    minutos_salida_anticipada: 'minutos_salida_anticipada'
};

const fechaCelda = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));
const num = (v) => Number(v) || 0;

/**
 * Totales del mes + grilla día a día de un empleado, a partir de sus jornadas.
 * `novedades` = Map fecha → novedad de RRHH del día (domain/asistencia/novedadesAsistencia, §71). Un día
 * cubierto por una novedad en que no trabajó no es ausencia: cuenta en `dias_novedad` y la grilla lo marca
 * 'novedad' (también si no había jornada, p. ej. vacaciones sin horario). Si trabajó igual, el día queda como
 * trabajado y lleva la novedad para mostrarla.
 * `descansos` = Set de fechas que su horario marca como día de descanso (§73). Un descanso en que no trabajó va en
 * la grilla como 'descanso' (haya o no jornada) y cuenta en `dias_descanso`; nunca es ausencia. La novedad que
 * cubre el día manda sobre el descanso; si trabajó, el día sigue trabajado.
 */
function resumenDeJornadas(jornadas, novedades = new Map(), descansos = new Set()) {
    const trabajadas = jornadas.filter((j) => TRABAJADO.has(j.estado));
    const cubierto = (j) => novedades.get(fechaCelda(j.fecha))?.cubre_dia === true;
    const fechasConJornada = new Set(jornadas.map((j) => fechaCelda(j.fecha)));
    const fechasTrabajadas = new Set(trabajadas.map((j) => fechaCelda(j.fecha)));
    const diasNovedad = [...novedades.entries()].filter(([f, n]) => n.cubre_dia && !fechasTrabajadas.has(f));
    const esDescanso = (fecha) => descansos.has(fecha) && !fechasTrabajadas.has(fecha) && novedades.get(fecha)?.cubre_dia !== true;
    const diasDescanso = [...descansos].filter(esDescanso);
    const diasTrabajados = trabajadas.length;
    const diasPuntuales = trabajadas.filter((j) => num(j.minutos_tarde) === 0).length;

    const resumen = {
        dias_trabajados: diasTrabajados,
        dias_puntuales: diasPuntuales,
        dias_tarde: trabajadas.filter((j) => num(j.minutos_tarde) > 0).length,
        ausencias: jornadas.filter((j) => j.estado === 'ausente' && !cubierto(j) && !esDescanso(fechaCelda(j.fecha))).length,
        dias_novedad: diasNovedad.length,
        dias_descanso: diasDescanso.length,
        porcentaje_puntualidad: diasTrabajados > 0 ? Math.round((diasPuntuales / diasTrabajados) * 100) : null
    };
    for (const [salida, columna] of Object.entries(CAMPOS_MINUTOS)) {
        resumen[salida] = jornadas.reduce((acc, j) => acc + num(j[columna]), 0);
    }
    resumen.dias = jornadas.map((j) => {
        const fecha = fechaCelda(j.fecha);
        const novedad = novedades.get(fecha) || null;
        return {
            fecha,
            // Ausente o sin entrada en un día cubierto por la novedad: 'novedad'.
            estado: novedad?.cubre_dia && !TRABAJADO.has(j.estado) ? 'novedad' : (esDescanso(fecha) ? 'descanso' : j.estado),
            minutos_tarde: num(j.minutos_tarde),
            segundos_tarde: num(j.segundos_tarde),
            minutos_trabajados: num(j.minutos_trabajados),
            minutos_extra: num(j.minutos_extra),
            novedad
        };
    });
    // Días con novedad sin jornada (sin horario ese día): también se ven en la grilla.
    for (const [fecha, novedad] of diasNovedad) {
        if (!fechasConJornada.has(fecha)) {
            resumen.dias.push({ fecha, estado: 'novedad', minutos_tarde: 0, segundos_tarde: 0, minutos_trabajados: 0, minutos_extra: 0, novedad });
        }
    }
    // Días de descanso sin jornada: también en la grilla, con su marca.
    for (const fecha of diasDescanso) {
        if (!fechasConJornada.has(fecha)) {
            resumen.dias.push({ fecha, estado: 'descanso', minutos_tarde: 0, segundos_tarde: 0, minutos_trabajados: 0, minutos_extra: 0, novedad: null });
        }
    }
    resumen.dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
    return resumen;
}

/** Totales del equipo (suma de los de cada empleado) + puntualidad global. */
function totalesEquipo(empleados) {
    const campos = ['dias_trabajados', 'ausencias', 'dias_novedad', 'dias_descanso', 'dias_tarde', ...Object.keys(CAMPOS_MINUTOS)];
    const t = Object.fromEntries(campos.map((c) => [c, 0]));
    for (const e of empleados) for (const c of campos) t[c] += num(e[c]);
    const diasTrabajados = empleados.reduce((a, e) => a + num(e.dias_trabajados), 0);
    const puntuales = empleados.reduce((a, e) => a + num(e.dias_puntuales), 0);
    t.empleados = empleados.length;
    t.porcentaje_puntualidad = diasTrabajados > 0 ? Math.round((puntuales / diasTrabajados) * 100) : null;
    return t;
}

module.exports = { resumenDeJornadas, totalesEquipo };
