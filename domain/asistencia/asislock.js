const { combinarFechaHora } = require('../../utils/fechaBogota');

/**
 * Reglas puras de la integración con AsisLock (login biométrico). Sin E/S: el servicio
 * reúne eventos, horario y parámetros y aquí solo se decide qué evento de jornada produce
 * cada login/logout. Ver asistencia.md §18.
 *
 * Decisiones de negocio (2026-10-11):
 *   - `usuario` de AsisLock es la cédula del empleado.
 *   - `id` es opcional (2026-10-19): otro sistema envía sin él. Sin id, cada evento se
 *     identifica por cédula + fecha + hora (llaveEvento / llaveSesion).
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

// Parte de una llave: el valor normalizado si se pudo interpretar; si no, el crudo recortado,
// para que un reenvío del mismo dato malo produzca la misma llave.
const pieza = (normalizado, crudo) => normalizado ?? String(crudo ?? '').trim().slice(0, 20);

function piezasSinId(registro) {
    return [
        pieza(normalizarCedula(registro.usuario), registro.usuario),
        pieza(normalizarFecha(registro.fecha), registro.fecha)
    ];
}

/**
 * Llave de idempotencia de un login o logout (asislock_registro, junto con el evento). Con id
 * de AsisLock, el id; sin id (sistemas que no lo envían), cédula + fecha + hora del evento.
 */
function llaveEvento(registro, evento) {
    if (registro.id) return `id:${registro.id}`;
    const hora = registro[`hora_${evento}`];
    return `cc:${[...piezasSinId(registro), pieza(normalizarHora(hora), hora)].join('|')}`;
}

/**
 * Llave de la fila en login_biometrico (una por sesión). Con id, el id; sin id, cédula + fecha
 * + hora_login. Un logout suelto sin id ni hora_login lleva su propia llave ('-' en vez del
 * login); el servicio primero intenta cerrar con él la sesión abierta de esa cédula.
 */
