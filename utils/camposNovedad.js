/**
 * Qué campos aplican a cada tipo de novedad (claude/modulo recursoshumanos.md §59.1). Misma regla que
 * src/utils/camposNovedad.js del frontend: si cambia una, hay que cambiar la otra.
 *   - Origen de la incapacidad y diagnóstico: solo en incapacidades.
 *   - Accidente de tránsito: lo dice el tipo ("Incapacidades accidente de transito ..."), no se marca a mano.
 *   - Vacaciones compensadas: se pagan en dinero, no hay descanso → sin fecha final ni de retorno.
 * Lógica pura, sin E/S.
 */

const esIncapacidad = (tipo) => /incapacidad/i.test(String(tipo || ''));
const esAccidenteTransito = (tipo) => /transito|tránsito/i.test(String(tipo || ''));

/** Devuelve los datos de la novedad sin los campos que no aplican a su tipo. */
function limpiarPorTipo(datos, nombreTipo) {
    const limpio = { ...datos, accidente_transito: esAccidenteTransito(nombreTipo) };
    if (!esIncapacidad(nombreTipo)) {
        limpio.origen_incapacidad = null;
        limpio.resumen_diagnostico = null;
    }
    if (datos.modalidad_vacaciones === 'compensadas') {
        limpio.fecha_final = null;
        limpio.fecha_retorno = null;
    }
    return limpio;
}

module.exports = { esIncapacidad, esAccidenteTransito, limpiarPorTipo };
