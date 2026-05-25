const express = require('express');
const router = express.Router();
const { verifyToken, verifyRole, isAdmin, isAdminOrCoordinador } = require('../middleware/auth');
const uploadDisenos = require('../middleware/uploadDisenos');
const uploadEntregas = require('../middleware/uploadEntregas');
const ctrl = require('../controllers/disenoController');

router.use(verifyToken);

// Listar diseñadores disponibles
router.get('/disenadores', isAdminOrCoordinador, ctrl.getDisenadores);

// Listar diseños (visibilidad filtrada por rol en el controller)
router.get('/', ctrl.getDisenos);

// Descargar todos los archivos de referencia como ZIP
router.get('/:id/imagenes/download', ctrl.downloadImagenes);

// Descargar todos los archivos de entrega como ZIP
router.get('/:id/entregas/download', ctrl.downloadEntregas);

// Obtener un diseño por id
router.get('/:id', ctrl.getDisenoById);

// Crear solicitud de diseño (cualquier usuario autenticado)
router.post('/', uploadDisenos.array('imagenes', 60), ctrl.createDiseno);

// Actualizar nombre/descripcion y agregar archivos de referencia
router.put('/:id', uploadDisenos.array('imagenes', 60), ctrl.updateDiseno);

// Asignar diseñador (admin o coordinador)
router.put('/:id/assign', isAdminOrCoordinador, ctrl.assignDesigner);

// Marcar como completado (diseñador asignado, admin o coordinador)
router.put('/:id/complete', ctrl.markCompleted);

// Pausar / reanudar solicitud (solo el diseñador asignado)
router.put('/:id/espera', ctrl.toggleEspera);

// Devolver diseño al diseñador con nota y opcionalmente nuevas imágenes de referencia
router.put('/:id/return', uploadDisenos.array('imagenes', 60), ctrl.returnDiseno);

// Eliminar imagen adjunta
router.delete('/:id/imagenes/:imagenId', ctrl.deleteImagen);

// Establecer o actualizar fecha estimada de entrega
router.put('/:id/fecha-estimada', ctrl.setFechaEstimada);

// Subir archivos de entrega (diseñador asignado, admin o coordinador)
router.post('/:id/entregas', uploadEntregas.array('archivos', 10), ctrl.uploadEntrega);

// Reemplazar TODOS los archivos de entrega (borra anteriores del disco y BD)
router.put('/:id/entregas/replace', uploadEntregas.array('archivos', 10), ctrl.replaceEntregas);

// Historial de devoluciones
router.get('/:id/devoluciones', ctrl.getDevoluciones);

// Eliminar archivo de entrega
router.delete('/:id/entregas/:archivoId', ctrl.deleteEntrega);

// Eliminar diseño (admin o coordinador)
router.delete('/:id', isAdminOrCoordinador, ctrl.deleteDiseno);

module.exports = router;
