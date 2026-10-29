const { ReglaAsistenciaError } = require('../../errors/AppError');

// Solicitudes de cambio de turno (migración 084, asistencia.md §50): reglas y textos, sin E/S.
// Un cambio de horario abarca como máximo un mes de días; más que eso es una reasignación de
// horario que le toca hacer al jefe desde "Horarios del equipo".
const MAX_DIAS_CAMBIO_TURNO = 31;
const LARGO_MENSAJE = 255;

const hhmmss = (hora) => (hora && hora.length === 5 ? `${hora}:00` : hora);
const hhmm = (hora) => (hora ? String(hora).slice(0, 5) : '');
const ddmm = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

// "KEVIN YOBANY BUITRAGO LADINO" → "Kevin Yobany Buitrago Ladino" (en la BD los nombres van en mayúsculas).
function formatearNombre(nombre) {
    return String(nombre || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espacio, letra) => espacio + letra.toUpperCase()).trim();
}

// Solo días de hoy en adelante (fecha laboral de Bogotá, que llega como `hoy`): cambiar el turno de
// un día que ya pasó no le sirve a nadie y descuadraría jornadas ya cerradas.
function assertFechasSolicitables(fechas, hoy) {
    if (fechas.length === 0) throw new ReglaAsistenciaError('El rango de fechas no tiene días');
    if (fechas.length > MAX_DIAS_CAMBIO_TURNO) {
        throw new ReglaAsistenciaError(`Un cambio de turno abarca como máximo ${MAX_DIAS_CAMBIO_TURNO} días`);
    }
    if (fechas.some((f) => f < hoy)) throw new ReglaAsistenciaError('No se puede cambiar el turno de un día que ya pasó');
}

// El horario nuevo de un cambio de horario: una plantilla, horas sueltas o descanso. El sistema no
// maneja turnos que cruzan la medianoche, así que la salida va después de la entrada.
function horarioNuevo({ plantilla, valores, esDescanso }) {
    if (esDescanso) {
        return {
            horarioPlantillaId: null, horaEntrada: '00:00:00', horaSalida: '00:00:00', minutosAlmuerzo: 0,
            horaAlmuerzoInicio: null, toleranciaEntradaMin: 5, esDescanso: true
        };
    }
    const base = plantilla
        ? {
            horarioPlantillaId: plantilla.idhorario_plantilla, horaEntrada: plantilla.hora_entrada, horaSalida: plantilla.hora_salida,
            minutosAlmuerzo: plantilla.minutos_almuerzo, horaAlmuerzoInicio: plantilla.hora_almuerzo_inicio,
            toleranciaEntradaMin: plantilla.tolerancia_entrada_min
        }
        : { horarioPlantillaId: null, ...valores };
    if (!base.horaEntrada || !base.horaSalida) {
        throw new ReglaAsistenciaError('Indique una plantilla, las horas de entrada y salida o un día de descanso');
    }
    const horaEntrada = hhmmss(base.horaEntrada);
    const horaSalida = hhmmss(base.horaSalida);
    if (horaSalida <= horaEntrada) throw new ReglaAsistenciaError('La hora de salida debe ser posterior a la de entrada');
    return {
        horarioPlantillaId: base.horarioPlantillaId ?? null,
        horaEntrada,
        horaSalida,
        minutosAlmuerzo: base.minutosAlmuerzo ?? 60,
        horaAlmuerzoInicio: hhmmss(base.horaAlmuerzoInicio) ?? null,
        toleranciaEntradaMin: base.toleranciaEntradaMin ?? 5,
        esDescanso: false
    };
}

// Copia del horario vigente (fila de horario_asignado o null) para mostrar el antes y el después.
function anteriorDe(horario) {
    if (!horario) return { anteriorHoraEntrada: null, anteriorHoraSalida: null, anteriorEsDescanso: null, anteriorPlantilla: null };
    return {
        anteriorHoraEntrada: horario.hora_entrada,
        anteriorHoraSalida: horario.hora_salida,
        anteriorEsDescanso: horario.es_descanso ? 1 : 0,
        anteriorPlantilla: horario.plantilla ?? null
    };
}

// Días de un cambio de horario: el mismo horario nuevo en cada fecha. `actuales` = Map fecha → horario vigente.
function diasCambioHorario(empleadoId, fechas, nuevo, actuales) {
    return fechas.map((fecha) => ({ usersCompanyId: empleadoId, fecha, ...nuevo, ...anteriorDe(actuales.get(fecha)) }));
}

