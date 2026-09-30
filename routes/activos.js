const express = require('express');
const router = express.Router();
const activoController = require('../controllers/activoController');
const { verifyToken } = require('../middleware/auth');
const uploadActivos = require('../middleware/uploadActivos');

// Middleware para verificar rol de gestorActivos
const verificarGestorActivos = (req, res, next) => {
    if (!['gestorActivos', 'admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado. Solo los gestores de activos pueden acceder a esta funcionalidad.'
        });
    }
    next();
};

// Aplicar autenticación a todas las rutas
router.use(verifyToken);
router.use(verificarGestorActivos);

// Rutas para gestión de activos

// GET /api/activos - Obtener todos los activos (con filtros opcionales)
router.get('/', activoController.getActivos);

// GET /api/activos/stats - Obtener estadísticas de activos
router.get('/stats', activoController.getStats);

// GET /api/activos/responsables - Obtener lista de responsables
router.get('/responsables', activoController.getResponsables);

// GET /api/activos/placa/:placa - Buscar activo por número de placa (tolerante a pistola)
router.get('/placa/:placa', activoController.getActivoByPlaca);

// GET /api/activos/:id - Obtener un activo específico
router.get('/:id', activoController.getActivoById);

// POST /api/activos - Crear nuevo activo (con archivo opcional)
router.post('/', uploadActivos.single('adjunto_archivo'), activoController.createActivo);

// PUT /api/activos/:id - Actualizar activo (con archivo opcional)
router.put('/:id', uploadActivos.single('adjunto_archivo'), activoController.updateActivo);

// DELETE /api/activos/:id - Eliminar activo
router.delete('/:id', activoController.deleteActivo);

module.exports = router;