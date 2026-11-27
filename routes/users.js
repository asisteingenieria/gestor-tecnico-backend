const express = require('express');
const router = express.Router();
const {
    getAllUsers,
    getTechnicians,
    getCoordinators,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    buscarCuentasEmpleado,
    restablecerPasswordCuentaEmpleado,
    restablecerPasswordUsuario
} = require('../controllers/userController');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Rutas protegidas - requieren autenticación
router.use(verifyToken);

// Ruta para obtener todos los técnicos (accesible para todos los roles)
router.get('/technicians', getTechnicians);

// Ruta para obtener coordinadores (jefes de operaciones)
router.get('/coordinators', getCoordinators);

// Rutas solo para administradores
// Restablecer contraseñas (cuentas por cédula y usuarios del sistema). Van antes de /:id.
router.get('/cuentas-empleado', isAdmin, buscarCuentasEmpleado);
router.post('/cuentas-empleado/:id/restablecer-password', isAdmin, restablecerPasswordCuentaEmpleado);
router.post('/:id/restablecer-password', isAdmin, restablecerPasswordUsuario);

router.get('/', isAdmin, getAllUsers);
router.get('/:id', isAdmin, getUserById);
router.post('/', isAdmin, createUser);
router.put('/:id', isAdmin, updateUser);
router.delete('/:id', isAdmin, deleteUser);

module.exports = router;