const express = require('express');
const router = express.Router();
const agenteController = require('../controllers/agenteController');
const { verifyToken } = require('../middleware/auth');

const verificarGestorActivos = (req, res, next) => {
    if (!['gestorActivos', 'admin'].includes(req.user.role)) {
        return res.status(403).json({
            success: false,
            message: 'Acceso denegado. Solo los gestores de activos pueden acceder a esta funcionalidad.'
        });
    }
    next();
};

router.use(verifyToken);
router.use(verificarGestorActivos);

router.get('/',             agenteController.getAgentes);
router.get('/:id',          agenteController.getAgenteById);
router.get('/:id/activos',  agenteController.getActivosDeAgente);
router.post('/',            agenteController.createAgente);
router.put('/:id',          agenteController.updateAgente);
router.delete('/:id',       agenteController.deleteAgente);

module.exports = router;
