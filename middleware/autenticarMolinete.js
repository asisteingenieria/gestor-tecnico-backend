const config = require('../config/integracionMolinete');
const { AppError } = require('../errors/AppError');
const { igualesSeguro } = require('../utils/firmaHydra');

// Autenticación del intermediario del molinete (asistencia.md §80): clave en la cabecera x-api-key
// y, si está configurada, lista blanca de IPs. Igual que AsisLock: todos los rechazos responden
// 401 y el motivo real solo va al log del servidor.

function ipCliente(req) {
    return (req.ip ?? '').replace(/^::ffff:/, '');
}

module.exports = function autenticarMolinete(req, res, next) {
    if (!config.configurada) {
        return next(new AppError('La integración con el molinete no está configurada en este servidor', 503, 'INTEGRACION_NO_CONFIGURADA'));
    }

    const ip = ipCliente(req);
    const apiKey = req.get('x-api-key');
    const claveValida = config.clavesAceptadas.some((clave) => igualesSeguro(clave, apiKey));
    const ipValida = config.ipsPermitidas.length === 0 || config.ipsPermitidas.includes(ip);

    if (!claveValida || !ipValida) {
        console.warn(`[molinete] petición rechazada (${!claveValida ? 'api key' : 'ip no permitida'}) ${req.method} ${req.originalUrl} desde ${ip}`);
        return next(new AppError('Credenciales inválidas', 401, 'NO_AUTORIZADO'));
    }
    next();
};
