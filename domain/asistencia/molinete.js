const { combinarFechaHora } = require('../../utils/fechaBogota');
const { extraAbierto, dentroDeHoraExtra } = require('./asislock');

/**
 * Reglas puras de la integración con el molinete (ZKBioSecurity) para el staff: STAFF,
 * ADMINISTRATIVO y TECNOLOGIA. Sin E/S: el servicio reúne eventos, horario y parámetros y aquí
 * solo se decide qué produce cada marcación en la jornada. Ver asistencia.md §54.
 *
 * Decisiones de negocio (2026-11-03):
 *   - La cédula viene en `last_name` de acc_transaction; el `pin` es un código interno.
 *   - Primera marcación del día, por cualquier lector = entrada. El contador arranca ahí.
 *   - Las marcaciones intermedias son "cruces": NO cuentan como tiempo no laborado. Se guardan
 *     y se cuentan para la trazabilidad, pero no producen eventos de jornada.
 *   - Salida: una marcación por un lector de salida (…-Out) desde la ventana de salida del horario
 *     (hora de salida − minutos_habilitar_salida). Si no la hay, el cierre del día pone la salida en
 *     la última marcación del molinete (cierreService).
 *   - Tras la salida, si hay hora extra aprobada, una marcación en su franja la abre (inicio_extra)
 *     y la siguiente salida la cierra (fin_extra), como con AsisLock.
 */

const DEPARTAMENTOS_DEFECTO = ['STAFF', 'ADMINISTRATIVO', 'TECNOLOGIA'];

/** reader_name '10.255.255.249-1-In' → 'entrada'; '…-Out' → 'salida'; otro → 'desconocido'. */
function sentidoDeLector(lector) {
    const t = String(lector ?? '').trim().toLowerCase();
    if (t.endsWith('-in')) return 'entrada';
    if (t.endsWith('-out')) return 'salida';
    return 'desconocido';
}

/** 'STAFF, administrativo,TECNOLOGIA' → ['STAFF','ADMINISTRATIVO','TECNOLOGIA']; vacío → los de defecto. */
function departamentosDe(valor) {
    const lista = String(valor ?? '').split(',').map((d) => d.trim().toUpperCase()).filter(Boolean);
    return lista.length > 0 ? lista : [...DEPARTAMENTOS_DEFECTO];
}

const ordenar = (eventos) => [...eventos].sort((a, b) => a.ocurrido_en - b.ocurrido_en);
const ignorar = (motivo) => ({ accion: null, eventos: [], motivo });

/**
 * Qué produce una marcación del molinete en la jornada de ese día.
 * @param {Array}  eventos              jornada_evento del día
 * @param {Object|null} horario         horario_asignado del día
 * @param {Date}   instante             hora de la marcación (UTC)
 * @param {string} sentido              'entrada' | 'salida' | 'desconocido'
 * @param {string} fecha                fecha laboral 'YYYY-MM-DD'
 * @param {Array}  horasExtraAprobadas  hora_extra aprobadas ese día
 * @param {Object} parametros           asistencia_parametro (minutos_habilitar_salida)
 * @returns {{ accion: string|null, eventos: string[], motivo: string|null }}
 *          accion 'cruce' = marcación válida sin eventos de jornada.
 */
function decidirMarcacion({ eventos, horario, instante, sentido, fecha, horasExtraAprobadas = [], parametros }) {
    const ordenados = ordenar(eventos);
    const entrada = ordenados.find((e) => e.tipo === 'entrada');
    const ultimo = ordenados[ordenados.length - 1];

    // Jornada cerrada: solo cuenta si es su hora extra aprobada.
    if (ordenados.some((e) => e.tipo === 'salida')) {
        if (extraAbierto(ordenados)) {
            if (sentido !== 'salida') return { accion: 'cruce', eventos: [], motivo: 'en_hora_extra' };
            if (instante < ultimo.ocurrido_en) return ignorar('fuera_de_orden');
            return { accion: 'fin_extra', eventos: ['fin_extra'], motivo: null };
        }
        if (sentido !== 'salida' && dentroDeHoraExtra(instante, fecha, horasExtraAprobadas)) {
            return { accion: 'entrada_extra', eventos: ['inicio_extra'], motivo: null };
        }
        return ignorar('jornada_finalizada');
    }

    // Primera marcación del día (o una anterior a la entrada que ya había): es la entrada. El
    // cálculo toma la entrada más temprana, así que basta con agregarla.
    if (!entrada || instante < entrada.ocurrido_en) return { accion: 'entrada', eventos: ['entrada'], motivo: null };

    if (sentido === 'salida' && horario && !horario.es_descanso) {
        const horaSalida = combinarFechaHora(horario.fecha, horario.hora_salida);
        const habilitacion = new Date(horaSalida.getTime() - parametros.minutos_habilitar_salida * 60000);
        // jornada_evento es append-only: una salida anterior al último evento no se intercala.
        if (instante >= habilitacion && instante >= ultimo.ocurrido_en) {
            return { accion: 'salida', eventos: ['salida'], motivo: null };
        }
    }
    return { accion: 'cruce', eventos: [], motivo: null };
}

/**
 * Hora en que el cierre del día pone la salida: la última marcación válida del molinete posterior
 * a la entrada, o null si no hay ninguna (el cierre usa entonces la hora de salida del horario).
 * @param {Array} marcaciones  molinete_marcacion del día ({ ocurrido_en, resultado })
 * @param {Date}  entrada      instante de la entrada
 */
function salidaDeCierre(marcaciones, entrada) {
    let ultima = null;
    for (const m of marcaciones) {
        if (m.resultado === 'rechazado' || !m.ocurrido_en) continue;
        if (m.ocurrido_en > entrada && (!ultima || m.ocurrido_en > ultima)) ultima = m.ocurrido_en;
    }
    return ultima;
}

/**
 * Resumen del molinete de un día para las pantallas (trazabilidad, Equipo hoy).
 * @param {Array} marcaciones  del día, ordenadas por ocurrido_en ({ ocurrido_en, sentido, lector, accion, resultado })
 * @returns {Object|null} null si el molinete no registró nada válido ese día
 */
function resumenDelDia(marcaciones) {
    const validas = marcaciones.filter((m) => m.resultado !== 'rechazado');
    if (validas.length === 0) return null;
    const ultima = validas[validas.length - 1];
    return {
        total: validas.length,
        cruces_intermedios: validas.filter((m) => m.accion === 'cruce').length,
        primera: validas[0].ocurrido_en,
        ultima: { ocurrido_en: ultima.ocurrido_en, sentido: ultima.sentido },
        entradas: validas.filter((m) => m.sentido === 'entrada').length,
        salidas: validas.filter((m) => m.sentido === 'salida').length
    };
}

module.exports = {
    DEPARTAMENTOS_DEFECTO,
    sentidoDeLector,
    departamentosDe,
    decidirMarcacion,
    salidaDeCierre,
    resumenDelDia
};
