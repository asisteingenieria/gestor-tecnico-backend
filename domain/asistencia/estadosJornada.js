const ESTADOS = ['pendiente', 'en_curso', 'en_pausa', 'finalizada', 'ausente'];

// Transiciones que puede producir el cálculo en vivo (calcularJornada). 'ausente' no
// aparece como destino: lo asigna el cierre del día (§10), nunca el cálculo en caliente.
const TRANSICIONES = {
    pendiente: ['en_curso'],
    en_curso: ['en_pausa', 'finalizada'],
    en_pausa: ['en_curso', 'finalizada'],
    finalizada: [],
    ausente: []
};

function transicionValida(desde, hasta) {
    return Array.isArray(TRANSICIONES[desde]) && TRANSICIONES[desde].includes(hasta);
}

module.exports = { ESTADOS, TRANSICIONES, transicionValida };
