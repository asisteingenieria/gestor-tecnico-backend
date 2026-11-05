const express = require('express');
const router = express.Router();
const userCompanyController = require('../controllers/userCompanyController');
const { verifyToken } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const uploadEmpleados = require('../middleware/uploadEmpleados');
const { soportesNovedad, soportesTraspaso, documentosEmpleado } = require('../middleware/uploadSoportesRrhh');

// Lectura de la ficha de empleados: RRHH, financiera y admin, más cualquier usuario con el
// permiso de solo lectura `ver_empleados_rrhh` (migración 095), p. ej. un técnico puntual.
// El admin y los usuarios con el permiso la usan en SOLO LECTURA: ven la lista, la ficha
// completa y los documentos, pero NO crean, editan, eliminan ni importan (eso lo bloquea
// verificarGestionRRHH).
const verificarRecursosHumanos = (req, res, next) => {
    // financiera administra RRHH igual que recursosHumanos (asistencia.md §32).
    if (['recursosHumanos', 'financiera', 'admin'].includes(req.user.role) || req.user.ver_empleados_rrhh) {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Acceso denegado. Solo Recursos Humanos puede acceder a esta funcionalidad.'
    });
};

// Gestión (escritura) del módulo de empleados y de sus submódulos (novedades, traspasos,
// vacaciones): solo recursosHumanos y financiera. El admin NO entra aquí: su acceso al módulo
// es de solo lectura sobre empleados y documentos. (Quitarle al admin la escritura en RRHH era
// la decisión pendiente de CLAUDE.md "Roles"; se toma aquí: en RRHH el admin es solo lectura.)
const verificarGestionRRHH = (req, res, next) => {
    if (!['recursosHumanos', 'financiera'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado. Esta acción es solo para Recursos Humanos.'
        });
    }
    next();
};

// Lectura del listado de empleados: además de RRHH, gestorActivos la necesita
// (solo lectura) para el selector de "agente asignado" al crear/editar un activo.
const verificarLecturaEmpleados = (req, res, next) => {
    if (['gestorActivos', 'recursosHumanos', 'financiera', 'admin'].includes(req.user.role) || req.user.ver_empleados_rrhh) {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Acceso denegado.'
    });
};

