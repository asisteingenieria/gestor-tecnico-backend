// Novedades de RRHH en la asistencia del equipo (asistencia.md §71). Puro: recibe las novedades ya leídas
// (`{ users_company_id, idnovedad_rrhh, tipo, fecha_inicial, fecha_final }`) y responde qué novedad cubre
// un día. Un día cubierto por una novedad (incapacidad, vacaciones, licencia, suspensión…) no es
// "No ha llegado" en Hoy ni "Ausente" en el histórico: es un día con novedad.
//
// No se toca la jornada guardada (el cierre puede haberla dejado 'ausente'): el cruce se hace al consultar,
// así una novedad que RRHH carga días después corrige también los días ya cerrados.

const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Tipos que no cubren el día entero (se dan por horas): se muestran, pero el día se mide como cualquier otro.
const TIPOS_PARCIALES = new Set(['horas de votacion']);

const aFecha = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));

/** ¿La novedad cubre el día completo? */
function cubreDiaCompleto(novedad) {
    return !TIPOS_PARCIALES.has(normalizar(novedad.tipo));
}

/** Novedad de RRHH vigente en `fecha` (AAAA-MM-DD) entre las de una persona; la que cubre el día gana. */
function novedadDelDia(novedades, fecha) {
    const vigentes = (novedades || []).filter((n) => {
        const desde = aFecha(n.fecha_inicial);
        const hasta = aFecha(n.fecha_final || n.fecha_inicial);
        return desde <= fecha && fecha <= hasta;
    });
    if (vigentes.length === 0) return null;
    const elegida = vigentes.find(cubreDiaCompleto) || vigentes[0];
    return {
        id: elegida.idnovedad_rrhh,
        tipo: elegida.tipo,
        desde: aFecha(elegida.fecha_inicial),
        hasta: aFecha(elegida.fecha_final || elegida.fecha_inicial),
        cubre_dia: cubreDiaCompleto(elegida)
    };
}

/** Agrupa las novedades por persona: Map users_company_id → [novedad]. */
function porEmpleado(novedades) {
    const mapa = new Map();
    for (const n of novedades || []) {
        if (!mapa.has(n.users_company_id)) mapa.set(n.users_company_id, []);
        mapa.get(n.users_company_id).push(n);
    }
    return mapa;
}

/** Fechas AAAA-MM-DD de `desde` a `hasta`, ambas incluidas. */
function fechasEntre(desde, hasta) {
    const fechas = [];
    const d = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    while (d <= fin) {
        fechas.push(d.toISOString().slice(0, 10));
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return fechas;
}

/** Map fecha → novedad del día, para los días del rango que tengan alguna. */
function novedadesPorFecha(novedades, desde, hasta) {
    const mapa = new Map();
    if (!novedades || novedades.length === 0) return mapa;
    for (const fecha of fechasEntre(desde, hasta)) {
        const n = novedadDelDia(novedades, fecha);
        if (n) mapa.set(fecha, n);
    }
    return mapa;
}

module.exports = { cubreDiaCompleto, novedadDelDia, porEmpleado, novedadesPorFecha, TIPOS_PARCIALES };
