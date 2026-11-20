/**
 * Reglas puras de mantenimientos, traslados de puesto y bajas de activos (rol tecnicoInventario).
 * Sin base de datos: las usa controllers/mantenimientoActivoController.js y las cubre
 * tests/mantenimientoActivos.test.js.
 */

// Equipos a los que aplica el mantenimiento preventivo (pasta térmica, limpieza, formateo) y la alerta.
const TIPOS_COMPUTADOR = ['ECC-CPU', 'ECC-POR', 'ECC-SER'];

const TAREAS_PREVENTIVAS = {
    pasta_termica: 'Cambio de pasta térmica',
    limpieza_componentes: 'Limpieza de componentes',
    formateo: 'Formateo'
};

// Meses desde el último mantenimiento preventivo para cada color de alerta.
const MESES_ALERTA_NARANJA = 3;
const MESES_ALERTA_ROJA = 6;

const LARGO_MIN_TEXTO = 10;
const LARGO_MAX_TEXTO = 2000;
const LARGO_MAX_PUESTO = 50;
const SITES = ['Site A', 'Site B'];

const esComputador = (tipoActivo) => TIPOS_COMPUTADOR.includes(tipoActivo);

const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const marcado = (v) => v === true || v === 1 || v === '1' || v === 'true';

/**
 * Valida el cuerpo de un mantenimiento.
 * @returns {{ ok: true, datos: object } | { ok: false, error: string }}
 */
function validarMantenimiento(body, tipoActivo) {
    const b = body || {};
    const tipo = b.tipo;
    const descripcion = texto(b.descripcion);

    if (descripcion.length > LARGO_MAX_TEXTO) {
        return { ok: false, error: `La descripción no puede pasar de ${LARGO_MAX_TEXTO} caracteres` };
    }

    if (tipo === 'preventivo') {
        if (!esComputador(tipoActivo)) {
            return { ok: false, error: 'El mantenimiento preventivo solo aplica a computadores, portátiles y servidores' };
        }
        const tareas = {
            pasta_termica: marcado(b.pasta_termica),
            limpieza_componentes: marcado(b.limpieza_componentes),
            formateo: marcado(b.formateo)
        };
        if (!Object.values(tareas).some(Boolean)) {
            return { ok: false, error: 'Marque al menos una tarea del mantenimiento preventivo' };
        }
        return { ok: true, datos: { tipo, ...tareas, descripcion: descripcion || null } };
    }

    if (tipo === 'correctivo') {
        if (descripcion.length < LARGO_MIN_TEXTO) {
            return { ok: false, error: `Describa el mantenimiento correctivo (mínimo ${LARGO_MIN_TEXTO} caracteres)` };
        }
        return {
            ok: true,
            datos: { tipo, pasta_termica: false, limpieza_componentes: false, formateo: false, descripcion }
        };
    }

    return { ok: false, error: 'El tipo de mantenimiento debe ser "preventivo" o "correctivo"' };
}

/** Valida la observación (motivo) de una solicitud de baja. */
function validarMotivoBaja(motivo) {
    const m = texto(motivo);
    if (m.length < LARGO_MIN_TEXTO) {
        return { ok: false, error: `Escriba la observación de por qué se da de baja el equipo (mínimo ${LARGO_MIN_TEXTO} caracteres)` };
    }
    if (m.length > LARGO_MAX_TEXTO) {
        return { ok: false, error: `La observación no puede pasar de ${LARGO_MAX_TEXTO} caracteres` };
    }
    return { ok: true, motivo: m };
}

/** Comentario opcional del administrador al aprobar o rechazar. */
function normalizarComentario(comentario) {
    const c = texto(comentario);
    return c ? c.slice(0, LARGO_MAX_TEXTO) : null;
}

/**
 * Valida un traslado de puesto. `site` es opcional: undefined = no se cambia, '' o null = sin site.
 * @returns {{ ok: true, puesto: string, site: string|null|undefined } | { ok: false, error: string }}
 */
function validarTraslado(body) {
    const b = body || {};
    const puesto = texto(b.puesto);
    if (!puesto) return { ok: false, error: 'Indique el nuevo puesto' };
    if (puesto.length > LARGO_MAX_PUESTO) {
        return { ok: false, error: `El puesto no puede pasar de ${LARGO_MAX_PUESTO} caracteres` };
    }
    let site;
    if (b.site !== undefined) {
        site = texto(b.site) || null;
        if (site !== null && !SITES.includes(site)) {
            return { ok: false, error: `Site inválido. Use: ${SITES.join(', ')}` };
        }
    }
    return { ok: true, puesto, site };
}

/** Suma meses de calendario (31-ene + 1 mes = 28/29-feb, no 3-mar). */
function sumarMeses(fecha, meses) {
    const d = new Date(fecha.getTime());
    const dia = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + meses);
    const ultimoDia = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dia, ultimoDia));
    return d;
}

/**
 * Color de la alerta según la fecha del último mantenimiento preventivo.
 * - 'al_dia'       → menos de 3 meses
 * - 'naranja'      → 3 meses o más
 * - 'rojo'         → 6 meses o más (mantenimiento urgente)
 * - 'sin_registro' → nunca se ha registrado un mantenimiento
 */
function nivelAlerta(fechaUltimo, ahora = new Date()) {
    if (!fechaUltimo) return 'sin_registro';
    const ultimo = fechaUltimo instanceof Date ? fechaUltimo : new Date(fechaUltimo);
    if (Number.isNaN(ultimo.getTime())) return 'sin_registro';
    if (ahora >= sumarMeses(ultimo, MESES_ALERTA_ROJA)) return 'rojo';
    if (ahora >= sumarMeses(ultimo, MESES_ALERTA_NARANJA)) return 'naranja';
    return 'al_dia';
}

/** Días transcurridos desde la fecha (para mostrar "hace N días"). */
function diasDesde(fecha, ahora = new Date()) {
    if (!fecha) return null;
    const f = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(f.getTime())) return null;
    return Math.max(0, Math.floor((ahora - f) / 86400000));
}

/** La más reciente de dos fechas (cualquiera puede ser null). */
function fechaMasReciente(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return new Date(a) >= new Date(b) ? a : b;
}

/** Texto de las tareas marcadas de un preventivo, para listas y PDF. */
function describirTareas(m) {
    return Object.entries(TAREAS_PREVENTIVAS)
        .filter(([campo]) => marcado(m[campo]))
        .map(([, label]) => label);
}

module.exports = {
    TIPOS_COMPUTADOR,
    TAREAS_PREVENTIVAS,
    MESES_ALERTA_NARANJA,
    MESES_ALERTA_ROJA,
    SITES,
    esComputador,
    validarMantenimiento,
    validarMotivoBaja,
    normalizarComentario,
    validarTraslado,
    sumarMeses,
    nivelAlerta,
    diasDesde,
    fechaMasReciente,
    describirTareas
};
