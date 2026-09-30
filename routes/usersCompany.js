const express = require('express');
const router = express.Router();
const userCompanyController = require('../controllers/userCompanyController');
const { verifyToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const uploadEmpleados = require('../middleware/uploadEmpleados');

// Gestión completa del módulo de empleados: exclusiva de Recursos Humanos (y admin).
const verificarRecursosHumanos = (req, res, next) => {
    if (!['recursosHumanos', 'admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado. Solo Recursos Humanos puede acceder a esta funcionalidad.'
        });
    }
    next();
};

// Lectura del listado de empleados: además de RRHH, gestorActivos la necesita
// (solo lectura) para el selector de "agente asignado" al crear/editar un activo.
const verificarLecturaEmpleados = (req, res, next) => {
    if (!['gestorActivos', 'recursosHumanos', 'admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado.'
        });
    }
    next();
};

router.use(verifyToken);

router.get('/',                          verificarLecturaEmpleados, userCompanyController.getAll);
router.get('/catalogos',                 verificarRecursosHumanos, userCompanyController.getCatalogos);
router.get('/gasto-total',               verificarRecursosHumanos, userCompanyController.getGastoTotal);

// Import masivo de empleados desde Excel
router.post('/import-excel/preview',     verificarRecursosHumanos, uploadEmpleados.single('archivo'), asyncHandler(userCompanyController.previewImportExcel));
router.post('/import-excel/commit',      verificarRecursosHumanos, uploadEmpleados.single('archivo'), asyncHandler(userCompanyController.commitImportExcel));

// Novedades RRHH (deben ir antes de '/:id' para no colisionar con ella)
router.get('/novedades',                 verificarRecursosHumanos, userCompanyController.getNovedades);
router.post('/novedades',                verificarRecursosHumanos, userCompanyController.createNovedad);
router.get('/novedades/:novedadId',      verificarRecursosHumanos, userCompanyController.getNovedadById);
router.put('/novedades/:novedadId',      verificarRecursosHumanos, userCompanyController.updateNovedad);
router.delete('/novedades/:novedadId',   verificarRecursosHumanos, userCompanyController.deleteNovedad);

// Traspasos
router.get('/traspasos',                 verificarRecursosHumanos, userCompanyController.getTraspasos);
router.post('/traspasos',                verificarRecursosHumanos, userCompanyController.createTraspaso);
router.get('/traspasos/:traspasoId',     verificarRecursosHumanos, userCompanyController.getTraspasoById);
router.put('/traspasos/:traspasoId',     verificarRecursosHumanos, userCompanyController.updateTraspaso);
router.delete('/traspasos/:traspasoId',  verificarRecursosHumanos, userCompanyController.deleteTraspaso);

// Pasivo vacacional
router.get('/vacaciones',                verificarRecursosHumanos, userCompanyController.getVacaciones);
router.post('/vacaciones',               verificarRecursosHumanos, userCompanyController.createVacaciones);
router.get('/vacaciones/:vacacionesId',  verificarRecursosHumanos, userCompanyController.getVacacionesById);
router.put('/vacaciones/:vacacionesId',  verificarRecursosHumanos, userCompanyController.updateVacaciones);
router.delete('/vacaciones/:vacacionesId', verificarRecursosHumanos, userCompanyController.deleteVacaciones);

router.get('/:id',                       verificarRecursosHumanos, userCompanyController.getById);
router.get('/:id/activos',               verificarRecursosHumanos, userCompanyController.getActivos);
router.get('/:id/retiro',                verificarRecursosHumanos, userCompanyController.getRetiro);
router.post('/',                         verificarRecursosHumanos, userCompanyController.create);
router.post('/:id/retiro',               verificarRecursosHumanos, userCompanyController.registrarRetiro);
router.put('/:id',                       verificarRecursosHumanos, userCompanyController.update);
router.put('/:id/activos/:activoId',     verificarRecursosHumanos, userCompanyController.assignActivo);
router.put('/:id/retiro',                verificarRecursosHumanos, userCompanyController.actualizarRetiro);
router.delete('/:id',                    verificarRecursosHumanos, userCompanyController.delete);
router.delete('/:id/activos/:activoId',  verificarRecursosHumanos, userCompanyController.unassignActivo);
router.delete('/:id/retiro',             verificarRecursosHumanos, userCompanyController.reactivarEmpleado);

module.exports = router;
