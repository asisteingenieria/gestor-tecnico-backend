/**
 * Modalidad de la novedad de Vacaciones (migración 107, claude/modulo recursoshumanos.md §59).
 *   disfrutadas             → toma los días de descanso
 *   compensadas             → se pagan en dinero
 *   disfrutadas_compensadas → las dos (p. ej. 5 disfrutados y 5 compensados)
 * El total de días de la novedad es la suma de las dos partes. Lógica pura, sin E/S.
 */

const MODALIDADES = {
    disfrutadas: 'Disfrutadas',
    compensadas: 'Compensadas',
    disfrutadas_compensadas: 'Disfrutadas y compensadas'
};

const esVacaciones = (nombreTipo) => String(nombreTipo || '').trim().toLowerCase() === 'vacaciones';

function dias(valor) {
    if (valor === '' || valor === null || valor === undefined) return null;
    const n = Number(String(valor).replace(',', '.'));
    return Number.isInteger(n) && n >= 0 && n <= 999 ? n : NaN;
}

/**
 * Normaliza los campos de vacaciones de una novedad.
 * Devuelve `{ error }` o `{ campos }` con modalidad_vacaciones, dias_disfrutados, dias_compensados y,
 * para Vacaciones, total_dias = disfrutados + compensados. En otro tipo de novedad los tres van en NULL.
 */
function normalizar(body, tipoEsVacaciones) {
    if (!tipoEsVacaciones) {
        return { campos: { modalidad_vacaciones: null, dias_disfrutados: null, dias_compensados: null } };
    }
    const modalidad = body.modalidad_vacaciones;
    if (!MODALIDADES[modalidad]) {
        return { error: 'Elige si las vacaciones son disfrutadas, compensadas o disfrutadas y compensadas' };
    }
    const disfrutados = modalidad === 'compensadas' ? 0 : dias(body.dias_disfrutados);
    const compensados = modalidad === 'disfrutadas' ? 0 : dias(body.dias_compensados);
    if (Number.isNaN(disfrutados) || Number.isNaN(compensados)) {
        return { error: 'Los días disfrutados y compensados deben ser números enteros entre 0 y 999' };
    }
    if (modalidad !== 'compensadas' && !disfrutados) return { error: 'Indica cuántos días disfruta' };
    if (modalidad !== 'disfrutadas' && !compensados) return { error: 'Indica cuántos días se compensan en dinero' };
    return {
        campos: {
            modalidad_vacaciones: modalidad,
            dias_disfrutados: disfrutados,
            dias_compensados: compensados,
            total_dias: disfrutados + compensados
        }
    };
}

/** Días disfrutados y compensados de una novedad de Vacaciones ya guardada (las de antes de la 107 = disfrutadas). */
function partes(novedad) {
    if (!novedad.modalidad_vacaciones) return { disfrutados: Number(novedad.total_dias) || 0, compensados: 0 };
    return { disfrutados: Number(novedad.dias_disfrutados) || 0, compensados: Number(novedad.dias_compensados) || 0 };
}

module.exports = { MODALIDADES, esVacaciones, normalizar, partes };
