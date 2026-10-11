const express = require('express');
const router = express.Router();
const config = require('../config/integracionHydra');
const autenticarHydra = require('../middleware/autenticarHydra');
const validar = require('../middleware/validar');
const validarCuerpo = require('../middleware/validarCuerpo');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError, ValidacionError } = require('../errors/AppError');
const integracionController = require('../controllers/contratacionHydra/integracionController');
const {
    validarLoteHydra,
    validarCandidatoHydra,
    validarCancelacionHydra,
    hydraCandidatoIdParamSchema
} = require('../validators/integracionHydraSchemas');

// API máquina-a-máquina para Hydra (conexionhydra.md §5.1). Se monta en index.js ANTES
// de express.json(): la firma HMAC se verifica sobre los bytes exactos del cuerpo, así que
// aquí se lee crudo, se autentica y recién entonces se parsea el JSON. Un cuerpo sin
// firma válida nunca llega a parsearse.

router.use(express.raw({ type: 'application/json', limit: config.limiteCuerpo }));
router.use((req, res, next) => {
    req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    req.body = undefined;
    next();
});
router.use(autenticarHydra);
router.use((req, res, next) => {
    if (req.rawBody.length === 0) return next();
    try {
        req.body = JSON.parse(req.rawBody.toString('utf8'));
        next();
    } catch {
        next(new ValidacionError('El cuerpo no es JSON válido'));
    }
});

router.post('/lotes', validarCuerpo(validarLoteHydra), asyncHandler(integracionController.recibirLote));
router.put('/candidatos/:hydraCandidatoId', validar(hydraCandidatoIdParamSchema), validarCuerpo(validarCandidatoHydra), asyncHandler(integracionController.actualizarCandidato));
router.post('/candidatos/:hydraCandidatoId/cancelar', validar(hydraCandidatoIdParamSchema), validarCuerpo(validarCancelacionHydra), asyncHandler(integracionController.cancelarCandidato));
router.get('/candidatos/:hydraCandidatoId', validar(hydraCandidatoIdParamSchema), asyncHandler(integracionController.consultarCandidato));

// Errores del parser crudo → respuestas del contrato; el resto sigue a errorHandler.
router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return next(new AppError(`El cuerpo supera el límite de ${config.limiteCuerpo}`, 413, 'LOTE_DEMASIADO_GRANDE'));
    }
    next(err);
});

module.exports = router;
