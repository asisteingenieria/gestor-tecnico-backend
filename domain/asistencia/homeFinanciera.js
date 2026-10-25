// Home de financiera (asistencia.md §37): reglas puras para unir los indicadores por campaña,
// calcular variaciones y redactar los hallazgos que se leen a primera vista. Sin E/S.

// Puntualidad mínima esperada por campaña. Es la misma frontera que pinta en verde el reporte
// de asistencia (≥ 90 %); solo marca un hallazgo, no dispara ninguna regla de jornada.
const META_PUNTUALIDAD = 90;

// Una variación de costo por debajo de este % no se reporta como hallazgo (ruido mes a mes).
const UMBRAL_VARIACION_PCT = 10;

// Una campaña "concentra" el costo de horas extra si se lleva al menos este % del total.
const UMBRAL_CONCENTRACION_PCT = 40;

// La nómina se mueve menos que las horas extra: desde un 5 % ya vale la pena decirlo.
const UMBRAL_VARIACION_NOMINA_PCT = 5;

const MAX_HALLAZGOS = 6;

const redondear1 = (n) => Math.round(n * 10) / 10;
const pesos = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const titulo = (s) => String(s || '').toLowerCase().replace(/(^|\s)\S/g, (l) => l.toUpperCase());

/** Variación porcentual de `actual` contra `anterior`; null si no hay base para comparar. */
function variacionPct(actual, anterior) {
    const a = Number(actual) || 0;
    const b = Number(anterior) || 0;
    if (b <= 0) return null;
    return redondear1(((a - b) / b) * 100);
}

/** Diferencia en puntos porcentuales; null si falta alguno de los dos. */
function deltaPp(actual, anterior) {
    if (actual == null || anterior == null) return null;
    return redondear1(actual - anterior);
}

/**
 * Une por campaña la dotación activa, el costo de nómina del mes (salarios, prestaciones, bonos),
 * la asistencia y el costo de horas extra. Una campaña que solo aparece en el costo o en horas
 * extra (gente ya retirada, meses pasados) se agrega igual para que el costo no se pierda.
 */
function unirPorCampania({ nomina = [], costos = [], asistencia = [], horasExtra = [] }) {
    const clave = (id) => (id == null ? 'sin' : String(id));
    const mapa = new Map();
    const fila = (id, nombre) => {
        const k = clave(id);
        if (!mapa.has(k)) {
            mapa.set(k, {
                idcampania: id ?? null, campania: nombre || 'Sin campaña', empleados: 0,
                salarios: 0, prestaciones: 0, bonos: 0, costo_total: 0, sin_salario: 0,
                dinero_extra: 0, horas_extra: 0, puntualidad: null, ausencias: 0, dias_trabajados: 0
            });
        }
        return mapa.get(k);
    };
    for (const n of nomina) {
        const f = fila(n.idcampania, n.campania);
        f.empleados = n.empleados;
        f.sin_salario = n.sin_salario || 0;
    }
    for (const k of costos) {
        const f = fila(k.idcampania, k.campania);
        Object.assign(f, { salarios: k.salarios, prestaciones: k.prestaciones, bonos: k.bonos, costo_total: k.total });
        if (!f.empleados) f.empleados = k.empleados ?? 0;
    }
    for (const a of asistencia) {
        const f = fila(a.idcampania, a.campania);
        f.puntualidad = a.totales?.porcentaje_puntualidad ?? null;
        f.ausencias = a.totales?.ausencias ?? 0;
        f.dias_trabajados = a.totales?.dias_trabajados ?? 0;
        if (!f.empleados) f.empleados = a.totales?.empleados ?? 0;
    }
    for (const h of horasExtra) {
        const f = fila(h.idcampania, h.campania);
        f.dinero_extra = h.totales?.total_dinero ?? 0;
        f.horas_extra = h.totales?.total_horas ?? 0;
    }
    return [...mapa.values()].sort((x, y) => y.costo_total - x.costo_total || String(x.campania).localeCompare(String(y.campania)));
}

/**
 * Frases cortas con lo que hay que mirar este mes, de lo más urgente a lo informativo.
 * nivel: 'alerta' (requiere atención), 'bueno' (mejoró), 'info' (contexto).
 */