function comoNuevo(horario) {
    return {
        horarioPlantillaId: horario.horario_plantilla_id ?? null,
        horaEntrada: horario.hora_entrada,
        horaSalida: horario.hora_salida,
        minutosAlmuerzo: horario.minutos_almuerzo,
        horaAlmuerzoInicio: horario.hora_almuerzo_inicio ?? null,
        toleranciaEntradaMin: horario.tolerancia_entrada_min,
        esDescanso: Boolean(horario.es_descanso)
    };
}

// Intercambio: cada uno toma el turno del otro en esa fecha. Los dos tienen que tener turno
// asignado (no hay qué intercambiar con un día sin horario) y no pueden ser la misma persona.
function diasIntercambio(empleadoA, empleadoB, fecha, horarioA, horarioB) {
    if (empleadoA === empleadoB) throw new ReglaAsistenciaError('El intercambio es entre dos empleados distintos');
    if (!horarioA || !horarioB) throw new ReglaAsistenciaError('Los dos empleados deben tener turno asignado ese día para intercambiarlo');
    const igual = horarioA.hora_entrada === horarioB.hora_entrada && horarioA.hora_salida === horarioB.hora_salida
        && Boolean(horarioA.es_descanso) === Boolean(horarioB.es_descanso);
    if (igual) throw new ReglaAsistenciaError('Los dos empleados tienen el mismo turno ese día');
    return [
        { usersCompanyId: empleadoA, fecha, ...comoNuevo(horarioB), ...anteriorDe(horarioA) },
        { usersCompanyId: empleadoB, fecha, ...comoNuevo(horarioA), ...anteriorDe(horarioB) }
    ];
}

function textoHorario({ es_descanso: esDescanso, hora_entrada: entrada, hora_salida: salida }) {
    return esDescanso ? 'descanso' : `${hhmm(entrada)}–${hhmm(salida)}`;
}

function textoFechas(fechas) {
    const unicas = [...new Set(fechas)].sort();
    if (unicas.length === 1) return `el ${ddmm(unicas[0])}`;
    return `del ${ddmm(unicas[0])} al ${ddmm(unicas[unicas.length - 1])}`;
}

// "cambio de turno de Ana Pérez el 30/10" / "intercambio de turnos entre Ana Pérez y Luis Gil el 30/10".
// `dias` trae `empleado` (nombre) y `fecha` ('YYYY-MM-DD').
function resumenSolicitud(tipo, dias) {
    const nombres = [...new Set(dias.map((d) => formatearNombre(d.empleado)))];
    const fechas = textoFechas(dias.map((d) => d.fecha));
    return tipo === 'intercambio'
        ? `intercambio de turnos entre ${nombres.join(' y ')} ${fechas}`
        : `cambio de turno de ${nombres[0]} ${fechas}`;
}

const recortar = (texto) => (texto.length > LARGO_MENSAJE ? `${texto.slice(0, LARGO_MENSAJE - 1)}…` : texto);

const mensajes = {
    solicitada: (solicitante, resumen) => recortar(`${formatearNombre(solicitante)} solicita ${resumen}`),
    aprobada: (resumen, jefe) => recortar(`Tu solicitud de ${resumen} fue aprobada por ${formatearNombre(jefe)}`),
    rechazada: (resumen, jefe, motivo) => recortar(`Tu solicitud de ${resumen} fue rechazada por ${formatearNombre(jefe)}. Motivo: ${motivo}`),
    resueltaParaFinanciera: (resumen, jefe, aprobada) => recortar(`${formatearNombre(jefe)} ${aprobada ? 'aprobó' : 'rechazó'} la solicitud de ${resumen}`),
    // Al empleado: sus días con el turno nuevo ("30/10 08:00–17:00, 31/10 descanso").
    turnoCambiado: (diasDelEmpleado) => recortar(`Tu turno cambió: ${[...diasDelEmpleado]
        .sort((a, b) => a.fecha.localeCompare(b.fecha))
        .map((d) => `${ddmm(d.fecha)} ${textoHorario(d)}`)
        .join(', ')}`)
};

module.exports = {
    MAX_DIAS_CAMBIO_TURNO,
    assertFechasSolicitables,
    horarioNuevo,
    diasCambioHorario,
    diasIntercambio,
    resumenSolicitud,
    textoHorario,
    formatearNombre,
    mensajes
};
