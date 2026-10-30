const { ReglaContratacionError } = require('../../errors/AppError');

// Exámenes médicos de SST (migración 089, conexionhydra.md §16). SST marca asistencia y
// resultado; Hydra decide si da continuidad a quien no asistió. Solo un candidato con el
// examen aprobado puede registrarse.

const ESTADOS_EXAMEN = ['pendiente', 'no_asistio', 'reagendado', 'asistio', 'aprobado', 'no_aprobado'];

const EVENTOS_SST = ['asistio', 'no_asistio', 'aprobado', 'no_aprobado'];
const EVENTOS_HYDRA = ['continuidad', 'no_continuidad'];

const NOMBRE_EVENTO = {
    asistio: 'Asistió a los exámenes médicos',
    no_asistio: 'No asistió a los exámenes médicos',
    aprobado: 'Aprobó los exámenes médicos',
    no_aprobado: 'No aprobó los exámenes médicos',
    continuidad: 'Selección da continuidad al proceso',
    no_continuidad: 'Selección no da continuidad al proceso'
};

// Desde dónde se puede marcar cada evento. La asistencia se puede volver a marcar después
// de un "no asistió" (se le reagendó la cita), haya decidido Hydra o no: la traza conserva
// todo lo anterior.
const ORIGENES = {
    asistio: ['pendiente', 'no_asistio', 'reagendado'],
    no_asistio: ['pendiente', 'no_asistio', 'reagendado'],
    aprobado: ['asistio'],
    no_aprobado: ['asistio'],
    continuidad: ['no_asistio'],
    no_continuidad: ['no_asistio']
};

// Estado del examen después del evento. "no_continuidad" no lo cambia: lo que cambia es el
// candidato, que sale del proceso (cancelado_hydra).
const DESTINO = {
    asistio: 'asistio',
    no_asistio: 'no_asistio',
    aprobado: 'aprobado',
    no_aprobado: 'no_aprobado',
    continuidad: 'reagendado',
    no_continuidad: 'no_asistio'
};

const ETIQUETA_ESTADO = {
    pendiente: 'pendiente de marcar asistencia',
    no_asistio: 'marcado como "no asistió"',
    reagendado: 'reagendado',
    asistio: 'con asistencia marcada y resultado pendiente',
    aprobado: 'aprobado',
    no_aprobado: 'no aprobado'
};

function normalizarNota(nota) {
    if (nota == null) return null;
    const texto = String(nota).trim();
    return texto === '' ? null : texto.slice(0, 1000);
}

/**
 * Valida un evento de examen y devuelve el estado de examen resultante y la nota limpia.
 * `estadoCandidato` es el del staging: solo un candidato en curso admite marcas.
 *
 * @returns {{ examenEstado: string, nota: string|null, candidatoSale: 'no_apto'|'cancelado_hydra'|null }}
 */
function aplicarEventoExamen({ estadoCandidato, examenEstado, evento, nota }) {
    if (!DESTINO[evento]) {
        throw new ReglaContratacionError(`Evento de examen desconocido: ${evento}`);
    }
    if (!['pendiente', 'listo'].includes(estadoCandidato)) {
        throw new ReglaContratacionError(`El candidato está "${estadoCandidato}" y ya no admite marcas de exámenes`);
    }
    const actual = examenEstado ?? 'pendiente';
    if (!ORIGENES[evento].includes(actual)) {
        throw new ReglaContratacionError(
            `No se puede marcar "${NOMBRE_EVENTO[evento].toLowerCase()}": el examen está ${ETIQUETA_ESTADO[actual] ?? actual}`
        );
    }
    const limpia = normalizarNota(nota);
    if (evento === 'no_aprobado' && !limpia) {
        throw new ReglaContratacionError('Indica por qué no aprobó los exámenes médicos');
    }
    return {
        examenEstado: DESTINO[evento],
        nota: limpia,
        candidatoSale: evento === 'no_aprobado' ? 'no_apto' : evento === 'no_continuidad' ? 'cancelado_hydra' : null
    };
}

module.exports = {
    ESTADOS_EXAMEN,
    EVENTOS_SST,
    EVENTOS_HYDRA,
    NOMBRE_EVENTO,
    aplicarEventoExamen
};
