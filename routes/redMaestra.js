const express = require('express');
const router = express.Router();
const redMaestraController = require('../controllers/redMaestraController');
const { verifyToken, isAdmin } = require('../middleware/auth');
const uploadEmpleados = require('../middleware/uploadEmpleados');

// Red Maestra (RM) de Claro: solo el admin del Gestor (claude/modulo recursoshumanos.md §52).
router.use(verifyToken, isAdmin);

router.get('/', redMaestraController.listar);
router.get('/export', redMaestraController.exportar);
router.get('/ingresos', redMaestraController.ingresos);
router.get('/retiros', redMaestraController.retiros);
router.get('/opciones', redMaestraController.getOpciones);
router.post('/opciones', redMaestraController.crearOpcion);
router.put('/opciones/:opcionId', redMaestraController.actualizarOpcion);
router.post('/cargue/preview', uploadEmpleados.single('archivo'), redMaestraController.previewCargue);
router.post('/cargue/confirmar', uploadEmpleados.single('archivo'), redMaestraController.confirmarCargue);
router.put('/requerimientos/:reqId', redMaestraController.actualizarRequerimiento);
router.delete('/requerimientos/:reqId', redMaestraController.eliminarRequerimiento);
router.get('/:id', redMaestraController.getEmpleado);
router.put('/:id', redMaestraController.guardarFicha);
router.post('/:id/requerimientos', redMaestraController.crearRequerimiento);
router.put('/:id/retiro-rm', redMaestraController.guardarRetiroRm);

module.exports = router;
