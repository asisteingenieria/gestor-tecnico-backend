const express = require('express');
const router = express.Router();
const config = require('../config/integracionAsislock');
const autenticarAsislock = require('../middleware/autenticarAsislock');
const validarCuerpo = require('../middleware/validarCuerpo');
const asyncHandler = require('../middleware/asyncHandler');
const { AppError, ValidacionError } = require('../errors/AppError');
const asislockController = require('../controllers/asistencia/asislockController');
const { validarEnvioAsislock } = require('../validators/asislockSchemas');

// API máquina-a-máquina para AsisLock (asistencia.md §18). Se autentica antes de parsear el
// cuerpo, con su propio límite de tamaño (un reenvío de 500 registros supera el límite por
// defecto de express.json()).

router.use(autenticarAsislock);
router.use(express.json({ limit: config.limiteCuerpo }));

router.get('/salud', asyncHandler(asislockController.salud));
router.post('/registros', validarCuerpo(validarEnvioAsislock), asyncHandler(asislockController.recibirRegistros));

router.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return next(new AppError(`El cuerpo supera el límite de ${config.limiteCuerpo}`, 413, 'ENVIO_DEMASIADO_GRANDE'));
    }
    if (err.type === 'entity.parse.failed') return next(new ValidacionError('El cuerpo no es JSON válido'));
    next(err);
});

module.exports = router;
