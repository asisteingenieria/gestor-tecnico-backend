const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Arma y firma el JWT de la sesión. `debe_cambiar_password` viaja en el token para que
// middleware/auth.js bloquee el resto de la API hasta que se cambie (asistencia.md §19).
function firmarSesion(user) {
    const payload = {
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            sede: user.sede,
            departamento: user.departamento,
            full_name: user.full_name,
            users_company_id: user.users_company_id,
            debe_cambiar_password: Boolean(user.debe_cambiar_password)
        }
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '5h' }); // expira en 5 horas
    return {
        token,
        user: {
            id: user.id,
            fullName: user.full_name,
            role: user.role,
            sede: user.sede,
            departamento: user.departamento,
            debeCambiarPassword: Boolean(user.debe_cambiar_password)
        }
    };
}

// @desc    Iniciar sesión de un usuario
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ msg: 'Por favor, ingrese usuario y contraseña' });
    }

    try {
        // Verificar si el usuario existe
        const user = await User.getByUsername(username);

        if (!user) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        // Verificar la contraseña
        const isMatch = await User.validatePassword(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        // Una cuenta vinculada a una ficha de RRHH deja de entrar cuando el empleado se
        // retira (contrato 'retirado' o 'inactivo'). La cuenta se conserva: si lo reintegran,
        // vuelve a entrar sin hacer nada. Ver asistencia.md §19.
        if (user.users_company_id && !(await User.fichaVigente(user.users_company_id))) {
            return res.status(403).json({ msg: 'Tu cuenta está inactiva porque tu contrato ya no está vigente. Comunícate con Recursos Humanos.' });
        }

        res.json(firmarSesion(user));

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};

// @desc    Obtener información del usuario autenticado
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res) => {
    try {
        const user = await User.getById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'Usuario no encontrado' });
        }
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};

// @desc    Cambiar contraseña
// @route   PUT /api/auth/change-password
// @access  Private
exports.changePassword = async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ msg: 'Por favor, proporcione la contraseña actual y la nueva' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ msg: 'La nueva contraseña debe tener al menos 6 caracteres' });
    }

    // La contraseña inicial de las cuentas de empleado es la cédula, que también es el usuario.
    if (newPassword === req.user.username) {
        return res.status(400).json({ msg: 'La nueva contraseña no puede ser igual a tu usuario o cédula' });
    }
    if (newPassword === currentPassword) {
        return res.status(400).json({ msg: 'La nueva contraseña debe ser distinta de la actual' });
    }

    try {
        const user = await User.getByUsername(req.user.username);
        
        // Verificar contraseña actual
        const isMatch = await User.validatePassword(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Contraseña actual incorrecta' });
        }

        // Actualizar contraseña y quitar la marca de cambio obligatorio. Se devuelve una
        // sesión nueva porque el token anterior lleva debe_cambiar_password = true.
        await User.updatePassword(req.user.id, newPassword);
        await User.marcarPasswordCambiada(req.user.id);
        const actualizado = await User.getByUsername(req.user.username);
        res.json({ msg: 'Contraseña actualizada exitosamente', ...firmarSesion(actualizado) });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};