// Gasto total en salarios: solo financiera y admin. recursosHumanos ve contratación, no costos.
const verificarFinanciera = (req, res, next) => {
    if (!['financiera', 'admin'].includes(req.user.role)) {
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
router.get('/gasto-total',               verificarFinanciera, userCompanyController.getGastoTotal);

// Import masivo de empleados desde Excel (escritura: no admin)
router.post('/import-excel/preview',     verificarGestionRRHH, uploadEmpleados.single('archivo'), asyncHandler(userCompanyController.previewImportExcel));
router.post('/import-excel/commit',      verificarGestionRRHH, uploadEmpleados.single('archivo'), asyncHandler(userCompanyController.commitImportExcel));

// Novedades RRHH (deben ir antes de '/:id' para no colisionar con ella). Submódulo cerrado al
// admin: su solo lectura es sobre empleados y documentos, no sobre novedades.
router.get('/novedades',                 verificarGestionRRHH, userCompanyController.getNovedades);
router.post('/novedades',                verificarGestionRRHH, userCompanyController.createNovedad);
router.get('/novedades/:novedadId',      verificarGestionRRHH, userCompanyController.getNovedadById);
router.put('/novedades/:novedadId',      verificarGestionRRHH, userCompanyController.updateNovedad);
router.delete('/novedades/:novedadId',   verificarGestionRRHH, userCompanyController.deleteNovedad);
// Soportes documentales (PDF o imagen) de una novedad, uno por tipo de soporte (migración 069)
router.get('/novedades/:novedadId/soportes',                               verificarGestionRRHH, userCompanyController.getSoportesNovedad);
router.post('/novedades/:novedadId/soportes/:tipoSoporteId',               verificarGestionRRHH, soportesNovedad.middleware, userCompanyController.subirSoporteNovedad);
router.get('/novedades/:novedadId/soportes/:tipoSoporteId/archivo',        verificarGestionRRHH, userCompanyController.descargarSoporteNovedad);
router.delete('/novedades/:novedadId/soportes/:tipoSoporteId',             verificarGestionRRHH, userCompanyController.eliminarSoporteNovedad);

// Traspasos (submódulo cerrado al admin)
router.get('/traspasos',                 verificarGestionRRHH, userCompanyController.getTraspasos);
// Alertas de traspasos (evaluación del encargo, retorno del trabajo en casa — migración 070)
router.get('/traspasos/alertas',         verificarGestionRRHH, userCompanyController.getAlertasTraspasos);
router.post('/traspasos',                verificarGestionRRHH, userCompanyController.createTraspaso);
router.get('/traspasos/:traspasoId',     verificarGestionRRHH, userCompanyController.getTraspasoById);
router.put('/traspasos/:traspasoId',     verificarGestionRRHH, userCompanyController.updateTraspaso);
router.delete('/traspasos/:traspasoId',  verificarGestionRRHH, userCompanyController.deleteTraspaso);
router.post('/traspasos/:traspasoId/alertas/evaluacion',                   verificarGestionRRHH, userCompanyController.reenviarAlertaEvaluacion);
// Documentos (PDF o imagen) de un traspaso, uno por tipo de documento (migración 070)
router.get('/traspasos/:traspasoId/soportes',                              verificarGestionRRHH, userCompanyController.getSoportesTraspaso);
router.post('/traspasos/:traspasoId/soportes/:tipoSoporteId',              verificarGestionRRHH, soportesTraspaso.middleware, userCompanyController.subirSoporteTraspaso);
router.get('/traspasos/:traspasoId/soportes/:tipoSoporteId/archivo',       verificarGestionRRHH, userCompanyController.descargarSoporteTraspaso);
router.delete('/traspasos/:traspasoId/soportes/:tipoSoporteId',            verificarGestionRRHH, userCompanyController.eliminarSoporteTraspaso);

// Pasivo vacacional (submódulo cerrado al admin)
router.get('/vacaciones',                verificarGestionRRHH, userCompanyController.getVacaciones);
router.post('/vacaciones',               verificarGestionRRHH, userCompanyController.createVacaciones);
router.get('/vacaciones/:vacacionesId',  verificarGestionRRHH, userCompanyController.getVacacionesById);
router.put('/vacaciones/:vacacionesId',  verificarGestionRRHH, userCompanyController.updateVacaciones);
router.delete('/vacaciones/:vacacionesId', verificarGestionRRHH, userCompanyController.deleteVacaciones);

// --- Lectura de la ficha del empleado (admin incluido) ---
router.get('/:id',                       verificarRecursosHumanos, userCompanyController.getById);
router.get('/:id/activos',               verificarRecursosHumanos, userCompanyController.getActivos);
router.get('/:id/retiro',                verificarRecursosHumanos, userCompanyController.getRetiro);
// Documentación del empleado y contrato y anexos (migración 088): PDF de hasta 50 MB.
// Listar y descargar: lectura (admin incluido). Subir y eliminar: solo gestión (no admin).
router.get('/:id/documentos',                    verificarRecursosHumanos, userCompanyController.getDocumentosEmpleado);
router.get('/:id/documentos/:tipo/archivo',      verificarRecursosHumanos, userCompanyController.descargarDocumentoEmpleado);
router.put('/:id/documentos/:tipo',              verificarGestionRRHH, documentosEmpleado.middleware, userCompanyController.subirDocumentoEmpleado);
router.delete('/:id/documentos/:tipo',           verificarGestionRRHH, userCompanyController.eliminarDocumentoEmpleado);

// --- Escritura de la ficha del empleado (no admin) ---
router.post('/',                         verificarGestionRRHH, userCompanyController.create);
router.post('/:id/retiro',               verificarGestionRRHH, userCompanyController.registrarRetiro);
router.put('/:id',                       verificarGestionRRHH, userCompanyController.update);
router.put('/:id/activos/:activoId',     verificarGestionRRHH, userCompanyController.assignActivo);
router.put('/:id/retiro',                verificarGestionRRHH, userCompanyController.actualizarRetiro);
router.delete('/:id',                    verificarGestionRRHH, userCompanyController.delete);
router.delete('/:id/activos/:activoId',  verificarGestionRRHH, userCompanyController.unassignActivo);
router.delete('/:id/retiro',             verificarGestionRRHH, userCompanyController.reactivarEmpleado);

module.exports = router;
