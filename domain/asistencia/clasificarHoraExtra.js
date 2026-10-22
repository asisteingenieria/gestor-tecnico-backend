// Clasificación pura de una hora extra solicitada (asistencia.md §32). A partir de la franja
// (inicio, fin), el turno asignado, el umbral nocturno vigente y si el día es festivo/domingo,
// reparte los minutos entre las 5 clases del formato V.3. Determinista y sin E/S: el servicio
// resuelve antes el turno, la ventana nocturna y los festivos, y se los pasa ya calculados.
//
// Regla (acotada a lo que el agente solicita):
//   - Festivo/domingo:  dentro del turno -> dominical/festiva (90%); fuera -> extra dom/fest (115%).
//   - Día ordinario, DENTRO del turno:   de noche -> recargo nocturno (35%); de día -> no aplica
//     (es jornada ordinaria, ni recargo ni extra, no se reporta).
//   - Día ordinario, FUERA del turno:    de día -> extra diurna (1.25); de noche -> extra nocturna.
// Sin turno asignado (o día de descanso) no se puede separar recargo de extra: todo cuenta como
// FUERA del turno (extra), y el jefe lo revisa.

const { CLASES } = require('./reporteHorasExtra');

const MIN_DIA = 1440;

// 'HH:MM' o 'HH:MM:SS' -> minutos desde la medianoche. null/!válido -> null.
function aMinutos(hhmm) {
    if (typeof hhmm !== 'string') return null;
    const m = hhmm.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/**
 * @param {object} p
 * @param {string} p.inicio  'HH:MM' inicio de la franja (hora local)
 * @param {string} p.fin     'HH:MM' fin; si es <= inicio se entiende que cruza la medianoche
 * @param {{entrada:string, salida:string, esDescanso?:boolean}|null} p.turno  turno del día
 * @param {boolean} p.dia0EsFestivo  festivo o domingo en la fecha de inicio
 * @param {boolean} p.dia1EsFestivo  festivo o domingo en el día siguiente (por si cruza medianoche)
 * @param {{inicio:string, fin:string}} p.ventanaNocturna  p. ej. { inicio:'19:00', fin:'06:00' }
 * @returns {{clase:string, minutos:number}[]}  tramos no vacíos, en el orden de CLASES
 */
function clasificarHoraExtra({ inicio, fin, turno, dia0EsFestivo, dia1EsFestivo, ventanaNocturna }) {
    const inicioMin = aMinutos(inicio);
    let finMin = aMinutos(fin);
    if (inicioMin == null || finMin == null) {
        throw new Error('Hora de inicio o fin inválida');
    }
    if (finMin <= inicioMin) finMin += MIN_DIA; // cruza la medianoche

    const hayTurno = turno && !turno.esDescanso;
    const turnoEntrada = hayTurno ? aMinutos(turno.entrada) : null;
    let turnoSalida = hayTurno ? aMinutos(turno.salida) : null;
    if (turnoEntrada != null && turnoSalida != null && turnoSalida <= turnoEntrada) {
        turnoSalida += MIN_DIA; // turno que cierra pasada la medianoche
    }

    const nocheInicio = aMinutos(ventanaNocturna?.inicio);
    const nocheFin = aMinutos(ventanaNocturna?.fin);
    if (nocheInicio == null || nocheFin == null) {
        throw new Error('Ventana nocturna inválida');
    }

    const acum = Object.fromEntries(CLASES.map((c) => [c, 0]));

    for (let m = inicioMin; m < finMin; m++) {
        const minutoDia = m % MIN_DIA;
        const esFestivo = m < MIN_DIA ? dia0EsFestivo : dia1EsFestivo;
        const dentroTurno = turnoEntrada != null && m >= turnoEntrada && m < turnoSalida;
        const esNoche = minutoDia >= nocheInicio || minutoDia < nocheFin;

        let clase;
        if (esFestivo) {
            clase = dentroTurno ? 'dominicales_festivas' : 'extras_dominicales_festivas';
        } else if (dentroTurno) {
            clase = esNoche ? 'recargo_nocturno' : null; // día dentro del turno = jornada ordinaria
        } else {
            clase = esNoche ? 'extras_nocturnas' : 'extras_diurnas';
        }
        if (clase) acum[clase] += 1;
    }

    return CLASES.filter((c) => acum[c] > 0).map((c) => ({ clase: c, minutos: acum[c] }));
}

/** Suma de minutos de un conjunto de tramos. */
function totalMinutos(tramos) {
    return (tramos || []).reduce((acc, t) => acc + (Number(t.minutos) || 0), 0);
}

/** La clase con más minutos (para mostrar una sola en la bandeja). null si no hay tramos. */
function claseDominante(tramos) {
    if (!tramos || tramos.length === 0) return null;
    return tramos.reduce((mejor, t) => (t.minutos > mejor.minutos ? t : mejor)).clase;
}

module.exports = { clasificarHoraExtra, totalMinutos, claseDominante, aMinutos };
