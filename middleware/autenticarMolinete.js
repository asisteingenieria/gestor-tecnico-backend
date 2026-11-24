const config = require('../config/integracionMolinete');
const { AppError } = require('../errors/AppError');
const { igualesSeguro } = require('../utils/firmaHydra');

// Autenticación del intermediario del molinete (asistencia.md §80): clave en la cabecera x-api-key
// y, si están configuradas, lista blanca de IPs y exigencia de HTTPS. Igual que AsisLock: todos los
// rechazos responden 401 y el motivo real solo va al log del servidor.
//
// req.ip y req.secure respetan `trust proxy` (index.js): detrás de nginx salen de X-Forwarded-For y
// X-Forwarded-Proto; conectando directo al puerto, del socket.

function ipCliente(req) {
    return (req.ip ?? '').replace(/^::ffff:/, '');
}

function motivoRechazo(req, ip) {
    if (config.soloHttps && !req.secure) return 'sin https';
    const apiKey = req.get('x-api-key');
    if (!config.clavesAceptadas.some((clave) => igualesSeguro(clave, apiKey))) return 'api key';
    if (config.ipsPermitidas.length > 0 && !config.ipsPermitidas.includes(ip)) return 'ip no permitida';
    return null;
}

function autenticarMolinete(req, res, next) {
    if (!config.configurada) {
        return next(new AppError('La integración con el molinete no está configurada en este servidor', 503, 'INTEGRACION_NO_CONFIGURADA'));
    }

    const ip = ipCliente(req);
    const motivo = motivoRechazo(req, ip);
    if (motivo) {
        console.warn(`[molinete] petición rechazada (${motivo}) ${req.method} ${req.originalUrl} desde ${ip}`);
        return next(new AppError('Credenciales inválidas', 401, 'NO_AUTORIZADO'));
    }
    next();
}

module.exports = autenticarMolinete;
