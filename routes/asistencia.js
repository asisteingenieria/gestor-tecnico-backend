const express = require('express');
const router = express.Router();
const { verifyToken, canRegistrarAsistencia, canDirigirEquipo, canSolicitarCambioTurno, isFinanciera } = require('../middleware/auth');
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
const cambioTurnoController = require('../controllers/asistencia/cambioTurnoController');

const {
    iniciarPausaSchema,
    trazabilidadParamsSchema,
    rangoQuerySchema,
    solicitarHoraExtraSchema,
    previsualizarHoraExtraSchema,
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
    eventoManualSchema,
    periodoQuerySchema,
    reporteFinancieraQuerySchema,
    empleadosFinancieraQuerySchema,
    jornadasEmpleadoSchema,
    solicitarCambioTurnoSchema,
    estadoCambioTurnoQuerySchema,
    financieraCambiosTurnoQuerySchema,
    plantillasCambioTurnoQuerySchema,
    horariosCambioTurnoQuerySchema,
    aprobarCambioTurnoSchema,
    rechazarCambioTurnoSchema
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
// El empleado solo consulta sus horas extra: desde §51 las solicita su jefe.
router.get('/mis-horas-extra', canRegistrarAsistencia, validar(misHorasExtraQuerySchema), asyncHandler(horaExtraController.misHorasExtra));
// Campana: alertas de traspasos dirigidas a mi ficha (evaluación del encargo, retorno del trabajo en casa)
router.get('/mis-alertas', canRegistrarAsistencia, asyncHandler(alertaController.misAlertas));
router.post('/mis-alertas/:id/leida', canRegistrarAsistencia, validar(idParamSchema), asyncHandler(alertaController.marcarLeida));
// Campana: notificaciones de asistencia (084: cambios de turno) a mi ficha o a mi usuario (financiera)
router.get('/mis-notificaciones', canRegistrarAsistencia, asyncHandler(alertaController.misNotificaciones));
router.post('/mis-notificaciones/leidas', canRegistrarAsistencia, asyncHandler(alertaController.marcarTodasLeidas));
router.post('/mis-notificaciones/:id/leida', canRegistrarAsistencia, validar(idParamSchema), asyncHandler(alertaController.marcarNotificacionLeida));

// --- Cambios de turno (§50): el coordinador pide, el jefe que gestiona al empleado aprueba o rechaza ---
router.get('/cambios-turno/permisos', canRegistrarAsistencia, asyncHandler(cambioTurnoController.permisos));
router.get('/cambios-turno/empleados', canSolicitarCambioTurno, asyncHandler(cambioTurnoController.empleados));
router.get('/cambios-turno/plantillas', canSolicitarCambioTurno, validar(plantillasCambioTurnoQuerySchema), asyncHandler(cambioTurnoController.plantillas));
router.get('/cambios-turno/horarios', canSolicitarCambioTurno, validar(horariosCambioTurnoQuerySchema), asyncHandler(cambioTurnoController.horarios));
router.get('/cambios-turno/mias', canSolicitarCambioTurno, asyncHandler(cambioTurnoController.misSolicitudes));
router.post('/cambios-turno', canSolicitarCambioTurno, validar(solicitarCambioTurnoSchema), asyncHandler(cambioTurnoController.solicitar));
router.get('/cambios-turno/bandeja', canDirigirEquipo, validar(estadoCambioTurnoQuerySchema), asyncHandler(cambioTurnoController.bandeja));
router.put('/cambios-turno/:id/aprobar', canDirigirEquipo, validar(aprobarCambioTurnoSchema), asyncHandler(cambioTurnoController.aprobar));
router.put('/cambios-turno/:id/rechazar', canDirigirEquipo, validar(rechazarCambioTurnoSchema), asyncHandler(cambioTurnoController.rechazar));

// --- Jefe de equipo (director_operaciones o ficha con empleados a cargo, §23) ---
router.get('/equipo', canDirigirEquipo, asyncHandler(equipoController.equipo));
router.get('/equipo/:empleadoId/jornadas', canDirigirEquipo, validar(empleadoIdParamSchema), asyncHandler(equipoController.jornadasDe));
router.get('/equipo/:empleadoId/jornada/:fecha/trazabilidad', canDirigirEquipo, validar(trazabilidadEquipoParamsSchema), asyncHandler(equipoController.trazabilidadDe));
router.get('/equipo/estadisticas', canDirigirEquipo, validar(rangoQuerySchema), asyncHandler(equipoController.estadisticasEquipo));
router.get('/equipo/resumen-mensual', canDirigirEquipo, validar(periodoQuerySchema), asyncHandler(equipoController.resumenMensual));
router.post('/equipo/jornada/:id/evento', canDirigirEquipo, validar(eventoManualSchema), asyncHandler(equipoController.registrarEventoManual));

router.get('/horarios/plantillas', canDirigirEquipo, asyncHandler(horarioController.listarPlantillas));
router.post('/horarios/plantillas', canDirigirEquipo, validar(crearPlantillaSchema), asyncHandler(horarioController.crearPlantilla));
router.put('/horarios/plantillas/:id', canDirigirEquipo, validar(actualizarPlantillaSchema), asyncHandler(horarioController.actualizarPlantilla));
router.delete('/horarios/plantillas/:id', canDirigirEquipo, validar(idParamSchema), asyncHandler(horarioController.eliminarPlantilla));

router.get('/horarios', canDirigirEquipo, validar(consultarHorariosQuerySchema), asyncHandler(horarioController.consultarHorarios));
router.post('/horarios', canDirigirEquipo, validar(asignarHorarioSchema), asyncHandler(horarioController.asignarMasivo));
router.put('/horarios/:id', canDirigirEquipo, validar(actualizarAsignacionSchema), asyncHandler(horarioController.actualizarAsignacion));
router.delete('/horarios/:id', canDirigirEquipo, validar(idParamSchema), asyncHandler(horarioController.eliminarAsignacion));

// Horas extra (§51): el jefe las solicita por su equipo y las aprueba su director (bandeja = las que
// le toca aprobar; también las del flujo anterior de su propia gente).
router.post('/horas-extra/solicitar', canDirigirEquipo, validar(solicitarHoraExtraSchema), asyncHandler(horaExtraController.solicitar));
router.post('/horas-extra/previsualizar', canDirigirEquipo, validar(previsualizarHoraExtraSchema), asyncHandler(horaExtraController.previsualizar));
router.get('/horas-extra/mias', canDirigirEquipo, validar(misHorasExtraQuerySchema), asyncHandler(horaExtraController.misSolicitudes));
router.get('/horas-extra', canDirigirEquipo, validar(bandejaHorasExtraQuerySchema), asyncHandler(horaExtraController.bandeja));
router.put('/horas-extra/:id/aprobar', canDirigirEquipo, validar(aprobarHoraExtraSchema), asyncHandler(horaExtraController.aprobar));
router.put('/horas-extra/:id/rechazar', canDirigirEquipo, validar(rechazarHoraExtraSchema), asyncHandler(horaExtraController.rechazar));

// Reporte mensual de horas extras (§32). Se llena solo con las horas aprobadas: solo lectura.
router.get('/reporte-horas-extra', canDirigirEquipo, validar(periodoQuerySchema), asyncHandler(reporteHorasExtraController.miReporte));

// --- Financiera (§32): reportes de horas extras y trazabilidad de todos por campaña ---
router.get('/financiera/reporte-horas-extra', isFinanciera, validar(reporteFinancieraQuerySchema), asyncHandler(financieraController.reporte));
router.get('/financiera/resumen-mensual', isFinanciera, validar(reporteFinancieraQuerySchema), asyncHandler(financieraController.resumenMensual));
// Home de financiera/admin (§37): RRHH, asistencia, horas extra y costos del mes en una respuesta.
router.get('/financiera/home', isFinanciera, validar(reporteFinancieraQuerySchema), asyncHandler(financieraController.home));
router.get('/financiera/campanias', isFinanciera, asyncHandler(financieraController.campanias));
// Asistencia en vivo de todos o de una campaña (§47); el histórico es el resumen mensual y la trazabilidad.
router.get('/financiera/en-vivo', isFinanciera, validar(empleadosFinancieraQuerySchema), asyncHandler(financieraController.enVivo));
router.get('/financiera/empleados', isFinanciera, validar(empleadosFinancieraQuerySchema), asyncHandler(financieraController.empleados));
router.get('/financiera/empleados/:empleadoId/jornadas', isFinanciera, validar(jornadasEmpleadoSchema), asyncHandler(financieraController.jornadasDe));
router.get('/financiera/empleados/:empleadoId/jornada/:fecha/trazabilidad', isFinanciera, validar(trazabilidadEquipoParamsSchema), asyncHandler(financieraController.trazabilidadDe));
// Todas las solicitudes de cambio de turno y su estado, solo lectura (§50).
router.get('/financiera/cambios-turno', isFinanciera, validar(financieraCambiosTurnoQuerySchema), asyncHandler(cambioTurnoController.todas));

module.exports = router;
