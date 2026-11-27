/**
 * Límites legales de horas extra (asistencia.md §91.1), para la solicitud en Excel. Puro: sin E/S.
 *
 *   - Horas extra (diurnas, nocturnas y dominicales/festivas; no los recargos dentro del turno): como máximo
 *     `max_horas_extra_diarias` (2) por día y `max_horas_extra_semanales` (12) por semana de lunes a domingo
 *     (CST art. 22, Ley 50 de 1990). Con 42 h ordinarias, 54 h a la semana. Cuentan también las ya pendientes o
 *     aprobadas de esa semana. Si se pasa, es error de esas filas.
 *   - Domingos: trabajar 3 o más domingos en el mes calendario es trabajo dominical habitual (CST art. 180): da
 *     derecho a un descanso compensatorio remunerado. No es un límite: es un aviso para el jefe.
 */

const { CLASES_EXTRA } = require('./reporteHorasExtra');
const { lunesDe, textoHoras } = require('./semanaMalla');

const DOMINGOS_HABITUAL = 3;

/** Minutos de hora extra propiamente dicha (sin recargos) de unos tramos. */
const minutosExtra = (tramos = []) => tramos.filter((t) => CLASES_EXTRA.includes(t.clase)).reduce((acc, t) => acc + (Number(t.minutos) || 0), 0);

const claveFecha = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));
const esDomingo = (fecha) => new Date(`${fecha}T12:00:00Z`).getUTCDay() === 0;
const ddmm = (f) => f.split('-').reverse().slice(0, 2).join('/');

/**
 * @param {Object} p
 * @param {Array}  p.solicitudes  las del Excel: { fila, users_company_id, nombre, cedula, fecha, tramos }
 * @param {Array}  p.existentes   horas extra pendientes o aprobadas de esas personas en esas semanas y meses:
 *                                { users_company_id, fecha, tramos }
 * @param {Array}  p.horarios     horario_asignado de esas personas en esos meses (para los domingos con turno)
 * @param {number} p.maxDiariosMin    minutos de hora extra por día
 * @param {number} p.maxSemanalesMin  minutos de hora extra por semana
 * @returns {{ errores: Array<{fila, cedula, nombre, fecha, motivo}>, avisos: Array }}
 */
function validarLimites({ solicitudes, existentes = [], horarios = [], maxDiariosMin, maxSemanalesMin }) {
    const errores = [];
    const error = (s, motivo) => errores.push({ fila: s.fila, cedula: s.cedula, nombre: s.nombre, fecha: s.fecha, motivo });

    // Por día: la del Excel es la única de ese día (una segunda ya es error antes).
    for (const s of solicitudes) {
        const extra = minutosExtra(s.tramos);
        if (extra > maxDiariosMin) error(s, `${textoHoras(extra)} de hora extra en el día: el máximo legal es ${textoHoras(maxDiariosMin)} diarias`);
    }

    // Por semana: lo del Excel más lo ya pedido.
    const semanas = new Map();
    const sumar = (uc, fecha, minutos, s) => {
        const clave = `${uc}|${lunesDe(fecha)}`;
        const sem = semanas.get(clave) ?? { minutos: 0, delExcel: [], lunes: lunesDe(fecha) };
        sem.minutos += minutos;
        if (s) sem.delExcel.push(s);
        semanas.set(clave, sem);
    };
    for (const e of existentes) sumar(e.users_company_id, claveFecha(e.fecha), minutosExtra(e.tramos));
    for (const s of solicitudes) sumar(s.users_company_id, s.fecha, minutosExtra(s.tramos), s);
    for (const sem of semanas.values()) {
        if (sem.delExcel.length === 0 || sem.minutos <= maxSemanalesMin) continue;
        for (const s of sem.delExcel) {
            error(s, `La semana del ${ddmm(sem.lunes)} suma ${textoHoras(sem.minutos)} de hora extra con las ya pedidas: el máximo legal es ${textoHoras(maxSemanalesMin)} semanales (54 h con las 42 ordinarias)`);
        }
    }

    // Domingos trabajados en el mes: con turno (no descanso) o con hora extra.
    const domingos = new Map();
    const marcar = (uc, fecha) => {
        if (!esDomingo(fecha)) return;
        const clave = `${uc}|${fecha.slice(0, 7)}`;
        if (!domingos.has(clave)) domingos.set(clave, new Set());
        domingos.get(clave).add(fecha);
    };
    for (const h of horarios) if (!h.es_descanso) marcar(h.users_company_id, claveFecha(h.fecha));
    for (const e of existentes) marcar(e.users_company_id, claveFecha(e.fecha));
    for (const s of solicitudes) marcar(s.users_company_id, s.fecha);
    const avisos = [];
    const personaDe = new Map(solicitudes.map((s) => [s.users_company_id, s]));
    for (const [clave, fechas] of domingos) {
        const [uc, mes] = clave.split('|');
        const s = personaDe.get(Number(uc));
        // Solo de quienes piden un domingo en este Excel.
        if (fechas.size < DOMINGOS_HABITUAL || !s || !solicitudes.some((x) => x.users_company_id === Number(uc) && esDomingo(x.fecha) && x.fecha.startsWith(mes))) continue;
        avisos.push({
            users_company_id: Number(uc), cedula: s.cedula, nombre: s.nombre, mes, domingos: fechas.size,
            motivo: `Trabaja ${fechas.size} domingos en ${mes.split('-').reverse().join('/')}: es trabajo dominical habitual y le corresponde un descanso compensatorio remunerado`
        });
    }
    return { errores, avisos };
}

module.exports = { validarLimites, minutosExtra, DOMINGOS_HABITUAL };
