const { combinarFechaHora } = require('../../utils/fechaBogota');

const PARAMETROS_DEFECTO = {
    minutos_habilitar_salida: 10,
    tolerancia_entrada_min: 5,
    limite_bano_min_por_pausa: 15,
    limite_bano_min_por_dia: 30,
    desviacion_almuerzo_alerta_min: 15
};

const ESTADO_SIN_ENTRADA = {
    estado: 'pendiente',
    minutosTrabajados: 0,
    segundosTrabajados: 0,
    cuentaTiempo: false,
    minutosPausaBano: 0,
    minutosPausaAlmuerzo: 0,
    minutosBreak: 0,
    minutosCapacitacion: 0,
    minutosDesconexion: 0,
    pausaActiva: null,
    desconexionActiva: null,
    minutosTarde: 0,
    minutosExtra: 0,
    minutosSalidaAnticipada: 0,
    desviacionAlmuerzoMin: 0,
    puedeMarcarSalida: false,
    segundosParaHabilitarSalida: null,
    alertas: []
};

function minutosEntre(desde, hasta) {
    return (hasta.getTime() - desde.getTime()) / 60000;
}

/**
 * @param {Array}  eventos              jornada_evento del día, cualquier orden
 * @param {Object|null} horario         horario_asignado del día, o null
 * @param {Date}   ahora                instante de corte (NOW del servidor)
 * @param {Array}  horasExtraAprobadas  hora_extra en estado 'aprobada' para ese empleado/fecha
 * @param {Object} parametros           asistencia_parametro, ya parseados a número
 */
