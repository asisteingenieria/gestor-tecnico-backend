const config = require('../config/integracionHydra');
const { AppError } = require('../errors/AppError');
const { firmaValida, igualesSeguro, timestampVigente } = require('../utils/firmaHydra');

// Autenticación máquina-a-máquina de Hydra (conexionhydra.md §5.3). Requiere que
// `req.rawBody` (Buffer) ya esté poblado por el parser crudo del router: la firma se
// calcula sobre los bytes exactos, no sobre el JSON re-serializado.
//
// Todos los rechazos responden igual (401 FIRMA_INVALIDA) para no darle pistas a quien
// esté probando claves; el motivo real solo va al log del servidor.

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;
const METODOS_CON_IDEMPOTENCIA = ['POST', 'PUT', 'DELETE'];

function rechazar(motivo, req) {
    console.warn(`[integracion-hydra] petición rechazada (${motivo}) ${req.method} ${req.originalUrl} desde ${req.ip}`);
    return new AppError('Credenciales o firma inválidas', 401, 'FIRMA_INVALIDA');
}

module.exports = function autenticarHydra(req, res, next) {
    if (!config.configurada) {
        return next(new AppError('La integración con Hydra no está configurada en este servidor', 503, 'INTEGRACION_NO_CONFIGURADA'));
    }

    const apiKey = req.get('x-api-key');
    const timestamp = req.get('x-timestamp');
    const firma = req.get('x-signature');

    const credencial = config.credencialesEntrantes.find((c) => igualesSeguro(c.apiKey, apiKey));
    if (!credencial) return next(rechazar('api key', req));

    if (!timestampVigente(timestamp, Math.floor(Date.now() / 1000), config.toleranciaTimestampSegundos)) {
        return next(rechazar('timestamp fuera de ventana', req));
    }

    if (!firmaValida(credencial.secreto, timestamp, req.rawBody ?? Buffer.alloc(0), firma)) {
        return next(rechazar('firma', req));
    }

    if (METODOS_CON_IDEMPOTENCIA.includes(req.method)) {
        const clave = req.get('idempotency-key');
        if (!IDEMPOTENCY_KEY.test(clave ?? '')) {
            return next(new AppError('Falta la cabecera Idempotency-Key o no es válida', 400, 'IDEMPOTENCY_KEY_REQUERIDA'));
        }
        req.idempotencyKey = clave;
    }

    next();
};
