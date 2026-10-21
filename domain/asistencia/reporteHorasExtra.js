// Reglas del reporte mensual de horas extras que cada jefe de área envía a financiera
// (asistencia.md §32, migración 072). Reemplaza el Excel "FORMATO REPORTE DE HORAS EXTRAS V.3".
// Puro: sin E/S; las fechas llegan como 'YYYY-MM-DD' ya calculadas en hora de Colombia.

// Las 5 columnas de horas del formato, en su orden.
const CLASES = ['recargo_nocturno', 'extras_diurnas', 'extras_nocturnas', 'dominicales_festivas', 'extras_dominicales_festivas'];

// Las que son horas extra propiamente (las que el empleado solicita y el jefe aprueba). El recargo
// nocturno y el dominical/festivo (90%) son recargos sobre horas ordinarias: no pasan por la
// aprobación de horas extra y el jefe los reporta libremente.
const CLASES_EXTRA = ['extras_diurnas', 'extras_nocturnas', 'extras_dominicales_festivas'];

const ESTADOS_EDITABLES = ['borrador', 'devuelto'];
const HORAS_MAXIMAS_POR_CLASE = 31 * 24; // un mes entero
const TOLERANCIA_HORAS = 0.01;

// Por notación exponencial: 1.255 * 100 da 125.4999… en punto flotante y redondearía a 1.25.
function redondear2(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return x;
    const exacto = Math.round(Number(`${x}e2`)) / 100;
    return Number.isNaN(exacto) ? Math.round(x * 100) / 100 : exacto;
}

function esPeriodo(periodo) {
    return typeof periodo === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodo);
}

const periodoDe = (fecha) => String(fecha).slice(0, 7);

function horasDeMinutos(minutos) {
    return redondear2((Number(minutos) || 0) / 60);
}

function sumar(fila, clases) {
    return redondear2(clases.reduce((acc, c) => acc + (Number(fila[c]) || 0), 0));
}

const totalHoras = (fila) => sumar(fila, CLASES);
const horasExtraDe = (fila) => sumar(fila, CLASES_EXTRA);

function puedeEditarse(estado) {
    return !estado || ESTADOS_EDITABLES.includes(estado);
}

/** Solo un reporte enviado se aprueba o se devuelve. */
function puedeRevisarse(estado) {
    return estado === 'enviado';
}

/**
 * Normaliza lo que manda el jefe: números a 2 decimales, aclaraciones recortadas, y descarta las
 * filas vacías (sin horas, sin aclaración y sin horas aprobadas).
 */
function normalizarFilas(filas, minutosAprobadosPor = {}) {
    return filas
        .map((f) => {
            const fila = { users_company_id: Number(f.users_company_id) };
            for (const c of CLASES) fila[c] = f[c] === undefined || f[c] === null || f[c] === '' ? 0 : redondear2(f[c]);
            const aclaraciones = typeof f.aclaraciones === 'string' ? f.aclaraciones.trim() : '';
            fila.aclaraciones = aclaraciones || null;
            return fila;
        })
        .filter((f) => totalHoras(f) > 0 || f.aclaraciones || (minutosAprobadosPor[f.users_company_id] ?? 0) > 0);
}

/**
 * Errores que impiden guardar o enviar el reporte. `equipo` son las fichas a cargo del jefe,
 * `minutosAprobadosPor` las horas extra aprobadas del mes por ficha y `nombrePor` sirve para
 * que el mensaje diga de quién se trata.
 * @param {{ exigirCuadre: boolean }} opciones al guardar un borrador no se exige que cuadre.
 */
function erroresDelReporte(filas, { equipo, minutosAprobadosPor, nombrePor }, { exigirCuadre }) {
    const errores = [];
    const quien = (id) => nombrePor[id] || `la ficha ${id}`;
    const vistos = new Set();

    for (const fila of filas) {
        const id = fila.users_company_id;
        if (!Number.isInteger(id) || !equipo.has(id)) {
            errores.push(`${quien(id)} no está a su cargo`);
            continue;
        }
        if (vistos.has(id)) {
            errores.push(`${quien(id)} está repetido en el reporte`);
            continue;
        }
        vistos.add(id);

        for (const c of CLASES) {
            const v = fila[c];
            if (!Number.isFinite(v) || v < 0 || v > HORAS_MAXIMAS_POR_CLASE) {
                errores.push(`${quien(id)}: las horas deben ser un número entre 0 y ${HORAS_MAXIMAS_POR_CLASE}`);
                break;
            }
        }
        if (fila.aclaraciones && fila.aclaraciones.length > 1000) {
            errores.push(`${quien(id)}: las aclaraciones admiten hasta 1000 caracteres`);
        }

        if (exigirCuadre) {
            const aprobadas = horasDeMinutos(minutosAprobadosPor[id] ?? 0);
            const reportadas = horasExtraDe(fila);
            if (Math.abs(aprobadas - reportadas) > TOLERANCIA_HORAS) {
                errores.push(`${quien(id)}: tiene ${aprobadas} h extra aprobadas en el mes y el reporte reparte ${reportadas} h entre extras diurnas, nocturnas y dominicales (115%)`);
            }
        }
    }

    if (exigirCuadre) {
        for (const [id, minutos] of Object.entries(minutosAprobadosPor)) {
            if (minutos > 0 && !vistos.has(Number(id))) {
                errores.push(`${quien(Number(id))} tiene ${horasDeMinutos(minutos)} h extra aprobadas en el mes y no está en el reporte`);
            }
        }
    }
    return errores;
}

/** ¿Se envió después de la fecha límite? `fechaEnvio` en hora de Colombia. */
function fueraDePlazo(fechaEnvio, fechaLimite) {
    return Boolean(fechaEnvio && fechaLimite && fechaEnvio > fechaLimite);
}

/**
 * ¿La campana le recuerda al jefe? Desde `diasAviso` días antes de la fecha límite (y después,
 * si se le pasó) mientras el reporte no esté enviado ni aprobado. `desdeAviso` = fecha límite
 * menos los días de aviso, ya calculada.
 */
function debeRecordar({ estado, hoy, desdeAviso }) {
    return !['enviado', 'aprobado'].includes(estado) && hoy >= desdeAviso;
}

module.exports = {
    CLASES,
    CLASES_EXTRA,
    esPeriodo,
    periodoDe,
    horasDeMinutos,
    totalHoras,
    horasExtraDe,
    puedeEditarse,
    puedeRevisarse,
    normalizarFilas,
    erroresDelReporte,
    fueraDePlazo,
    debeRecordar
};
