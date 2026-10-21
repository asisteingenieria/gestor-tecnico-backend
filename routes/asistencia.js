const express = require('express');
const router = express.Router();
const { verifyToken, canRegistrarAsistencia, canDirigirEquipo, isFinanciera } = require('../middleware/auth');
const validar = require('../middleware/validar');
const asyncHandler = require('../middleware/asyncHandler');

const marcajeController = require('../controllers/asistencia/marcajeController');
const consultaController = require('../controllers/asistencia/consultaController');
const horaExtraController = require('../controllers/asistencia/horaExtraController');
const horarioController = require('../controllers/asistencia/horarioController');
const equipoController = require('../controllers/asistencia/equipoController');
const alertaController = require('../controllers/asistencia/alertaController');
const reporteHorasExtraController = require('../controllers/asistencia/reporteHorasExtraController');
const financieraController = require('../controllers/asistencia/financieraController');

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
    eventoManualSchema,
    periodoQuerySchema,
    guardarReporteHorasExtraSchema,
    devolverReporteSchema,
    fechaLimiteSchema,
    empleadosFinancieraQuerySchema,
    jornadasEmpleadoSchema
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
// Campana: alertas de traspasos dirigidas a mi ficha (evaluación del encargo, retorno del trabajo en casa)
router.get('/mis-alertas', canRegistrarAsistencia, asyncHandler(alertaController.misAlertas));
router.post('/mis-alertas/:id/leida', canRegistrarAsistencia, validar(idParamSchema), asyncHandler(alertaController.marcarLeida));

// --- Jefe de equipo (director_operaciones o ficha con empleados a cargo, §23) ---
router.get('/equipo', canDirigirEquipo, asyncHandler(equipoController.equipo));
router.get('/equipo/:empleadoId/jornadas', canDirigirEquipo, validar(empleadoIdParamSchema), asyncHandler(equipoController.jornadasDe));
router.get('/equipo/:empleadoId/jornada/:fecha/trazabilidad', canDirigirEquipo, validar(trazabilidadEquipoParamsSchema), asyncHandler(equipoController.trazabilidadDe));
router.get('/equipo/estadisticas', canDirigirEquipo, validar(rangoQuerySchema), asyncHandler(equipoController.estadisticasEquipo));
router.post('/equipo/jornada/:id/evento', canDirigirEquipo, validar(eventoManualSchema), asyncHandler(equipoController.registrarEventoManual));

router.get('/horarios/plantillas', canDirigirEquipo, asyncHandler(horarioController.listarPlantillas));
router.post('/horarios/plantillas', canDirigirEquipo, validar(crearPlantillaSchema), asyncHandler(horarioController.crearPlantilla));
router.put('/horarios/plantillas/:id', canDirigirEquipo, validar(actualizarPlantillaSchema), asyncHandler(horarioController.actualizarPlantilla));
router.delete('/horarios/plantillas/:id', canDirigirEquipo, validar(idParamSchema), asyncHandler(horarioController.eliminarPlantilla));

router.get('/horarios', canDirigirEquipo, validar(consultarHorariosQuerySchema), asyncHandler(horarioController.consultarHorarios));
router.post('/horarios', canDirigirEquipo, validar(asignarHorarioSchema), asyncHandler(horarioController.asignarMasivo));
router.put('/horarios/:id', canDirigirEquipo, validar(actualizarAsignacionSchema), asyncHandler(horarioController.actualizarAsignacion));
router.delete('/horarios/:id', canDirigirEquipo, validar(idParamSchema), asyncHandler(horarioController.eliminarAsignacion));

router.get('/horas-extra', canDirigirEquipo, validar(bandejaHorasExtraQuerySchema), asyncHandler(horaExtraController.bandeja));
router.put('/horas-extra/:id/aprobar', canDirigirEquipo, validar(aprobarHoraExtraSchema), asyncHandler(horaExtraController.aprobar));
router.put('/horas-extra/:id/rechazar', canDirigirEquipo, validar(rechazarHoraExtraSchema), asyncHandler(horaExtraController.rechazar));
router.post('/horas-extra/asignar', canDirigirEquipo, validar(asignarHoraExtraSchema), asyncHandler(horaExtraController.asignar));

// Reporte mensual de horas extras a financiera (§32)
router.get('/reporte-horas-extra', canDirigirEquipo, validar(periodoQuerySchema), asyncHandler(reporteHorasExtraController.miReporte));
router.put('/reporte-horas-extra', canDirigirEquipo, validar(guardarReporteHorasExtraSchema), asyncHandler(reporteHorasExtraController.guardarBorrador));
router.post('/reporte-horas-extra/enviar', canDirigirEquipo, validar(guardarReporteHorasExtraSchema), asyncHandler(reporteHorasExtraController.enviar));

// --- Financiera (§32): reportes de horas extras y trazabilidad de todos por campaña ---
router.get('/financiera/reportes-horas-extra', isFinanciera, validar(periodoQuerySchema), asyncHandler(reporteHorasExtraController.resumenDelPeriodo));
router.get('/financiera/reportes-horas-extra/:id', isFinanciera, validar(idParamSchema), asyncHandler(reporteHorasExtraController.detalle));
router.put('/financiera/reportes-horas-extra/:id/aprobar', isFinanciera, validar(idParamSchema), asyncHandler(reporteHorasExtraController.aprobar));
router.put('/financiera/reportes-horas-extra/:id/devolver', isFinanciera, validar(devolverReporteSchema), asyncHandler(reporteHorasExtraController.devolver));
router.put('/financiera/periodos/:periodo', isFinanciera, validar(fechaLimiteSchema), asyncHandler(reporteHorasExtraController.fijarFechaLimite));
router.get('/financiera/campanias', isFinanciera, asyncHandler(financieraController.campanias));
router.get('/financiera/empleados', isFinanciera, validar(empleadosFinancieraQuerySchema), asyncHandler(financieraController.empleados));
router.get('/financiera/empleados/:empleadoId/jornadas', isFinanciera, validar(jornadasEmpleadoSchema), asyncHandler(financieraController.jornadasDe));
router.get('/financiera/empleados/:empleadoId/jornada/:fecha/trazabilidad', isFinanciera, validar(trazabilidadEquipoParamsSchema), asyncHandler(financieraController.trazabilidadDe));

module.exports = router;
