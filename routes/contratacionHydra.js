const express = require('express');
const router = express.Router();
const { verifyToken, isRecursosHumanos, isRecursosHumanosOSst, isSst } = require('../middleware/auth');
const validar = require('../middleware/validar');
const validarCuerpo = require('../middleware/validarCuerpo');
const asyncHandler = require('../middleware/asyncHandler');
const rrhhController = require('../controllers/contratacionHydra/rrhhController');
const {
    idParamSchema,
    documentoCandidatoParamsSchema,
    documentosEmpleadoParamsSchema,
    documentoEmpleadoParamsSchema,
    listarLotesQuerySchema,
    seccionParamsSchema,
    verificacionSchema,
    descartarSchema,
    examenSchema,
    guardarMapeoSchema,
    registrarLoteSchema,
    listarEnviosQuerySchema,
    validarCuerpoSeccion
} = require('../validators/contratacionHydraSchemas');

// Contratación desde Hydra (conexionhydra.md §8). RRHH (recursosHumanos, financiera
// —asistencia.md §32— y admin) completa, verifica y registra. SST (migración 089, §16)
// recibe los mismos candidatos y marca los exámenes médicos: ve los lotes, el detalle y
// los documentos, pero no edita datos ni registra.

router.use(verifyToken);

// Consulta: RRHH y SST
router.get('/lotes', isRecursosHumanosOSst, validar(listarLotesQuerySchema), asyncHandler(rrhhController.listarLotes));
router.get('/lotes/:id', isRecursosHumanosOSst, validar(idParamSchema), asyncHandler(rrhhController.obtenerLote));
router.get('/candidatos/:id', isRecursosHumanosOSst, validar(idParamSchema), asyncHandler(rrhhController.obtenerCandidato));
router.get('/catalogos', isRecursosHumanosOSst, asyncHandler(rrhhController.opcionesCatalogos));

// Documentos que envía Hydra (migración 087, §15): firmados y antecedentes. La lista del
// candidato viaja en GET /candidatos/:id; la ficha del empleado los pide aparte.
router.get('/candidatos/:id/documentos/:documentoId/archivo', isRecursosHumanosOSst, validar(documentoCandidatoParamsSchema), asyncHandler(rrhhController.archivoDocumentoCandidato));
router.get('/empleados/:usersCompanyId/documentos', isRecursosHumanos, validar(documentosEmpleadoParamsSchema), asyncHandler(rrhhController.documentosEmpleado));
router.get('/empleados/:usersCompanyId/documentos/:documentoId/archivo', isRecursosHumanos, validar(documentoEmpleadoParamsSchema), asyncHandler(rrhhController.archivoDocumentoEmpleado));

// Exámenes médicos: solo SST (y financiera/admin como administradores)
router.post('/candidatos/:id/examenes', isSst, validar(examenSchema), asyncHandler(rrhhController.marcarExamen));

// Datos y registro: solo RRHH
// ?simular=true: hace todo y revierte (ROLLBACK), para ver errores antes de confirmar.
router.post('/lotes/:id/registrar', isRecursosHumanos, validar(registrarLoteSchema), asyncHandler(rrhhController.registrarLote));
router.put('/candidatos/:id/secciones/:seccion', isRecursosHumanos, validar(seccionParamsSchema), validarCuerpo(validarCuerpoSeccion), asyncHandler(rrhhController.guardarSeccion));
router.put('/candidatos/:id/secciones/:seccion/verificacion', isRecursosHumanos, validar(verificacionSchema), asyncHandler(rrhhController.marcarVerificacion));
router.post('/candidatos/:id/descartar', isRecursosHumanos, validar(descartarSchema), asyncHandler(rrhhController.descartarCandidato));

router.get('/mapeos', isRecursosHumanos, asyncHandler(rrhhController.listarMapeos));
router.post('/mapeos', isRecursosHumanos, validar(guardarMapeoSchema), asyncHandler(rrhhController.guardarMapeo));

// Monitoreo del outbox hacia Hydra
router.get('/envios', isRecursosHumanos, validar(listarEnviosQuerySchema), asyncHandler(rrhhController.listarEnvios));
router.post('/envios/:id/reintentar', isRecursosHumanos, validar(idParamSchema), asyncHandler(rrhhController.reintentarEnvio));

module.exports = router;
