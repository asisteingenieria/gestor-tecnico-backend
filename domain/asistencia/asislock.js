const { combinarFechaHora } = require('../../utils/fechaBogota');

/**
 * Reglas puras de la integración con AsisLock (login biométrico). Sin E/S: el servicio
 * reúne eventos, horario y parámetros y aquí solo se decide qué evento de jornada produce
 * cada login/logout. Ver asistencia.md §18.
 *
 * Decisiones de negocio (2026-10-11):
 *   - `usuario` de AsisLock es la cédula del empleado.
 *   - Vale la hora que reporta AsisLock (fecha + hora_login/hora_logout, hora de Bogotá).
 *   - Primer login del día = entrada. Un logout antes de la ventana de salida abre una
 *     desconexión (no cuenta como tiempo laborado) y el siguiente login la cierra. Un logout
 *     dentro de la ventana de salida, o después, cierra la jornada.
 *   - Baño y almuerzo se siguen marcando en Gestor.
 */

// Valores de respaldo si asistencia_parametro aún no tiene las claves (migración 062).
const PARAMETROS_DEFECTO = {
    asislock_tolerancia_futuro_min: 5,
    asislock_max_horas_atraso: 72,
    minutos_habilitar_salida: 10
};

const FORMATOS_FECHA = [
    { regex: /^(\d{4})-(\d{2})-(\d{2})$/, orden: ['a', 'm', 'd'] },
    { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, orden: ['a', 'm', 'd'] },
    { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, orden: ['d', 'm', 'a'] },
    { regex: /^(\d{2})-(\d{2})-(\d{4})$/, orden: ['d', 'm', 'a'] }
];

/** 'YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY' o 'DD-MM-YYYY' (con hora opcional detrás) → 'YYYY-MM-DD' o null. */
function normalizarFecha(valor) {
    if (typeof valor !== 'string') return null;
    const soloFecha = valor.trim().split(/[ T]/)[0];
    for (const { regex, orden } of FORMATOS_FECHA) {
        const m = soloFecha.match(regex);
        if (!m) continue;
        const partes = {};
        orden.forEach((clave, i) => { partes[clave] = m[i + 1]; });
        const iso = `${partes.a}-${partes.m}-${partes.d}`;
        const comprobacion = new Date(`${iso}T00:00:00Z`);
        if (Number.isNaN(comprobacion.getTime()) || comprobacion.toISOString().slice(0, 10) !== iso) return null;
        return iso;
    }
    return null;
}

/** Cédula sin puntos, espacios ni guiones ('1.023.456' → '1023456'), o null si queda vacía. */
function normalizarCedula(valor) {
    if (valor === null || valor === undefined) return null;
    const limpia = String(valor).replace(/[.\s-]/g, '');
    return limpia.length > 0 ? limpia : null;
}

/** 'HH:MM' o 'HH:MM:SS' → 'HH:MM:SS' o null. */
function normalizarHora(valor) {
    if (typeof valor !== 'string') return null;
    const m = valor.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const [h, min, s = '00'] = [Number(m[1]), m[2], m[3]];
    if (h > 23 || Number(min) > 59 || Number(s) > 59) return null;
    return `${String(h).padStart(2, '0')}:${min}:${s.padStart(2, '0')}`;
}

/**
 * Instantes UTC de un registro de login_biometrico. La jornada se ancla a `fecha` (la del
 * login). Si hora_logout es menor que hora_login, el logout fue pasada la medianoche.
 * @returns {{ fecha: string, login: Date|null, logout: Date|null }|null} null si la fecha no es válida
 */
function instantesDelRegistro({ fecha, hora_login, hora_logout }) {
    const fechaIso = normalizarFecha(fecha);
    if (!fechaIso) return null;

    const horaLogin = normalizarHora(hora_login);
    const horaLogout = normalizarHora(hora_logout);
    const login = horaLogin ? combinarFechaHora(fechaIso, horaLogin) : null;
    let logout = horaLogout ? combinarFechaHora(fechaIso, horaLogout) : null;
    if (login && logout && logout < login) logout = new Date(logout.getTime() + 24 * 60 * 60 * 1000);

    return { fecha: fechaIso, login, logout };
}

