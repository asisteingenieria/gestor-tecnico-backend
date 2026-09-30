const User = require('../models/User');
const jwt = require('jsonwebtoken');

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

        // Crear y firmar el token JWT
        const payload = {
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                sede: user.sede,
                departamento: user.departamento,
                full_name: user.full_name,
                users_company_id: user.users_company_id
            }
        };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '5h' }, // El token expira en 5 horas
            (err, token) => {
                if (err) throw err;
                res.json({ 
                    token, 
                    user: { 
                        id: user.id, 
                        fullName: user.full_name, 
                        role: user.role, 
                        sede: user.sede,
                        departamento: user.departamento 
                    } 
                });
            }
        );

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

    try {
        const user = await User.getByUsername(req.user.username);
        
        // Verificar contraseña actual
        const isMatch = await User.validatePassword(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Contraseña actual incorrecta' });
        }

        // Actualizar contraseña
        await User.updatePassword(req.user.id, newPassword);
        res.json({ msg: 'Contraseña actualizada exitosamente' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};
