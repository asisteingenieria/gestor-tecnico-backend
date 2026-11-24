const express = require('express');
const router = express.Router();
const config = require('../config/integracionMolinete');
const autenticarMolinete = require('../middleware/autenticarMolinete');
const validarCuerpo = require('../middleware/validarCuerpo');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError, ValidacionError } = require('../errors/AppError');
const molineteController = require('../controllers/asistencia/molineteController');
const { validarEnvioMolinete } = require('../validators/molineteSchemas');

// API máquina-a-máquina del intermediario del molinete (asistencia.md §80). Como la de AsisLock,
// autentica antes de parsear el cuerpo y con su propio límite de tamaño.

router.use(autenticarMolinete);
router.use(express.json({ limit: config.limiteCuerpo }));

router.get('/salud', asyncHandler(molineteController.salud));
router.get('/estado', asyncHandler(molineteController.estadoLectura));
router.post('/marcaciones', validarCuerpo(validarEnvioMolinete), asyncHandler(molineteController.recibirMarcaciones));

router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return next(new AppError(`El cuerpo supera el límite de ${config.limiteCuerpo}`, 413, 'ENVIO_DEMASIADO_GRANDE'));
    }
    if (err.type === 'entity.parse.failed') return next(new ValidacionError('El cuerpo no es JSON válido'));
    next(err);
});

module.exports = router;
