/**
 * Semana de la malla (asistencia.md §90): al cargar la malla en Excel, cada persona debe sumar exactamente las horas
 * semanales del parámetro `horas_semanales_malla` (42) y tener al menos un día de descanso por semana. Si una sola
 * semana de una sola persona no cuadra, no se carga nada y se dice qué filas son. Puro: sin E/S.
 *
 * Reglas (decididas con el usuario el 2026-11-26):
 *   - Semana de lunes a domingo.
 *   - Horas del día = salida − entrada − almuerzo. El descanso suma 0.
 *   - Los días de la semana que no trae el Excel se toman del horario que la persona ya tiene cargado. Si aun así
 *     falta algún día, la semana no se valida y se avisa (los bordes del mes, un ingreso a mitad de semana).
 *   - Una semana con alguna novedad —INC, VACACIONES, LNR, LR, SUSPENSION, RETIRO en la malla o en lo ya cargado, o
 *     una novedad de RRHH— no se valida y se avisa: con esos días no se llega a las horas.
 *   - Un libre aprobado (§86) cuenta como día de descanso.
 *   - Semana con festivo (§90.3): no se exige llegar a las horas, solo no pasarse. El festivo que no se trabaja
 *     (descanso o sin horas) cuenta como el día de descanso de la semana.
 */

const { NOVEDADES_DESCANSO } = require('./mallaHorarios');

// Las de la malla que son ausencias y no un descanso de la operación.
const NOVEDADES_SIN_VALIDAR = NOVEDADES_DESCANSO.filter((n) => !['DESCANSO', 'LIBRE'].includes(n));

const DIA_MS = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const aFecha = (f) => new Date(`${f}T00:00:00Z`);

/** Lunes de la semana de `fecha` ('YYYY-MM-DD'). */
function lunesDe(fecha) {
    const d = aFecha(fecha);
    const desdeLunes = (d.getUTCDay() + 6) % 7;
    return iso(new Date(d.getTime() - desdeLunes * DIA_MS));
}

/** Los 7 días ('YYYY-MM-DD') de la semana que empieza en `lunes`. */
function diasDeSemana(lunes) {
    const base = aFecha(lunes).getTime();
    return Array.from({ length: 7 }, (_, i) => iso(new Date(base + i * DIA_MS)));
}

const minutosDeHora = (h) => {
    const [hh, mm] = String(h ?? '').split(':').map(Number);
    return (hh || 0) * 60 + (mm || 0);
};

/** Minutos de trabajo de un día con la forma { esDescanso, horaEntrada, horaSalida, minutosAlmuerzo }. */
function minutosDelDia(dia) {
    if (dia.esDescanso) return 0;
    return Math.max(0, minutosDeHora(dia.horaSalida) - minutosDeHora(dia.horaEntrada) - (Number(dia.minutosAlmuerzo) || 0));
}

/** 2520 → "42 h"; 2490 → "41 h 30 min"; 30 → "30 min". */
function textoHoras(minutos) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    if (!h) return `${m} min`;
    return m ? `${h} h ${m} min` : `${h} h`;
}

// Horario ya cargado (fila de horario_asignado) → la forma de un día de la malla.
const diaDeExistente = (h) => ({
    esDescanso: Boolean(h.es_descanso),
    horaEntrada: h.hora_entrada,
    horaSalida: h.hora_salida,
    minutosAlmuerzo: h.minutos_almuerzo,
    novedad: NOVEDADES_SIN_VALIDAR.includes(String(h.notas ?? '').trim().toUpperCase()) ? String(h.notas).trim().toUpperCase() : null,
    delExcel: false
});

const fechaIso = (f) => (f instanceof Date ? iso(f) : String(f).slice(0, 10));

/**
 * @param {Object}   p
 * @param {Array}    p.filas          días del equipo que trae el Excel y se cargan o ya estaban iguales (plan de la malla):
 *                                    { fila, users_company_id, cedula, nombre, nombre_rrhh, fecha, esDescanso, horaEntrada,
 *                                      horaSalida, minutosAlmuerzo, novedad }
 * @param {Map}      p.existentes     `${users_company_id}|${fecha}` → horario_asignado, para las semanas completas
 * @param {Array}    p.novedadesRrhh  { users_company_id, tipo, fecha_inicial, fecha_final } que tocan esas semanas
 * @param {number}   p.minutosSemana  minutos exactos por semana (42 h = 2520)
 * @param {Set}      p.festivos       fechas 'YYYY-MM-DD' festivas de esas semanas (festivo_colombia)
 * @returns {{ desajustes: Array, sinValidar: Array }}
 */