function hallazgos({ kpis, porCampania = [], nombreMesAnterior = 'el mes anterior', mesEnCurso = false }) {
    const lista = [];
    const he = kpis.horas_extra;

    // Un mes a medias contra uno completo siempre "baja": en el mes en curso no se compara el costo.
    const varHe = he.variacion_pct;
    if (!mesEnCurso && varHe != null && Math.abs(varHe) >= UMBRAL_VARIACION_PCT) {
        const sube = varHe > 0;
        lista.push({
            nivel: sube ? 'alerta' : 'bueno',
            texto: `El costo de horas extra ${sube ? 'subió' : 'bajó'} ${Math.abs(varHe)} % frente a ${nombreMesAnterior} (${pesos(he.dinero_anterior)} → ${pesos(he.dinero)}).`
        });
    }

    const conCosto = porCampania.filter((c) => c.dinero_extra > 0);
    if (he.dinero > 0 && conCosto.length > 1) {
        const mayor = conCosto.reduce((m, c) => (c.dinero_extra > m.dinero_extra ? c : m));
        const share = redondear1((mayor.dinero_extra / he.dinero) * 100);
        if (share >= UMBRAL_CONCENTRACION_PCT) {
            lista.push({ nivel: 'info', texto: `${titulo(mayor.campania)} concentra el ${share} % del costo de horas extra del mes (${pesos(mayor.dinero_extra)}).` });
        }
    }

    const asis = kpis.asistencia;
    if (asis.delta_pp != null && Math.abs(asis.delta_pp) >= 3) {
        const baja = asis.delta_pp < 0;
        lista.push({
            nivel: baja ? 'alerta' : 'bueno',
            texto: `La puntualidad global ${baja ? 'cayó' : 'mejoró'} ${Math.abs(asis.delta_pp)} puntos frente a ${nombreMesAnterior} (${asis.puntualidad_anterior} % → ${asis.puntualidad} %).`
        });
    }

    const bajoMeta = porCampania
        .filter((c) => c.puntualidad != null && c.puntualidad < META_PUNTUALIDAD)
        .sort((x, y) => x.puntualidad - y.puntualidad);
    if (bajoMeta.length > 0) {
        const nombres = bajoMeta.slice(0, 3).map((c) => `${titulo(c.campania)} (${c.puntualidad} %)`).join(', ');
        const resto = bajoMeta.length > 3 ? ` y ${bajoMeta.length - 3} más` : '';
        lista.push({
            nivel: 'alerta',
            texto: `${bajoMeta.length} campaña${bajoMeta.length === 1 ? '' : 's'} por debajo del ${META_PUNTUALIDAD} % de puntualidad: ${nombres}${resto}.`
        });
    }

    const dot = kpis.dotacion;
    if (dot.retiros_mes > dot.ingresos_mes) {
        lista.push({ nivel: 'alerta', texto: `Este mes salieron más personas (${dot.retiros_mes}) de las que ingresaron (${dot.ingresos_mes}).` });
    }

    if (kpis.nomina.sin_salario > 0) {
        lista.push({
            nivel: 'alerta',
            texto: `${kpis.nomina.sin_salario} empleado${kpis.nomina.sin_salario === 1 ? '' : 's'} activo${kpis.nomina.sin_salario === 1 ? '' : 's'} sin salario registrado: no suman a la nómina y sus horas extra se valoran en $ 0.`
        });
    }

    // El costo de nómina del mes en curso ya es el proyectado al cierre, así que sí se compara.
    const varNomina = kpis.nomina.variacion_pct;
    if (varNomina != null && Math.abs(varNomina) >= UMBRAL_VARIACION_NOMINA_PCT) {
        lista.push({
            nivel: 'info',
            texto: `El costo total de nómina ${varNomina > 0 ? 'sube' : 'baja'} ${String(Math.abs(varNomina)).replace('.', ',')} % frente a ${nombreMesAnterior} (${pesos(kpis.nomina.total_anterior)} → ${pesos(kpis.nomina.total)}).`
        });
    }

    if (he.dinero > 0 && kpis.nomina.total > 0) {
        const pct = redondear1((he.dinero / kpis.nomina.total) * 100);
        const cuanto = pct < 0.1 ? 'a menos del 0,1 %' : `al ${String(pct).replace('.', ',')} %`;
        lista.push({ nivel: 'info', texto: `Las horas extra del mes equivalen ${cuanto} del costo total de nómina.` });
    }

    const orden = { alerta: 0, bueno: 1, info: 2 };
    return lista.sort((a, b) => orden[a.nivel] - orden[b.nivel]).slice(0, MAX_HALLAZGOS);
}

module.exports = { META_PUNTUALIDAD, variacionPct, deltaPp, unirPorCampania, hallazgos };
