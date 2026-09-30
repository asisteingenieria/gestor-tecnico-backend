const express = require('express');
const router = express.Router();
const { verifyToken, canRegistrarAsistencia, isDirectorOperaciones } = require('../middleware/auth');
const validar = require('../middleware/validar');
const asyncHandler = require('../middleware/asyncHandler');

const marcajeController = require('../controllers/asistencia/marcajeController');
const consultaController = require('../controllers/asistencia/consultaController');
const horaExtraController = require('../controllers/asistencia/horaExtraController');
const horarioController = require('../controllers/asistencia/horarioController');
const equipoController = require('../controllers/asistencia/equipoController');

const {
    iniciarPausaSchema,
    trazabilidadParamsSchema,
    rangoQuerySchema,
    solicitarHoraExtraSchema,
    misHorasExtraQuerySchema,
    idParamSchema,
    empleadoIdParamSchema,
    trazabilidadEquipoParamsSchema,
    crearPlantillaSchema,
    actualizarPlantillaSchema,
    consultarHorariosQuerySchema,
    asignarHorarioSchema,
    actualizarAsignacionSchema,
    bandejaHorasExtraQuerySchema,
    aprobarHoraExtraSchema,
    rechazarHoraExtraSchema,
    asignarHoraExtraSchema,
    eventoManualSchema
} = require('../validators/asistenciaSchemas');

router.use(verifyToken);

// --- Empleado (y director sobre sí mismo) ---
router.get('/mi-horario', canRegistrarAsistencia, validar(rangoQuerySchema), asyncHandler(consultaController.miHorario));
router.get('/mi-jornada/hoy', canRegistrarAsistencia, asyncHandler(consultaController.estadoDeHoy));
router.post('/mi-jornada/entrada', canRegistrarAsistencia, asyncHandler(marcajeController.marcarEntrada));
router.post('/mi-jornada/pausa', canRegistrarAsistencia, validar(iniciarPausaSchema), asyncHandler(marcajeController.iniciarPausa));
router.post('/mi-jornada/pausa/fin', canRegistrarAsistencia, asyncHandler(marcajeController.finalizarPausa));
router.post('/mi-jornada/salida', canRegistrarAsistencia, asyncHandler(marcajeController.marcarSalida));
router.get('/mi-jornada/:fecha/trazabilidad', canRegistrarAsistencia, validar(trazabilidadParamsSchema), asyncHandler(consultaController.trazabilidad));
router.get('/mis-jornadas', canRegistrarAsistencia, validar(rangoQuerySchema), asyncHandler(consultaController.misJornadas));
router.get('/mis-estadisticas', canRegistrarAsistencia, validar(rangoQuerySchema), asyncHandler(consultaController.misEstadisticas));
router.post('/horas-extra/solicitar', canRegistrarAsistencia, validar(solicitarHoraExtraSchema), asyncHandler(horaExtraController.solicitar));
router.get('/mis-horas-extra', canRegistrarAsistencia, validar(misHorasExtraQuerySchema), asyncHandler(horaExtraController.misHorasExtra));

// --- Director de operaciones ---
router.get('/equipo', isDirectorOperaciones, asyncHandler(equipoController.equipo));
router.get('/equipo/:empleadoId/jornadas', isDirectorOperaciones, validar(empleadoIdParamSchema), asyncHandler(equipoController.jornadasDe));
router.get('/equipo/:empleadoId/jornada/:fecha/trazabilidad', isDirectorOperaciones, validar(trazabilidadEquipoParamsSchema), asyncHandler(equipoController.trazabilidadDe));
router.get('/equipo/estadisticas', isDirectorOperaciones, validar(rangoQuerySchema), asyncHandler(equipoController.estadisticasEquipo));
router.post('/equipo/jornada/:id/evento', isDirectorOperaciones, validar(eventoManualSchema), asyncHandler(equipoController.registrarEventoManual));

router.get('/horarios/plantillas', isDirectorOperaciones, asyncHandler(horarioController.listarPlantillas));
router.post('/horarios/plantillas', isDirectorOperaciones, validar(crearPlantillaSchema), asyncHandler(horarioController.crearPlantilla));
router.put('/horarios/plantillas/:id', isDirectorOperaciones, validar(actualizarPlantillaSchema), asyncHandler(horarioController.actualizarPlantilla));
router.delete('/horarios/plantillas/:id', isDirectorOperaciones, validar(idParamSchema), asyncHandler(horarioController.eliminarPlantilla));

router.get('/horarios', isDirectorOperaciones, validar(consultarHorariosQuerySchema), asyncHandler(horarioController.consultarHorarios));
router.post('/horarios', isDirectorOperaciones, validar(asignarHorarioSchema), asyncHandler(horarioController.asignarMasivo));
router.put('/horarios/:id', isDirectorOperaciones, validar(actualizarAsignacionSchema), asyncHandler(horarioController.actualizarAsignacion));
router.delete('/horarios/:id', isDirectorOperaciones, validar(idParamSchema), asyncHandler(horarioController.eliminarAsignacion));

router.get('/horas-extra', isDirectorOperaciones, validar(bandejaHorasExtraQuerySchema), asyncHandler(horaExtraController.bandeja));
router.put('/horas-extra/:id/aprobar', isDirectorOperaciones, validar(aprobarHoraExtraSchema), asyncHandler(horaExtraController.aprobar));
router.put('/horas-extra/:id/rechazar', isDirectorOperaciones, validar(rechazarHoraExtraSchema), asyncHandler(horaExtraController.rechazar));
router.post('/horas-extra/asignar', isDirectorOperaciones, validar(asignarHoraExtraSchema), asyncHandler(horaExtraController.asignar));

module.exports = router;