function validarSemanas({ filas, existentes, novedadesRrhh = [], minutosSemana, festivos = new Set() }) {
    // Persona → semana → días del Excel.
    const porPersona = new Map();
    for (const f of filas) {
        const persona = porPersona.get(f.users_company_id)
            ?? { users_company_id: f.users_company_id, cedula: f.cedula, nombre: f.nombre_rrhh ?? f.nombre, semanas: new Map() };
        const lunes = lunesDe(f.fecha);
        if (!persona.semanas.has(lunes)) persona.semanas.set(lunes, new Map());
        persona.semanas.get(lunes).set(f.fecha, { ...f, delExcel: true });
        porPersona.set(f.users_company_id, persona);
    }

    const desajustes = [];
    const sinValidar = [];
    for (const persona of porPersona.values()) {
        const novedadesPersona = novedadesRrhh.filter((n) => n.users_company_id === persona.users_company_id);
        for (const [lunes, delExcel] of [...persona.semanas.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const fechas = diasDeSemana(lunes);
            const semana = { desde: fechas[0], hasta: fechas[6] };
            const comun = { users_company_id: persona.users_company_id, cedula: persona.cedula, nombre: persona.nombre, semana_desde: semana.desde, semana_hasta: semana.hasta };
            const filasExcel = [...delExcel.values()].map((d) => d.fila).sort((a, b) => a - b);

            const dias = fechas.map((fecha) => delExcel.get(fecha)
                ?? (existentes.get(`${persona.users_company_id}|${fecha}`) ? diaDeExistente(existentes.get(`${persona.users_company_id}|${fecha}`)) : null));

            const novedadMalla = dias.find((d) => d?.novedad && NOVEDADES_SIN_VALIDAR.includes(d.novedad))?.novedad;
            const novedadRrhh = novedadesPersona.find((n) => fechaIso(n.fecha_inicial) <= semana.hasta && fechaIso(n.fecha_final) >= semana.desde);
            if (novedadMalla || novedadRrhh) {
                sinValidar.push({ ...comun, filas: filasExcel, motivo: `Tiene novedad (${novedadMalla ?? novedadRrhh.tipo}): no se exigen las horas` });
                continue;
            }
            const faltan = fechas.filter((_, i) => !dias[i]);
            if (faltan.length > 0) {
                sinValidar.push({ ...comun, filas: filasExcel, motivo: `Semana incompleta: ${faltan.length} ${faltan.length === 1 ? 'día' : 'días'} sin horario ni en el Excel ni en el sistema` });
                continue;
            }

            const minutos = dias.reduce((acc, d) => acc + minutosDelDia(d), 0);
            const festivosSemana = fechas.filter((f) => festivos.has(f));
            const descansos = dias.filter((d, i) => d.esDescanso || (festivos.has(fechas[i]) && minutosDelDia(d) === 0)).length;
            const problemas = [];
            if (minutos < minutosSemana && festivosSemana.length === 0) problemas.push(`Suma ${textoHoras(minutos)}: le faltan ${textoHoras(minutosSemana - minutos)} para las ${textoHoras(minutosSemana)}`);
            if (minutos > minutosSemana) problemas.push(`Suma ${textoHoras(minutos)}: se pasa ${textoHoras(minutos - minutosSemana)} de las ${textoHoras(minutosSemana)}`);
            if (descansos === 0) problemas.push('No tiene ningún día de descanso en la semana');
            if (problemas.length > 0) {
                desajustes.push({ ...comun, filas: filasExcel, minutos, horas: textoHoras(minutos), dias_descanso: descansos, problemas });
            }
        }
    }
    const orden = (a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '') || a.semana_desde.localeCompare(b.semana_desde);
    return { desajustes: desajustes.sort(orden), sinValidar: sinValidar.sort(orden) };
}

/** Rango de fechas (lunes de la primera semana, domingo de la última) que cubren las semanas de `fechas`. */
function rangoDeSemanas(fechas) {
    if (fechas.length === 0) return null;
    const ordenadas = [...fechas].sort();
    return { desde: lunesDe(ordenadas[0]), hasta: diasDeSemana(lunesDe(ordenadas[ordenadas.length - 1]))[6] };
}

module.exports = { validarSemanas, rangoDeSemanas, lunesDe, diasDeSemana, minutosDelDia, textoHoras, NOVEDADES_SIN_VALIDAR };