function calcularJornada(eventos, horario, ahora, horasExtraAprobadas = [], parametros = PARAMETROS_DEFECTO) {
    const ordenados = [...eventos].sort((a, b) => a.ocurrido_en - b.ocurrido_en);

    const entrada = ordenados.find((e) => e.tipo === 'entrada');
    if (!entrada) return { ...ESTADO_SIN_ENTRADA };

    const salida = ordenados.find((e) => e.tipo === 'salida');
    const fin = salida ? salida.ocurrido_en : ahora;

    // Pausas que manda AsisLock por `estado_conexion`. Baño, break y almuerzo son tiempo libre y
    // DESCUENTAN del tiempo trabajado; capacitación cuenta COMO LABORADA (no descuenta), por
    // decisión del negocio (asistencia.md §18, revisión). Se acumulan por tipo.
    const minutosPausa = { bano: 0, break: 0, almuerzo: 0, capacitacion: 0 };
    const DESCUENTA = { bano: true, break: true, almuerzo: true, capacitacion: false };
    const TIPO_DE_INICIO = { inicio_bano: 'bano', inicio_break: 'break', inicio_almuerzo: 'almuerzo', inicio_capacitacion: 'capacitacion' };
    const TIPO_DE_FIN = { fin_bano: 'bano', fin_break: 'break', fin_almuerzo: 'almuerzo', fin_capacitacion: 'capacitacion' };
    let inicioAlmuerzoReal = null;
    let pausaActiva = null;
    const duracionesBano = [];
    let pendiente = null;
    // Desconexión de AsisLock (logout antes del fin de turno): corre aparte de las pausas y
    // tampoco cuenta como tiempo laborado.
    let minutosDesconexion = 0;
    let desconexionDesde = null;

    const acumularPausa = (tipo, duracion) => {
        minutosPausa[tipo] += duracion;
        if (tipo === 'bano') duracionesBano.push(duracion);
    };

    for (const evento of ordenados) {
        // Un evento posterior a `fin` (p. ej. una corrección manual registrada después de que
        // la jornada ya se cerró con `salida`) no pertenece a la ventana de esta jornada.
        if (evento.ocurrido_en > fin) continue;

        if (evento.tipo === 'inicio_desconexion') {
            if (desconexionDesde === null) desconexionDesde = evento.ocurrido_en;
        } else if (evento.tipo === 'fin_desconexion') {
            if (desconexionDesde !== null) {
                minutosDesconexion += Math.max(0, minutosEntre(desconexionDesde, evento.ocurrido_en));
                desconexionDesde = null;
            }
        } else if (TIPO_DE_INICIO[evento.tipo]) {
            const tipo = TIPO_DE_INICIO[evento.tipo];
            pendiente = { tipo, desde: evento.ocurrido_en };
            if (tipo === 'almuerzo' && inicioAlmuerzoReal === null) inicioAlmuerzoReal = evento.ocurrido_en;
        } else if (TIPO_DE_FIN[evento.tipo]) {
            const tipo = TIPO_DE_FIN[evento.tipo];
            if (pendiente && pendiente.tipo === tipo) {
                acumularPausa(tipo, Math.max(0, minutosEntre(pendiente.desde, evento.ocurrido_en)));
                pendiente = null;
            }
        }
    }

    // Una pausa sin cerrar se cierra contra `fin` (evento salida, o `ahora` si sigue abierta)
    if (pendiente) {
        const duracion = Math.max(0, minutosEntre(pendiente.desde, fin));
        acumularPausa(pendiente.tipo, duracion);
        if (!salida) pausaActiva = { tipo: pendiente.tipo, desde: pendiente.desde, minutosTranscurridos: Math.round(duracion), segundosTranscurridos: Math.floor(duracion * 60) };
    }

    const minutosPausaBano = minutosPausa.bano;
    const minutosPausaAlmuerzo = minutosPausa.almuerzo;
    const minutosBreak = minutosPausa.break;
    const minutosCapacitacion = minutosPausa.capacitacion;
    // Lo que descuenta del tiempo trabajado (todo menos capacitación).
    const minutosLibres = Object.entries(minutosPausa).reduce((acc, [t, m]) => acc + (DESCUENTA[t] ? m : 0), 0);

    let desconexionActiva = null;
    if (desconexionDesde !== null) {
        const duracion = Math.max(0, minutosEntre(desconexionDesde, fin));
        minutosDesconexion += duracion;
        if (!salida) desconexionActiva = { desde: desconexionDesde, minutosTranscurridos: Math.round(duracion), segundosTranscurridos: Math.floor(duracion * 60) };
    }

    const bruto = minutosEntre(entrada.ocurrido_en, fin);
    // La capacitación NO se resta (cuenta como laborada); sí baño, break, almuerzo y desconexión.
    const minutosTrabajados = Math.max(0, bruto - minutosLibres - minutosDesconexion);

    let minutosTarde = 0;
    let minutosExtra = 0;
    let minutosSalidaAnticipada = 0;
    let desviacionAlmuerzoMin = 0;
    let puedeMarcarSalida;
    let segundosParaHabilitarSalida;
    const alertas = [];

    if (horario) {
        const horaEntradaProgramada = combinarFechaHora(horario.fecha, horario.hora_entrada);
        const tolerancia = horario.tolerancia_entrada_min ?? parametros.tolerancia_entrada_min;
        const limiteEntrada = new Date(horaEntradaProgramada.getTime() + tolerancia * 60000);
        minutosTarde = Math.max(0, minutosEntre(limiteEntrada, entrada.ocurrido_en));

        const horaSalidaProgramada = combinarFechaHora(horario.fecha, horario.hora_salida);
        const habilitacion = new Date(horaSalidaProgramada.getTime() - parametros.minutos_habilitar_salida * 60000);
        puedeMarcarSalida = ahora >= habilitacion;
        segundosParaHabilitarSalida = Math.max(0, Math.round((habilitacion.getTime() - ahora.getTime()) / 1000));

        if (salida && salida.ocurrido_en < horaSalidaProgramada) {
            minutosSalidaAnticipada = minutosEntre(salida.ocurrido_en, horaSalidaProgramada);
        }

        if (fin > horaSalidaProgramada) {
            const aprobada = horasExtraAprobadas.find((h) => normalizarClave(h.fecha) === normalizarClave(horario.fecha));
            if (aprobada && aprobada.minutos_aprobados) {
                minutosExtra = Math.min(minutosEntre(horaSalidaProgramada, fin), aprobada.minutos_aprobados);
            } else {
                alertas.push('extra_sin_aprobar');
            }
        }

        if (horario.hora_almuerzo_inicio && inicioAlmuerzoReal) {
            const horaAlmuerzoProgramada = combinarFechaHora(horario.fecha, horario.hora_almuerzo_inicio);
            desviacionAlmuerzoMin = Math.abs(minutosEntre(horaAlmuerzoProgramada, inicioAlmuerzoReal));
        }

        if (horario.minutos_almuerzo != null && minutosPausaAlmuerzo > horario.minutos_almuerzo) {
            alertas.push('almuerzo_excedido');
        }
    } else {
        puedeMarcarSalida = true;
        segundosParaHabilitarSalida = 0;
    }

    if (minutosTarde > 0) alertas.push('llegada_tarde');
    if (duracionesBano.some((d) => d > parametros.limite_bano_min_por_pausa) || minutosPausaBano > parametros.limite_bano_min_por_dia) {
        alertas.push('bano_excedido');
    }
    if (desviacionAlmuerzoMin > parametros.desviacion_almuerzo_alerta_min) {
        alertas.push('almuerzo_fuera_de_horario');
    }
    if (salida && salida.origen === 'sistema') alertas.push('sin_marcar_salida');

    const estado = salida ? 'finalizada' : (pausaActiva || desconexionActiva ? 'en_pausa' : 'en_curso');
    // ¿El tiempo laborado sigue sumando en este instante? Sí en curso y en capacitación (que cuenta
    // como laborada aunque el estado sea 'en_pausa'); no en baño/break/almuerzo ni desconectado.
    const cuentaTiempo = !salida && !desconexionActiva && (!pausaActiva || !DESCUENTA[pausaActiva.tipo]);

    return {
        estado,
        minutosTrabajados: Math.round(minutosTrabajados),
        // Exacto, para que el contador del monitor no salte hasta ±30 s al recargar.
        segundosTrabajados: Math.floor(minutosTrabajados * 60),
        cuentaTiempo,
        minutosPausaBano: Math.round(minutosPausaBano),
        minutosPausaAlmuerzo: Math.round(minutosPausaAlmuerzo),
        minutosBreak: Math.round(minutosBreak),
        minutosCapacitacion: Math.round(minutosCapacitacion),
        minutosDesconexion: Math.round(minutosDesconexion),
        pausaActiva,
        desconexionActiva,
        minutosTarde: Math.round(minutosTarde),
        minutosExtra: Math.round(minutosExtra),
        minutosSalidaAnticipada: Math.round(minutosSalidaAnticipada),
        desviacionAlmuerzoMin: Math.round(desviacionAlmuerzoMin),
        puedeMarcarSalida,
        segundosParaHabilitarSalida,
        alertas
    };
}

function normalizarClave(fecha) {
    return fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha);
}

module.exports = calcularJornada;
module.exports.PARAMETROS_DEFECTO = PARAMETROS_DEFECTO;
