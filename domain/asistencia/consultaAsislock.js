const { sumarDias, instanteATextoBogota } = require('../../utils/fechaBogota');

/**
 * Lo que AsisLock consulta de Gestor por cédula (asistencia.md §58): el horario de cada día con su
 * modalidad (presencial / virtual) y los estados del empleado (Conectado, Break, Baño, Almuerzo,
 * Capacitación, Desconectado…) tal como Gestor los guardó en jornada_evento. Puro, sin E/S.
 *
 * Decisiones del usuario (2026-11-11):
 *   - AsisLock consulta; Gestor no empuja.
 *   - La modalidad va por día en el horario (`horario_asignado.modalidad`). Si el día no la dice, se
 *     toma la del contrato. Híbrido sin dato del día = null: no se adivina.
 *   - Los estados se devuelven desde jornada_evento, no desde la bitácora de AsisLock: así incluyen
 *     también lo que se marcó en el portal, por el molinete o lo que corrigió el jefe.
 */

const MAX_DIAS_HORARIO = 31;

const sinTildes = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

const VIRTUAL = ['virtual', 'remoto', 'teletrabajo', 'trabajo en casa', 'trabajo_en_casa', 'casa', 'home office', 'homeoffice'];

/**
 * Texto libre (malla "Modelo Trabajo", formulario) → 'presencial' | 'virtual' | null.
 * 'Híbrido' y lo desconocido dan null: no dicen cómo trabaja ESE día.
 */
function normalizarModalidad(valor) {
    const t = sinTildes(valor).replace(/\s+/g, ' ');
    if (!t) return null;
    if (t === 'presencial') return 'presencial';
    if (VIRTUAL.includes(t)) return 'virtual';
    return null;
}

/** Nombre del catálogo `modalidad` del contrato → 'presencial' | 'virtual' | 'hibrido' | null. */
function modalidadDeContrato(nombre) {
    const t = sinTildes(nombre);
    if (t === 'hibrido') return 'hibrido';
    return normalizarModalidad(t);
}

/** Modalidad del día: la del horario y, si no la tiene, la del contrato (solo si es presencial/virtual). */
function modalidadDelDia(horario, modalidadContrato) {
    if (horario?.modalidad === 'presencial' || horario?.modalidad === 'virtual') {
        return { modalidad: horario.modalidad, modalidad_origen: 'horario' };
    }
    if (modalidadContrato === 'presencial' || modalidadContrato === 'virtual') {
        return { modalidad: modalidadContrato, modalidad_origen: 'contrato' };
    }
    return { modalidad: null, modalidad_origen: null };
}

const hora = (v) => (v == null ? null : String(v).slice(0, 8));
const fechaTexto = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Fechas 'YYYY-MM-DD' de desde a hasta, ambos incluidos. */
function fechasDelRango(desde, hasta) {
    const fechas = [];
    for (let f = desde; f <= hasta && fechas.length <= MAX_DIAS_HORARIO; f = sumarDias(f, 1)) fechas.push(f);
    return fechas;
}

/**
 * Un registro por día del rango, tenga o no horario.
 * @param {Array} horarios  filas de horario_asignado (con `plantilla`) del rango
 * @param {string|null} modalidadContrato  de modalidadDeContrato
 */
function horarioParaAsislock({ desde, hasta, horarios, modalidadContrato }) {
    const porFecha = new Map(horarios.map((h) => [fechaTexto(h.fecha), h]));
    return fechasDelRango(desde, hasta).map((fecha) => {
        const h = porFecha.get(fecha) ?? null;
        const descanso = Boolean(h?.es_descanso);
        const trabaja = h && !descanso;
        return {
            fecha,
            tiene_horario: Boolean(h),
            es_descanso: descanso,
            hora_entrada: trabaja ? hora(h.hora_entrada) : null,
            hora_salida: trabaja ? hora(h.hora_salida) : null,
            hora_almuerzo_inicio: trabaja ? hora(h.hora_almuerzo_inicio) : null,
            minutos_almuerzo: trabaja ? Number(h.minutos_almuerzo ?? 0) : null,
            plantilla: h?.plantilla ?? null,
            notas: h?.notas ?? null,
            ...modalidadDelDia(h, modalidadContrato)
        };
    });
}

// Estado en que queda el empleado después de cada evento de su jornada.
const ESTADO_TRAS_EVENTO = {
    entrada: 'conectado',
    inicio_bano: 'bano',
    inicio_break: 'break',
    inicio_almuerzo: 'almuerzo',
    inicio_capacitacion: 'capacitacion',
    fin_bano: 'conectado',
    fin_break: 'conectado',
    fin_almuerzo: 'conectado',
    fin_capacitacion: 'conectado',
    inicio_desconexion: 'desconectado',
    fin_desconexion: 'conectado',
    salida: 'finalizado',
    inicio_extra: 'hora_extra',
    fin_extra: 'finalizado'
};

const ESTADOS = ['sin_entrada', 'ausente', ...new Set(Object.values(ESTADO_TRAS_EVENTO))];

/**
 * Línea de estados del día y estado actual.
 * @param {Array} eventos  jornada_evento del día ({ tipo, ocurrido_en: Date, origen })
 * @param {Object|null} jornada  fila de jornada (para 'ausente'), o null si no hay
 */
function estadosDelDia(eventos, jornada) {
    const ordenados = [...eventos].sort((a, b) => a.ocurrido_en - b.ocurrido_en);
    const estados = [];
    for (const e of ordenados) {
        const estado = ESTADO_TRAS_EVENTO[e.tipo];
        if (!estado) continue;
        estados.push({
            estado,
            evento: e.tipo,
            desde: e.ocurrido_en.toISOString(),
            hora: instanteATextoBogota(e.ocurrido_en).slice(11, 19),
            origen: e.origen ?? null
        });
    }
    const ultimo = estados[estados.length - 1] ?? null;
    let actual;
    if (ultimo) actual = { estado: ultimo.estado, desde: ultimo.desde, hora: ultimo.hora, origen: ultimo.origen };
    else actual = { estado: jornada?.estado === 'ausente' ? 'ausente' : 'sin_entrada', desde: null, hora: null, origen: null };
    return { estado_actual: actual, estados };
}

module.exports = {
    MAX_DIAS_HORARIO,
    ESTADOS,
    normalizarModalidad,
    modalidadDeContrato,
    modalidadDelDia,
    fechasDelRango,
    horarioParaAsislock,
    estadosDelDia
};