function llaveSesion(registro) {
    if (registro.id) return `id:${registro.id}`;
    if (registro.hora_login) {
        return `cc:${[...piezasSinId(registro), pieza(normalizarHora(registro.hora_login), registro.hora_login)].join('|')}`;
    }
    return `cc:${[...piezasSinId(registro), '-', pieza(normalizarHora(registro.hora_logout), registro.hora_logout)].join('|')}`;
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

// Pausas que AsisLock reporta en `estado_conexion`. Baño, break y almuerzo son tiempo libre;
// capacitación cuenta como laborada (la distinción de descuento vive en calcularJornada).
const TIPOS_PAUSA = ['bano', 'break', 'almuerzo', 'capacitacion'];

/** `estado_conexion` de AsisLock → 'conectado' | 'desconectado' | una pausa | null (desconocido). */
function normalizarEstado(valor) {
    const t = String(valor ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (t === 'conectado') return 'conectado';
    if (t === 'desconectado') return 'desconectado';
    if (TIPOS_PAUSA.includes(t)) return t;
    return null;
}

/** Tipo de la pausa (baño/break/almuerzo/capacitación) abierta, o null. */
function pausaAbierta(eventos) {
    let tipo = null;
    for (const e of ordenar(eventos)) {
        if (e.tipo.startsWith('inicio_') && TIPOS_PAUSA.includes(e.tipo.slice(7))) tipo = e.tipo.slice(7);
        else if (e.tipo.startsWith('fin_') && TIPOS_PAUSA.includes(e.tipo.slice(4))) tipo = null;
    }
    return tipo;
}

/** ¿Hay un bloque de hora extra abierto (inicio_extra sin su fin_extra)? */
function extraAbierto(eventos) {
    let abierto = false;
    for (const e of ordenar(eventos)) {
        if (e.tipo === 'inicio_extra') abierto = true;
        else if (e.tipo === 'fin_extra') abierto = false;
    }
    return abierto;
}

// Minutos de gracia para considerar que un login "entra" a la hora extra aunque llegue un poco
// antes del inicio de la franja aprobada (llegar tarde dentro de la franja siempre cuenta).
const GRACIA_INGRESO_EXTRA_MIN = 15;

/** ¿El instante cae dentro de alguna franja de hora extra aprobada ese día (con gracia al inicio)? */
function dentroDeHoraExtra(instante, fecha, horasExtraAprobadas) {
    if (!instante || !fecha) return false;
    for (const he of horasExtraAprobadas || []) {
        if (!he.hora_inicio || !he.hora_fin) continue;
        const ini = combinarFechaHora(fecha, he.hora_inicio);
        let fin = combinarFechaHora(fecha, he.hora_fin);
        if (fin <= ini) fin = new Date(fin.getTime() + 24 * 60 * 60 * 1000); // cruza la medianoche
        if (instante >= new Date(ini.getTime() - GRACIA_INGRESO_EXTRA_MIN * 60000) && instante <= fin) return true;
    }
    return false;
}

const ignorar = (motivo) => ({ accion: null, eventos: [], motivo });

/**
 * Qué produce un "login" de AsisLock en la jornada de ese día. AsisLock manda un registro por cada
 * cambio de estado (Conectado, Break, Almuerzo, Capacitación, Baño) como evento 'login', con el
 * estado en `estado_conexion`: por eso aquí se interpreta el estado para abrir/cerrar pausas.
 * @returns {{ accion: string|null, eventos: string[], motivo: string|null }}
 */
function decidirLogin({ eventos, instante, estado, fecha, horasExtraAprobadas = [] }) {
    const ordenados = ordenar(eventos);
    const entrada = ordenados.find((e) => e.tipo === 'entrada');
    const estadoNorm = normalizarEstado(estado);
    const pausa = pausaAbierta(ordenados);
    const desde = desconexionAbierta(ordenados);

    // Jornada ya cerrada con salida: solo se reabre si el login cae en una hora extra aprobada
    // (el agente volvió más tarde para su tiempo extra). Si no, se ignora como hasta ahora.
    if (ordenados.some((e) => e.tipo === 'salida')) {
        if (extraAbierto(ordenados)) return ignorar('en_hora_extra');
        if ((estadoNorm === 'conectado' || estadoNorm === null) && dentroDeHoraExtra(instante, fecha, horasExtraAprobadas)) {
            return { accion: 'entrada_extra', eventos: ['inicio_extra'], motivo: null };
        }
        return ignorar('jornada_finalizada');
    }

    // Un estado de pausa (break/baño/almuerzo/capacitación) abre esa pausa, cerrando antes otra
    // que estuviera abierta. Requiere una jornada en curso (con entrada y sin desconexión).
    if (estadoNorm && estadoNorm !== 'conectado' && estadoNorm !== 'desconectado') {
        if (!entrada) return ignorar('sin_entrada');
        if (desde) return ignorar('desconectado');
        if (pausa === estadoNorm) return ignorar('ya_en_pausa');
        const eventosOut = pausa ? [`fin_${pausa}`] : [];
        eventosOut.push(`inicio_${estadoNorm}`);
        return { accion: `pausa_${estadoNorm}`, eventos: eventosOut, motivo: null };
    }

    // Conectado (o estado desconocido/ausente, por compatibilidad): entrada / fin de pausa /
    // reconexión. Sin entrada, o un login anterior a la entrada registrada (p. ej. el empleado
    // tocó "entrada" en Gestor antes de que llegara el biométrico): el biométrico manda y, como
    // el cálculo toma la entrada más temprana, basta con agregarla.
    if (!entrada || instante < entrada.ocurrido_en) return { accion: 'entrada', eventos: ['entrada'], motivo: null };
    if (pausa) return { accion: 'fin_pausa', eventos: [`fin_${pausa}`], motivo: null };
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

    // Un logout con la hora extra abierta la cierra (no vuelve a "salida": la jornada ya cerró).
    if (extraAbierto(ordenados)) {
        if (instante < ordenados[ordenados.length - 1].ocurrido_en) return ignorar('fuera_de_orden');
        return { accion: 'fin_extra', eventos: ['fin_extra'], motivo: null };
    }

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

// Cómo entró el empleado, según `conectado_biometrico` del login: 'Presencial' = puso la huella
// en el biométrico y cruzó el molinete; 'Teletrabajo' = solo se logueó en AsisLock. Cualquier
// otro valor (p. ej. el 'close' que manda el logout) no dice cómo entró.
function modalidadIngreso(valor) {
    const texto = String(valor ?? '').trim().toLowerCase();
    if (texto === 'presencial') return 'presencial';
    if (texto === 'teletrabajo') return 'teletrabajo';
    return null;
}

/**
 * Resumen de AsisLock de un día para las pantallas (Mi jornada, Equipo hoy, trazabilidad).
 * Cuentan los avisos no rechazados: un login ignorado por `ya_conectado` también dice que la
 * persona estaba conectada.
 * @param {Array} registros  avisos del día ({ evento, ocurrido_en, resultado, conectado_biometrico,
 *                           ip_local, ip_publica, aplicativo }), ordenados por ocurrido_en
 * @returns {Object|null} null si AsisLock no reportó nada válido ese día
 */
function resumenDelDia(registros) {
    const validos = registros.filter((r) => r.resultado !== 'rechazado');
    if (validos.length === 0) return null;
    const logins = validos.filter((r) => r.evento === 'login');
    const ultimo = validos[validos.length - 1];
    const ultimoLogin = logins[logins.length - 1] ?? null;
    const referencia = ultimoLogin ?? ultimo;
    return {
        modalidad: ultimoLogin ? modalidadIngreso(ultimoLogin.conectado_biometrico) : null,
        modalidades: [...new Set(logins.map((r) => modalidadIngreso(r.conectado_biometrico)).filter(Boolean))],
        primer_login: logins[0]?.ocurrido_en ?? null,
        ultimo_evento: { evento: ultimo.evento, ocurrido_en: ultimo.ocurrido_en },
        conectado: ultimo.evento === 'login',
        ip_local: referencia.ip_local ?? null,
        ip_publica: referencia.ip_publica ?? null,
        aplicativo: referencia.aplicativo ?? null
    };
}

module.exports = {
    PARAMETROS_DEFECTO,
    normalizarCedula,
    normalizarFecha,
    normalizarHora,
    instantesDelRegistro,
    llaveEvento,
    llaveSesion,
    motivoRechazoHora,
    desconexionAbierta,
    pausaAbierta,
    extraAbierto,
    dentroDeHoraExtra,
    normalizarEstado,
    decidirLogin,
    decidirLogout,
    modalidadIngreso,
    resumenDelDia
};
