/**
 * Carga retroactiva de la malla (asistencia.md §76): horarios de días que ya pasaron, para recalcular la llegada
 * (puntual / tarde) y marcar a quien no se logueó. Solo por script y con simulación previa; la pantalla de los
 * jefes sigue sin aceptar días pasados (§55). Puro, sin E/S.
 */

const MAX_DIAS = 31;

/** Valida el rango: días ya pasados, en orden y hasta 31. Devuelve el mensaje de error o null. */
function errorDeRango(desde, hasta, hoy, dias) {
    if (!desde || !hasta) return 'Indique --desde y --hasta (AAAA-MM-DD)';
    if (hasta < desde) return 'La fecha final no puede ser anterior a la inicial';
    if (hasta >= hoy) return `Solo días que ya pasaron (antes de hoy, ${hoy}); los de hoy en adelante se suben por la pantalla`;
    if (dias > MAX_DIAS) return `Hasta ${MAX_DIAS} días por carga`;
    return null;
}

/**
 * Resultado de un día después de cargar su horario.
 * @param {{ esDescanso: boolean }} horario  el que se cargó
 * @param {object|null} jornada             la jornada del día después de recalcular (o null si no hay)
 * @returns {'descanso'|'trabajo_en_descanso'|'ausente'|'tarde'|'puntual'|'sin_jornada'}
 */
function resultadoDelDia(horario, jornada) {
    if (horario.esDescanso) return jornada && jornada.estado !== 'ausente' ? 'trabajo_en_descanso' : 'descanso';
    if (!jornada) return 'sin_jornada';
    if (jornada.estado === 'ausente') return 'ausente';
    return Number(jornada.minutos_tarde) > 0 ? 'tarde' : 'puntual';
}

const RESULTADOS = ['puntual', 'tarde', 'ausente', 'descanso', 'trabajo_en_descanso', 'sin_jornada'];

/** Conteo por resultado y personas distintas. */
function resumir(detalle) {
    const resumen = Object.fromEntries(RESULTADOS.map((r) => [r, 0]));
    for (const d of detalle) resumen[d.resultado]++;
    resumen.dias = detalle.length;
    resumen.personas = new Set(detalle.map((d) => d.users_company_id)).size;
    return resumen;
}

module.exports = { MAX_DIAS, RESULTADOS, errorDeRango, resultadoDelDia, resumir };
