const User = require('../models/User');
const CuentaEmpleado = require('../models/CuentaEmpleado');
const jwt = require('jsonwebtoken');
const { esJefeDeEquipo } = require('../services/asistencia/equipoService');

// Arma y firma el JWT de la sesión. `debe_cambiar_password` viaja en el token para que
// middleware/auth.js bloquee el resto de la API hasta que se cambie (asistencia.md §19).
// `esJefeEquipo` no va en el token (middleware/auth.js lo consulta en vivo); solo le dice al
// frontend si muestra la gestión de equipo (asistencia.md §23).
// `tipo_cuenta: 'empleado'` marca una sesión de cuenta_empleado (§24): su `id` es el de esa
// tabla, no un users.id, y middleware/auth.js la limita a /api/auth y /api/asistencia.
function firmarSesion(user, esJefeEquipo) {
    const payload = {
        user: {
            id: user.id,
            ...(user.tipo_cuenta ? { tipo_cuenta: user.tipo_cuenta } : {}),
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
            debeCambiarPassword: Boolean(user.debe_cambiar_password),
            esJefeEquipo: Boolean(esJefeEquipo),
            ...(user.tipo_cuenta ? { tipoCuenta: user.tipo_cuenta } : {})
        }
    };
}

// Una cuenta_empleado con la misma forma que una fila de users, para firmar su sesión y
// responder /auth/me igual que para los demás usuarios.
function comoUsuario(cuenta) {
    return {
        id: cuenta.idcuenta_empleado,
        tipo_cuenta: 'empleado',
        username: cuenta.usuario,
        full_name: cuenta.nombre_propio || cuenta.nombre_completo || cuenta.usuario,
        role: 'empleado',
        sede: null,
        departamento: null,
        users_company_id: cuenta.users_company_id,
        debe_cambiar_password: Boolean(cuenta.debe_cambiar_password),
        created_at: cuenta.creado_en
    };
}

const esSesionDeEmpleado = (reqUser) => reqUser?.tipo_cuenta === 'empleado';

// @desc    Iniciar sesión de un usuario
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ msg: 'Por favor, ingrese usuario y contraseña' });
    }

    try {
        // Primero los usuarios del sistema; si el usuario no existe ahí, las cuentas de
        // empleado (cédula, §24). Si existe en users, solo vale la contraseña de users.
        let user = await User.getByUsername(username);
        let cuenta = null;
        if (!user) {
            cuenta = await CuentaEmpleado.getByUsuario(String(username).trim());
            if (cuenta) user = { ...comoUsuario(cuenta), password: cuenta.password };
        }

        if (!user) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        // Verificar la contraseña
        const isMatch = await User.validatePassword(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ msg: 'Credenciales inválidas' });
        }

        // Las cuentas director_operaciones se desactivaron (067, asistencia.md §26): el jefe
        // entra ahora con su cédula.
        if (!cuenta && user.activo === 0) {
            return res.status(403).json({ msg: 'Esta cuenta ya no está activa. Ingresa con tu número de cédula.' });
        }

        // Una cuenta vinculada a una ficha de RRHH deja de entrar cuando el empleado se
        // retira (contrato 'retirado' o 'inactivo'). La cuenta se conserva: si lo reintegran,
        // vuelve a entrar sin hacer nada. Ver asistencia.md §19.
        if (user.users_company_id && !(await User.fichaVigente(user.users_company_id))) {
            return res.status(403).json({ msg: 'Tu cuenta está inactiva porque tu contrato ya no está vigente. Comunícate con Recursos Humanos.' });
        }

        if (cuenta) await CuentaEmpleado.registrarIngreso(cuenta.idcuenta_empleado);
        res.json(firmarSesion(user, await esJefeDeEquipo(user.users_company_id)));

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
        const user = esSesionDeEmpleado(req.user)
            ? await CuentaEmpleado.getById(req.user.id).then((c) => c && comoUsuario(c))
            : await User.getById(req.user.id);
        if (!user) {
            return res.status(404).json({ msg: 'Usuario no encontrado' });
        }
        res.json({ ...user, es_jefe_equipo: await esJefeDeEquipo(user.users_company_id) });
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
        if (esSesionDeEmpleado(req.user)) {
            const cuenta = await CuentaEmpleado.getByUsuario(req.user.username);
            if (!cuenta || cuenta.idcuenta_empleado !== req.user.id) {
                return res.status(404).json({ msg: 'Usuario no encontrado' });
            }
            if (!(await User.validatePassword(currentPassword, cuenta.password))) {
                return res.status(400).json({ msg: 'Contraseña actual incorrecta' });
            }
            await CuentaEmpleado.cambiarPassword(cuenta.idcuenta_empleado, newPassword);
            const actualizada = comoUsuario(await CuentaEmpleado.getById(cuenta.idcuenta_empleado));
            return res.json({ msg: 'Contraseña actualizada exitosamente', ...firmarSesion(actualizada, await esJefeDeEquipo(actualizada.users_company_id)) });
        }

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
        res.json({ msg: 'Contraseña actualizada exitosamente', ...firmarSesion(actualizado, await esJefeDeEquipo(actualizado.users_company_id)) });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};
