const express = require('express');
const router = express.Router();
const { verifyToken, verifyRole } = require('../middleware/auth');
const awareAgentesController = require('../controllers/awareAgentesController');

// Pestaña "Empleados activos" del técnico de inventario: quién está activo en la compañía y quién en
// Aware, con nombre y cédula. Los datos de Aware llegan por VoxPro (services/voxproAwareClient.js).
const canVerCruceAware = verifyRole(['tecnicoInventario', 'gestorActivos', 'admin']);

router.use(verifyToken, canVerCruceAware);

// @route   GET /api/aware-agentes/cruce
// @access  Private (tecnicoInventario, gestorActivos, admin)
router.get('/cruce', awareAgentesController.getCruce);

module.exports = router;