/** Motivo de rechazo por la hora reportada, o null si es aceptable. */
function motivoRechazoHora(instante, ahora, parametros) {
    const toleranciaFuturoMs = parametros.asislock_tolerancia_futuro_min * 60000;
    if (instante.getTime() > ahora.getTime() + toleranciaFuturoMs) return 'hora_futura';
    const maxAtrasoMs = parametros.asislock_max_horas_atraso * 3600000;
    if (ahora.getTime() - instante.getTime() > maxAtrasoMs) return 'demasiado_antiguo';
    return null;
}

function ordenar(eventos) {
    return [...eventos].sort((a, b) => a.ocurrido_en - b.ocurrido_en);
}

/** Inicio de la desconexión abierta (sin su fin_desconexion), o null. */
function desconexionAbierta(eventos) {
    let desde = null;
    for (const e of ordenar(eventos)) {
        if (e.tipo === 'inicio_desconexion' && desde === null) desde = e.ocurrido_en;
        else if (e.tipo === 'fin_desconexion') desde = null;
    }
    return desde;
}

/** Tipo de la pausa de baño/almuerzo abierta, o null. */
function pausaAbierta(eventos) {
    let tipo = null;
    for (const e of ordenar(eventos)) {
        if (e.tipo === 'inicio_bano' || e.tipo === 'inicio_almuerzo') tipo = e.tipo.slice('inicio_'.length);
        else if (e.tipo === 'fin_bano' || e.tipo === 'fin_almuerzo') tipo = null;
    }
    return tipo;
}

const ignorar = (motivo) => ({ accion: null, eventos: [], motivo });

/**
 * Qué produce un login de AsisLock en la jornada de ese día.
 * @returns {{ accion: 'entrada'|'reconexion'|null, eventos: string[], motivo: string|null }}
 */
function decidirLogin({ eventos, instante }) {
    const ordenados = ordenar(eventos);
    const entrada = ordenados.find((e) => e.tipo === 'entrada');
    if (ordenados.some((e) => e.tipo === 'salida')) return ignorar('jornada_finalizada');

    // Sin entrada, o un login anterior a la entrada registrada (p. ej. el empleado tocó
    // "entrada" en Gestor antes de que llegara el aviso del biométrico): el biométrico manda,
    // y como el cálculo toma la entrada más temprana, basta con agregarla.
    if (!entrada || instante < entrada.ocurrido_en) return { accion: 'entrada', eventos: ['entrada'], motivo: null };

    const desde = desconexionAbierta(ordenados);
    if (desde) {
        if (instante < desde) return ignorar('fuera_de_orden');
        return { accion: 'reconexion', eventos: ['fin_desconexion'], motivo: null };
    }
    return ignorar('ya_conectado');
}

/**
 * Qué produce un logout de AsisLock en la jornada de ese día.
 * @param {Object|null} horario  horario_asignado del día
 * @returns {{ accion: 'salida'|'desconexion'|null, eventos: string[], motivo: string|null }}
 */
function decidirLogout({ eventos, horario, instante, parametros }) {
    const ordenados = ordenar(eventos);
    const entrada = ordenados.find((e) => e.tipo === 'entrada');
    if (!entrada) return ignorar('sin_entrada');
    if (ordenados.some((e) => e.tipo === 'salida')) return ignorar('jornada_finalizada');
    if (desconexionAbierta(ordenados)) return ignorar('ya_desconectado');
    // jornada_evento es append-only: un logout anterior al último evento ya registrado no se
    // puede intercalar sin dejar la línea de tiempo incoherente.
    if (instante < ordenados[ordenados.length - 1].ocurrido_en) return ignorar('fuera_de_orden');

    const previos = [];
    const pausa = pausaAbierta(ordenados);
    if (pausa) previos.push(`fin_${pausa}`);

    if (horario && !horario.es_descanso) {
        const horaSalida = combinarFechaHora(horario.fecha, horario.hora_salida);
        const habilitacion = new Date(horaSalida.getTime() - parametros.minutos_habilitar_salida * 60000);
        if (instante >= habilitacion) return { accion: 'salida', eventos: [...previos, 'salida'], motivo: null };
    }
    return { accion: 'desconexion', eventos: [...previos, 'inicio_desconexion'], motivo: null };
}

module.exports = {
    PARAMETROS_DEFECTO,
    normalizarCedula,
    normalizarFecha,
    normalizarHora,
    instantesDelRegistro,
    motivoRechazoHora,
    desconexionAbierta,
    pausaAbierta,
    decidirLogin,
    decidirLogout
};
