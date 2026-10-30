// Política de reintentos del outbox hacia Hydra (conexionhydra.md §7.1). Pura: recibe la
// respuesta del intento y devuelve qué hacer con la fila.

// Respuestas 4xx que SÍ se reintentan: timeout, conflicto de concurrencia y límite.
const CODIGOS_4XX_REINTENTABLES = [408, 429];

/**
 * @param {object} intento
 * @param {number|null} intento.status   código HTTP; null si falló la red o hubo timeout
 * @param {string|null} [intento.codigo] `codigo` del cuerpo de error de Hydra, si vino
 * @param {number} intento.intentosPrevios intentos ya hechos antes de este
 * @param {{maxIntentos: number, backoffMaximoMinutos: number}} politica
 * @returns {{ estado: 'enviado'|'pendiente'|'fallido', intentos: number, esperaMinutos: number|null }}
 */
function decidirResultadoEnvio({ status, codigo = null, intentosPrevios }, politica) {
    const intentos = intentosPrevios + 1;

    // 2xx = aplicado. 409 = Hydra ya lo tenía aplicado (el aviso es idempotente del otro
    // lado), salvo que Hydra pida explícitamente reintentar por concurrencia.
    if (status !== null && status >= 200 && status < 300) return { estado: 'enviado', intentos, esperaMinutos: null };
    if (status === 409 && codigo !== 'PETICION_CONCURRENTE') return { estado: 'enviado', intentos, esperaMinutos: null };

    // Otro 4xx es un error permanente (payload, firma, credenciales): reintentar no lo
    // arregla. Queda 'fallido' para que alguien lo revise y use "Reintentar".
    const reintentable = status === null || status >= 500 || status === 409 || CODIGOS_4XX_REINTENTABLES.includes(status);
    if (!reintentable || intentos >= politica.maxIntentos) {
        return { estado: 'fallido', intentos, esperaMinutos: null };
    }

    const esperaMinutos = Math.min(2 ** (intentos - 1), politica.backoffMaximoMinutos);
    return { estado: 'pendiente', intentos, esperaMinutos };
}

// Ruta del endpoint de Hydra para cada tipo de aviso.
const RUTA_POR_TIPO = {
    candidato_registrado: '/contrataciones',
    candidato_descartado: '/descartes',
    candidato_examen: '/examenes'
};

module.exports = { decidirResultadoEnvio, RUTA_POR_TIPO };
