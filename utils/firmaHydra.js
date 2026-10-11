const { createHmac, timingSafeEqual } = require('node:crypto');

// Firma de las peticiones entre Hydra y Gestor (conexionhydra.md §5.3):
//   X-Signature: sha256=<hex(HMAC_SHA256(secreto, `${timestamp}.${cuerpoCrudo}`))>
// El mismo algoritmo sirve en los dos sentidos; lo que cambia es el secreto.
// El timestamp va dentro de lo firmado: sin él, una petición capturada se podría
// reenviar con otro X-Timestamp y pasar la ventana anti-replay.

const PREFIJO = 'sha256=';

function firmar(secreto, timestamp, cuerpo = '') {
    const hmac = createHmac('sha256', secreto);
    hmac.update(`${timestamp}.`);
    hmac.update(Buffer.isBuffer(cuerpo) ? cuerpo : String(cuerpo));
    return PREFIJO + hmac.digest('hex');
}

// Comparación en tiempo constante: `===` filtra por tiempos cuántos caracteres coinciden.
function igualesSeguro(a, b) {
    const bufA = Buffer.from(String(a ?? ''));
    const bufB = Buffer.from(String(b ?? ''));
    if (bufA.length !== bufB.length) {
        timingSafeEqual(bufA, bufA);
        return false;
    }
    return timingSafeEqual(bufA, bufB);
}

function firmaValida(secreto, timestamp, cuerpo, firmaRecibida) {
    return igualesSeguro(firmar(secreto, timestamp, cuerpo), firmaRecibida);
}

// `ahoraSegundos` se recibe para poder probarlo sin depender del reloj.
function timestampVigente(timestamp, ahoraSegundos, toleranciaSegundos) {
    if (!/^\d{1,12}$/.test(String(timestamp ?? ''))) return false;
    return Math.abs(ahoraSegundos - Number(timestamp)) <= toleranciaSegundos;
}

module.exports = { firmar, firmaValida, igualesSeguro, timestampVigente };
