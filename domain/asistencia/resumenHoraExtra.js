const { combinarFechaHora } = require('../../utils/fechaBogota');

// Resumen de la hora extra de un día para la trazabilidad (asistencia.md §34, fase 2). Puro: el
// servicio reúne eventos, horario, las horas extra aprobadas y sus tramos, y aquí se arma el relato:
//   - qué se solicitó/aprobó (franja y tramos),
//   - a qué hora ENTRÓ realmente al tiempo extra y hasta cuándo,
//   - si se pasó del fin de la franja aprobada ("siguió trabajando hasta su desconexión").
// El tiempo extra puede ir pegado al turno (siguió tras la salida) o en un bloque aparte más tarde
// (evento inicio_extra, que la ingesta de AsisLock crea al reabrir la jornada).

const ms = (d) => (d ? new Date(d).getTime() : null);
const iso = (d) => (d ? new Date(d).toISOString() : null);
const minutos = (desde, hasta) => Math.max(0, Math.round((ms(hasta) - ms(desde)) / 60000));

function resumenHoraExtra({ eventos, horario, horasExtraAprobadas, tramosPorHe = {}, fecha, ahora }) {
    const aprobadas = (horasExtraAprobadas || []).filter((h) => h.hora_inicio && h.hora_fin);
    if (aprobadas.length === 0) return null;

    const ordenados = [...(eventos || [])].sort((a, b) => ms(a.ocurrido_en) - ms(b.ocurrido_en));

    // Franja aprobada envolvente (para marcar en la línea de tiempo y medir el desborde).
    let franjaInicio = null;
    let franjaFin = null;
    const solicitudes = aprobadas.map((h) => {
        const ini = combinarFechaHora(fecha, h.hora_inicio);
        let fin = combinarFechaHora(fecha, h.hora_fin);
        if (fin <= ini) fin = new Date(fin.getTime() + 24 * 60 * 60 * 1000);
        if (!franjaInicio || ini < franjaInicio) franjaInicio = ini;
        if (!franjaFin || fin > franjaFin) franjaFin = fin;
        return {
            idhora_extra: h.idhora_extra ?? null,
            hora_inicio: h.hora_inicio.slice(0, 5),
            hora_fin: h.hora_fin.slice(0, 5),
            minutos_aprobados: h.minutos_aprobados ?? null,
            solicitado_en: iso(h.creado_en),
            aprobado_en: iso(h.fecha_decision),
            tramos: tramosPorHe[h.idhora_extra] || []
        };
    });

    // Bloque realmente trabajado como extra.
    const inicioExtra = ordenados.find((e) => e.tipo === 'inicio_extra');
    const finExtra = ordenados.find((e) => e.tipo === 'fin_extra');
    const salida = ordenados.find((e) => e.tipo === 'salida');
    const salidaProgramada = horario && horario.hora_salida ? combinarFechaHora(fecha, horario.hora_salida) : null;

    let realizado = null;
    if (inicioExtra) {
        // Bloque aparte: el agente volvió para la hora extra (reapertura de AsisLock).
        const inicio = inicioExtra.ocurrido_en;
        const fin = finExtra ? finExtra.ocurrido_en : ahora;
        realizado = { inicio, fin, en_curso: !finExtra, contiguo: false };
    } else if (salidaProgramada && salida && ms(salida.ocurrido_en) > ms(salidaProgramada)) {
        // Pegado al turno: siguió trabajando tras la hora de salida programada hasta que salió.
        realizado = { inicio: salidaProgramada, fin: salida.ocurrido_en, en_curso: false, contiguo: true };
    } else if (salidaProgramada && !salida && ms(ahora) > ms(salidaProgramada)) {
        // Pegado al turno y todavía trabajando después de la hora de salida.
        realizado = { inicio: salidaProgramada, fin: ahora, en_curso: true, contiguo: true };
    }

    const extra = realizado
        ? {
            inicio_real: iso(realizado.inicio),
            fin_real: iso(realizado.fin),
            minutos: minutos(realizado.inicio, realizado.fin),
            en_curso: realizado.en_curso,
            contiguo: realizado.contiguo,
            // Cuánto se pasó del fin de la franja aprobada.
            excedio_min: franjaFin && ms(realizado.fin) > ms(franjaFin) ? minutos(franjaFin, realizado.fin) : 0
        }
        : null;

    return {
        solicitudes,
        franja_aprobada: franjaInicio ? { inicio: iso(franjaInicio), fin: iso(franjaFin) } : null,
        extra
    };
}

module.exports = { resumenHoraExtra };
