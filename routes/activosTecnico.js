const express = require('express');
const router = express.Router();
const { verifyToken, verifyRole, isAdmin } = require('../middleware/auth');
const activoTecnicoController = require('../controllers/activoTecnicoController');
const mantenimientoController = require('../controllers/mantenimientoActivoController');

// Middleware para verificar roles que pueden acceder a activos
const canAccessAssets = verifyRole(['tecnicoInventario', 'gestorActivos', 'admin']);

// Middleware para verificar roles que pueden ver historial
const canViewHistory = verifyRole(['gestorActivos', 'admin']);

// Middleware para verificar roles que pueden editar componentes
const canEditHardwareComponents = verifyRole(['tecnicoInventario', 'gestorActivos', 'admin']);

// @route   GET /api/activos-tecnico
// @desc    Obtener activos editables (CPU, Portátil, Servidor)
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.get('/', verifyToken, canAccessAssets, activoTecnicoController.getActivosEditables);

// @route   GET /api/activos-tecnico/historial
// @desc    Obtener todo el historial de cambios
// @access  Private (gestorActivos, admin)
router.get('/historial', verifyToken, canViewHistory, activoTecnicoController.getAllHistorial);

// @route   GET /api/activos-tecnico/historial/stats
// @desc    Obtener estadísticas del historial de cambios
// @access  Private (gestorActivos, admin)
router.get('/historial/stats', verifyToken, canViewHistory, activoTecnicoController.getHistorialStats);

// @route   GET /api/activos-tecnico/historial/filtered
// @desc    Obtener historial filtrado con paginación
// @access  Private (gestorActivos, admin)
router.get('/historial/filtered', verifyToken, canViewHistory, activoTecnicoController.getFilteredHistorial);

// @route   GET /api/activos-tecnico/no-productivos
// @desc    Obtener activos clasificados como "Activo no productivo"
// @access  Private (gestorActivos, admin)
router.get('/no-productivos', verifyToken, canViewHistory, activoTecnicoController.getActivosNoProductivos);

// @route   GET /api/activos-tecnico/en-bodega
// @desc    Obtener activos en estado bodega
// @access  Private (gestorActivos, admin)
router.get('/en-bodega', verifyToken, canViewHistory, activoTecnicoController.getActivosEnBodega);

// @route   GET /api/activos-tecnico/pendientes-baja
// @desc    Obtener activos con solicitud de baja pendiente de aprobación
// @access  Private (admin only)
router.get('/pendientes-baja', verifyToken, isAdmin, mantenimientoController.getPendientesBaja);

// @route   PUT /api/activos-tecnico/:id/dar-de-baja
// @desc    Aprobar y ejecutar la baja de un activo (acción definitiva e irreversible).
//          Sin solicitud del técnico, el comentario del admin es obligatorio.
// @access  Private (admin only)
router.put('/:id/dar-de-baja', verifyToken, isAdmin, mantenimientoController.darDeBaja);

// @route   PUT /api/activos-tecnico/:id/rechazar-baja
// @desc    Rechazar la solicitud de baja: el activo vuelve al estado que tenía
// @access  Private (admin only)
router.put('/:id/rechazar-baja', verifyToken, isAdmin, mantenimientoController.rechazarBaja);

// @route   POST /api/activos-tecnico/:id/solicitar-baja
// @desc    Solicitar la baja con observación obligatoria (queda pendiente del admin)
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.post('/:id/solicitar-baja', verifyToken, canEditHardwareComponents, mantenimientoController.solicitarBaja);

// @route   POST /api/activos-tecnico/:id/cancelar-baja
// @desc    Cancelar una solicitud de baja pendiente
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.post('/:id/cancelar-baja', verifyToken, canEditHardwareComponents, mantenimientoController.cancelarSolicitudBaja);

// @route   POST /api/activos-tecnico/:id/mantenimientos
// @desc    Registrar un mantenimiento preventivo (casillas) o correctivo (descripción)
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.post('/:id/mantenimientos', verifyToken, canEditHardwareComponents, mantenimientoController.registrarMantenimiento);

// @route   GET /api/activos-tecnico/:id/hoja-vida
// @desc    Hoja de vida del equipo: componentes, mantenimientos, traslados y bajas
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.get('/:id/hoja-vida', verifyToken, canAccessAssets, mantenimientoController.getHojaVida);

// @route   PUT /api/activos-tecnico/:id/puesto
// @desc    Trasladar el equipo a otro puesto (queda en el historial)
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.put('/:id/puesto', verifyToken, canEditHardwareComponents, mantenimientoController.trasladarPuesto);

// @route   PUT /api/activos-tecnico/:id/estado-mantenimiento
// @desc    Cambiar estado entre en_mantenimiento, funcional y bodega (la baja va por solicitar-baja)
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.put('/:id/estado-mantenimiento', verifyToken, canEditHardwareComponents, activoTecnicoController.actualizarEstadoMantenimiento);

// @route   POST /api/activos-tecnico/:id/inventario
// @desc    Crear observación de inventario para un activo
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.post('/:id/inventario', verifyToken, canEditHardwareComponents, activoTecnicoController.crearObservacionInventario);

// @route   GET /api/activos-tecnico/:id/inventario
// @desc    Obtener observaciones de inventario de un activo
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.get('/:id/inventario', verifyToken, canAccessAssets, activoTecnicoController.getObservacionesInventario);

// @route   GET /api/activos-tecnico/:id/componentes
// @desc    Obtener componentes editables de un activo específico
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.get('/:id/componentes', verifyToken, canAccessAssets, activoTecnicoController.getComponentesActivo);

// @route   PUT /api/activos-tecnico/:id/componente
// @desc    Actualizar un componente de hardware
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.put('/:id/componente', verifyToken, canEditHardwareComponents, activoTecnicoController.actualizarComponente);

// @route   GET /api/activos-tecnico/:id/historial
// @desc    Obtener historial de cambios de un activo
// @access  Private (gestorActivos, admin) - NO tecnicoInventario
router.get('/:id/historial', verifyToken, canViewHistory, activoTecnicoController.getHistorialActivo);

module.exports = router;
