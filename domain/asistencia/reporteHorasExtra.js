// Reglas puras del reporte mensual de horas extras (asistencia.md §32). El reporte ya no se arma
// ni se envía a mano: se calcula con las horas extra aprobadas del mes. Cada hora extra lleva su
// clase (las 5 del formato V.3). Financiera ve, además del mismo reporte que el jefe, el costo en
// dinero por campaña y totales. Puro: sin E/S; las fechas llegan como 'YYYY-MM-DD'.

// Las 5 columnas de horas del formato, en su orden.
const CLASES = ['recargo_nocturno', 'extras_diurnas', 'extras_nocturnas', 'dominicales_festivas', 'extras_dominicales_festivas'];

// Las que son horas extra propiamente (se pagan la hora completa + el recargo). Las otras dos son
// recargos sobre horas ordinarias: se paga solo el recargo.
const CLASES_EXTRA = ['extras_diurnas', 'extras_nocturnas', 'extras_dominicales_festivas'];

// Jornada mensual legal en Colombia para sacar el valor de la hora: salario / 240.
const DIVISOR_HORAS_MES = 240;

// Factor sobre el valor de la hora ordinaria por clase (ley colombiana, confirmado con el usuario):
// recargo nocturno +35 %, extra diurna +25 %, extra nocturna +75 %, dominical/festiva +90 % y extra
// dominical/festiva +115 %. Los recargos pagan solo el %; las extras pagan la hora + el %, por eso
// su factor es 1 + %.
const FACTOR_DINERO = {
    recargo_nocturno: 0.35,
    extras_diurnas: 1.25,
    extras_nocturnas: 1.75,
    dominicales_festivas: 0.90,
    extras_dominicales_festivas: 2.15
};

function redondear2(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.round(Number(`${x}e2`)) / 100;
}

function esPeriodo(periodo) {
    return typeof periodo === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo);
}

const periodoDe = (fecha) => String(fecha).slice(0, 7);
const esClase = (clase) => CLASES.includes(clase);

function horasDeMinutos(minutos) {
    return redondear2((Number(minutos) || 0) / 60);
}

function sumar(fila, clases) {
    return redondear2(clases.reduce((acc, c) => acc + (Number(fila[c]) || 0), 0));
}

const totalHoras = (fila) => sumar(fila, CLASES);
const horasExtraDe = (fila) => sumar(fila, CLASES_EXTRA);

/** Valor de una hora ordinaria a partir del salario mensual. 0 si no hay salario. */
function valorHora(salarioMensual) {
    const s = Number(salarioMensual);
    return Number.isFinite(s) && s > 0 ? s / DIVISOR_HORAS_MES : 0;
}

/** Dinero de una clase: horas × valorHora × factor de la clase. */
function dineroDeClase(clase, horas, vh) {
    return redondear2((Number(horas) || 0) * vh * (FACTOR_DINERO[clase] || 0));
}

/** Dinero total de una fila (un empleado) sumando sus 5 clases. */
function dineroDeFila(fila, vh) {
    return redondear2(CLASES.reduce((acc, c) => acc + dineroDeClase(c, fila[c], vh), 0));
}

/**
 * Arma una fila del reporte a partir de los minutos aprobados por clase de un empleado.
 * `conDinero` agrega el valor en pesos (solo para financiera). `base` trae los datos del empleado
 * (documento, nombre, campania, etc.) ya resueltos por el repositorio.
 */
function filaReporte(base, minutosPorClase, { conDinero } = {}) {
    const fila = { ...base };
    for (const c of CLASES) fila[c] = horasDeMinutos(minutosPorClase[c] ?? 0);
    fila.total_horas = totalHoras(fila);
    if (conDinero) {
        const vh = valorHora(base.salario);
        fila.valor_hora = redondear2(vh);
        for (const c of CLASES) fila[`${c}_dinero`] = dineroDeClase(c, fila[c], vh);
        fila.total_dinero = dineroDeFila(fila, vh);
    }
    return fila;
}

/** Totales (horas y, si las filas traen dinero, pesos) de un conjunto de filas ya armadas. */
function totalesDe(filas) {
    const t = Object.fromEntries(CLASES.map((c) => [c, 0]));
    let totalHorasAcum = 0;
    let totalDinero = 0;
    const conDinero = filas.some((f) => f.total_dinero !== undefined);
    for (const f of filas) {
        for (const c of CLASES) t[c] = redondear2(t[c] + (Number(f[c]) || 0));
        totalHorasAcum = redondear2(totalHorasAcum + (Number(f.total_horas) || 0));
        totalDinero = redondear2(totalDinero + (Number(f.total_dinero) || 0));
    }
    return { ...t, total_horas: totalHorasAcum, ...(conDinero ? { total_dinero: totalDinero } : {}), empleados: filas.length };
}

module.exports = {
    CLASES,
    CLASES_EXTRA,
    FACTOR_DINERO,
    DIVISOR_HORAS_MES,
    esPeriodo,
    periodoDe,
    esClase,
    horasDeMinutos,
    totalHoras,
    horasExtraDe,
    valorHora,
    dineroDeClase,
    dineroDeFila,
    filaReporte,
    totalesDe
};
