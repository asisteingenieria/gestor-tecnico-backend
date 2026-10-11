const express = require('express');
const router = express.Router();
const { verifyToken, isRecursosHumanos } = require('../middleware/auth');
const validar = require('../middleware/validar');
const validarCuerpo = require('../middleware/validarCuerpo');
const asyncHandler = require('../middleware/asyncHandler');
const rrhhController = require('../controllers/contratacionHydra/rrhhController');
const {
    idParamSchema,
    listarLotesQuerySchema,
    seccionParamsSchema,
    verificacionSchema,
    descartarSchema,
    guardarMapeoSchema,
    registrarLoteSchema,
    listarEnviosQuerySchema,
    validarCuerpoSeccion
} = require('../validators/contratacionHydraSchemas');

// Contratación desde Hydra — lado de RRHH (conexionhydra.md §8). Exclusivo de
// recursosHumanos (y admin).

router.use(verifyToken, isRecursosHumanos);

router.get('/lotes', validar(listarLotesQuerySchema), asyncHandler(rrhhController.listarLotes));
router.get('/lotes/:id', validar(idParamSchema), asyncHandler(rrhhController.obtenerLote));
// ?simular=true: hace todo y revierte (ROLLBACK), para ver errores antes de confirmar.
router.post('/lotes/:id/registrar', validar(registrarLoteSchema), asyncHandler(rrhhController.registrarLote));

router.get('/candidatos/:id', validar(idParamSchema), asyncHandler(rrhhController.obtenerCandidato));
router.put('/candidatos/:id/secciones/:seccion', validar(seccionParamsSchema), validarCuerpo(validarCuerpoSeccion), asyncHandler(rrhhController.guardarSeccion));
router.put('/candidatos/:id/secciones/:seccion/verificacion', validar(verificacionSchema), asyncHandler(rrhhController.marcarVerificacion));
router.post('/candidatos/:id/descartar', validar(descartarSchema), asyncHandler(rrhhController.descartarCandidato));

router.get('/catalogos', asyncHandler(rrhhController.opcionesCatalogos));
router.get('/mapeos', asyncHandler(rrhhController.listarMapeos));
router.post('/mapeos', validar(guardarMapeoSchema), asyncHandler(rrhhController.guardarMapeo));

// Monitoreo del outbox hacia Hydra
router.get('/envios', validar(listarEnviosQuerySchema), asyncHandler(rrhhController.listarEnvios));
router.post('/envios/:id/reintentar', validar(idParamSchema), asyncHandler(rrhhController.reintentarEnvio));

module.exports = router;
