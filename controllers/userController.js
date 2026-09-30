const User = require('../models/User');
const UserCompany = require('../models/UserCompany');

const ROLES_VINCULADOS_A_EMPLEADO = ['director_operaciones', 'empleado', 'recursosHumanos'];

// @desc    Obtener todos los usuarios
// @route   GET /api/users
// @access  Private (Admin)
exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.getAll();
        res.json(users);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};

// @desc    Obtener todos los técnicos
// @route   GET /api/users/technicians
// @access  Private
exports.getTechnicians = async (req, res) => {
    try {
        const technicians = await User.getTechnicians();
        res.json(technicians);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};

// @desc    Obtener coordinadores
// @route   GET /api/users/coordinators
// @access  Private (Jefe de Operaciones)
exports.getCoordinators = async (req, res) => {
    try {
        const userRole = req.user.role;
        const userSede = req.user.sede;
        const userDepartamento = req.user.departamento;
        
        let query = 'SELECT id, username, full_name, sede, departamento FROM users WHERE role IN ("coordinador", "supervisor")';
        const params = [];
        
        // Si es jefe de operaciones, filtrar por su sede y departamento
        if (userRole === 'jefe_operaciones') {
            query += ' AND sede = ? AND departamento = ?';
            params.push(userSede, userDepartamento);
        }
        
        query += ' ORDER BY full_name';
        
        const db = require('../config/db');
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};

// @desc    Obtener un usuario por ID
// @route   GET /api/users/:id
// @access  Private (Admin)
exports.getUserById = async (req, res) => {
    try {
        const user = await User.getById(req.params.id);
        
        if (!user) {
            return res.status(404).json({ msg: 'Usuario no encontrado' });
        }
        
        res.json(user);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};

// @desc    Crear nuevo usuario
// @route   POST /api/users
// @access  Private (Admin)
exports.createUser = async (req, res) => {
    const { username, password, full_name, role, sede, departamento, users_company_id } = req.body;

    // Validaciones
    if (!username || !password || !full_name || !role) {
        return res.status(400).json({ 
            msg: 'Todos los campos son requeridos: usuario, contraseña, nombre completo y rol' 
        });
    }

    if (password.length < 6) {
        return res.status(400).json({ msg: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const validRoles = ['admin', 'coordinador', 'supervisor', 'technician', 'jefe_operaciones', 'administrativo', 'gestorActivos', 'tecnicoInventario', 'disenador', 'recursosHumanos', 'director_operaciones', 'empleado'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({
            msg: 'Rol no válido. Debe ser: admin, coordinador, supervisor, technician, jefe_operaciones, administrativo, gestorActivos, tecnicoInventario, disenador, recursosHumanos, director_operaciones o empleado'
        });
    }

    // No permitir crear usuarios anónimos desde la interfaz
    if (role === 'anonimo') {
        return res.status(400).json({ msg: 'No se pueden crear usuarios anónimos desde esta interfaz' });
    }

    // Director de operaciones y empleado necesitan estar vinculados a su ficha de RRHH
    // (users.users_company_id) desde la creación — si no, el módulo de asistencia los
    // rechaza con "Tu usuario no está vinculado a una ficha de RRHH". recursosHumanos
    // también lo necesita: al registrar un empleado nuevo, userCompanyController.create()
    // toma este mismo users_company_id como "analista encargado" del alta.
    if (ROLES_VINCULADOS_A_EMPLEADO.includes(role) && !users_company_id) {
        return res.status(400).json({
            msg: 'Selecciona el empleado (ficha de RRHH) que corresponde a esta cuenta'
        });
    }

    const validSedes = ['bogota', 'barranquilla'];
    if (sede && !validSedes.includes(sede)) {
        return res.status(400).json({
            msg: 'Sede no válida. Debe ser: bogota o barranquilla'
        });
    }

    // Validar departamentos según la sede
    const validDepartamentos = sede === 'bogota'
        ? ['claro', 'obama', 'vital', 'tecnologia', 'rrhh', 'reclutamiento', 'formacion_claro', 'formacion_obama', 'recepcion', 'area_financiera']
        : ['claro', 'obama']; // Barranquilla solo tiene claro/obama

    if (departamento && !validDepartamentos.includes(departamento)) {
        return res.status(400).json({
            msg: `Departamento no válido para ${sede}. Debe ser: ${validDepartamentos.join(', ')}`
        });
    }

    try {
        // Verificar si ya existe un usuario con ese nombre
        const existingUser = await User.getByUsername(username);
        if (existingUser) {
            return res.status(400).json({ msg: 'Ya existe un usuario con ese nombre' });
        }

        // Para técnicos, no enviar departamento específico (usar default de BD)
        const userData = {
            username,
            password,
            full_name,
            role
        };

        // Para gestorActivos, tecnicoInventario, disenador y recursosHumanos, no asignar sede ni departamento
        if (role === 'gestorActivos' || role === 'tecnicoInventario' || role === 'disenador' || role === 'recursosHumanos') {
            userData.sede = null;
            userData.departamento = null;
        } else {
            // Para otros roles, asignar sede y departamento normalmente
            userData.sede = sede || 'bogota';

            // Solo agregar departamento si no es técnico, administrativo, director de operaciones ni empleado
            if (role !== 'technician' && role !== 'administrativo' && role !== 'director_operaciones' && role !== 'empleado') {
                userData.departamento = departamento || 'claro';
            }
        }

        if (ROLES_VINCULADOS_A_EMPLEADO.includes(role)) {
            const empleado = await UserCompany.getById(users_company_id);
            if (!empleado) {
                return res.status(400).json({ msg: 'El empleado seleccionado no existe' });
            }

            const yaVinculado = await User.getByUsersCompanyId(users_company_id);
            if (yaVinculado) {
                return res.status(400).json({
                    msg: `Ese empleado ya tiene una cuenta vinculada (${yaVinculado.username})`
                });
            }

            userData.users_company_id = users_company_id;
        }

        const newUser = await User.create(userData);

        res.status(201).json({
            msg: 'Usuario creado exitosamente',
            user: newUser
        });
    } catch (err) {
        console.error(err.message);
        if (err.code === 'ER_DUP_ENTRY') {
            const msg = err.message.includes('uq_users_users_company')
                ? 'Ese empleado ya tiene una cuenta vinculada'
                : 'Ya existe un usuario con ese nombre';
            return res.status(400).json({ msg });
        }
        res.status(500).send('Error del servidor');
    }
};

// @desc    Actualizar usuario
// @route   PUT /api/users/:id
// @access  Private (Admin)
exports.updateUser = async (req, res) => {
    const { username, full_name, role, sede, departamento, password, users_company_id } = req.body;

    if (!username || !full_name || !role) {
        return res.status(400).json({
            msg: 'Todos los campos son requeridos: usuario, nombre completo y rol'
        });
    }

    const validRoles = ['admin', 'coordinador', 'supervisor', 'technician', 'jefe_operaciones', 'administrativo', 'gestorActivos', 'tecnicoInventario', 'disenador', 'recursosHumanos', 'director_operaciones', 'empleado'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({
            msg: 'Rol no válido. Debe ser: admin, coordinador, supervisor, technician, jefe_operaciones, administrativo, gestorActivos, tecnicoInventario, disenador, recursosHumanos, director_operaciones o empleado'
        });
    }

    if (ROLES_VINCULADOS_A_EMPLEADO.includes(role) && !users_company_id) {
        return res.status(400).json({
            msg: 'Selecciona el empleado (ficha de RRHH) que corresponde a esta cuenta'
        });
    }

    const validSedes = ['bogota', 'barranquilla'];
    if (sede && !validSedes.includes(sede)) {
        return res.status(400).json({
            msg: 'Sede no válida. Debe ser: bogota o barranquilla'
        });
    }

    // Validar departamentos según la sede
    const validDepartamentos = sede === 'bogota'
        ? ['claro', 'obama', 'vital', 'tecnologia', 'rrhh', 'reclutamiento', 'formacion_claro', 'formacion_obama', 'recepcion', 'area_financiera']
        : ['claro', 'obama']; // Barranquilla solo tiene claro/obama

    if (departamento && !validDepartamentos.includes(departamento)) {
        return res.status(400).json({
            msg: `Departamento no válido para ${sede}. Debe ser: ${validDepartamentos.join(', ')}`
        });
    }

    if (password && password.length < 6) {
        return res.status(400).json({ msg: 'La contraseña debe tener al menos 6 caracteres' });
    }

    try {
        const userExists = await User.getById(req.params.id);
        if (!userExists) {
            return res.status(404).json({ msg: 'Usuario no encontrado' });
        }

        // No permitir editar usuarios anónimos
        if (userExists.role === 'anonimo') {
            return res.status(400).json({ msg: 'No se pueden editar usuarios anónimos' });
        }

        // Verificar si el nuevo username ya existe en otro usuario
        const existingUser = await User.getByUsername(username);
        if (existingUser && existingUser.id !== parseInt(req.params.id)) {
            return res.status(400).json({ msg: 'Ya existe otro usuario con ese nombre' });
        }

        const updateData = {
            username,
            full_name,
            role
        };
        
        // Para gestorActivos, tecnicoInventario, disenador y recursosHumanos, no asignar sede ni departamento
        if (role === 'gestorActivos' || role === 'tecnicoInventario' || role === 'disenador' || role === 'recursosHumanos') {
            updateData.sede = null;
            updateData.departamento = null;
        } else {
            // Para otros roles, asignar sede y departamento normalmente
            updateData.sede = sede || userExists.sede || 'bogota';

            // Solo agregar departamento si no es técnico, administrativo, director de operaciones ni empleado
            if (role !== 'technician' && role !== 'administrativo' && role !== 'director_operaciones' && role !== 'empleado') {
                updateData.departamento = departamento || userExists.departamento || 'claro';
            }
        }

        if (ROLES_VINCULADOS_A_EMPLEADO.includes(role)) {
            const empleado = await UserCompany.getById(users_company_id);
            if (!empleado) {
                return res.status(400).json({ msg: 'El empleado seleccionado no existe' });
            }

            const yaVinculado = await User.getByUsersCompanyId(users_company_id, req.params.id);
            if (yaVinculado) {
                return res.status(400).json({
                    msg: `Ese empleado ya tiene otra cuenta vinculada (${yaVinculado.username})`
                });
            }

            updateData.users_company_id = users_company_id;
        } else {
            // Cambiar a un rol no vinculado a RRHH desvincula la ficha, si tenía una
            updateData.users_company_id = null;
        }

        let updated;
        if (password) {
            // Si se proporciona contraseña, actualizar también la contraseña
            await User.updatePassword(req.params.id, password);
            updated = await User.update(req.params.id, updateData);
        } else {
            // Si no se proporciona contraseña, solo actualizar otros campos
            updated = await User.update(req.params.id, updateData);
        }

        if (updated) {
            res.json({ msg: 'Usuario actualizado exitosamente' });
        } else {
            res.status(400).json({ msg: 'No se pudo actualizar el usuario' });
        }
    } catch (err) {
        console.error(err.message);
        if (err.code === 'ER_DUP_ENTRY') {
            const msg = err.message.includes('uq_users_users_company')
                ? 'Ese empleado ya tiene una cuenta vinculada'
                : 'Ya existe un usuario con ese nombre';
            return res.status(400).json({ msg });
        }
        res.status(500).send('Error del servidor');
    }
};

// @desc    Eliminar usuario
// @route   DELETE /api/users/:id
// @access  Private (Admin)
exports.deleteUser = async (req, res) => {
    try {
        const user = await User.getById(req.params.id);
        if (!user) {
            return res.status(404).json({ msg: 'Usuario no encontrado' });
        }

        // No permitir que el admin se elimine a sí mismo
        if (parseInt(req.params.id) === req.user.id) {
            return res.status(400).json({ msg: 'No puedes eliminar tu propio usuario' });
        }

        // No permitir eliminar usuarios anónimos
        if (user.role === 'anonimo') {
            return res.status(400).json({ msg: 'No se pueden eliminar usuarios anónimos' });
        }

        // Verificar incidencias asociadas para mostrar información al admin
        const db = require('../config/db');
        
        // Contar todas las incidencias asociadas
        const [reportedIncidents] = await db.query(`
            SELECT COUNT(*) as count 
            FROM incidents 
            WHERE reported_by_id = ?
        `, [req.params.id]);
        
        const [assignedIncidents] = await db.query(`
            SELECT COUNT(*) as count 
            FROM incidents 
            WHERE assigned_to_id = ?
        `, [req.params.id]);
        
        const totalReported = reportedIncidents[0].count;
        const totalAssigned = assignedIncidents[0].count;
        
        // Eliminar usuario usando la nueva función de eliminación forzada
        const deleted = await User.deleteWithDependencies(req.params.id);
        
        if (deleted) {
            let message = 'Usuario eliminado exitosamente';
            
            // Agregar información sobre incidencias si las tenía
            if (totalReported > 0 || totalAssigned > 0) {
                const incidentInfo = [];
                if (totalReported > 0) {
                    incidentInfo.push(`${totalReported} incidencia(s) reportada(s)`);
                }
                if (totalAssigned > 0) {
                    incidentInfo.push(`${totalAssigned} incidencia(s) asignada(s)`);
                }
                message += `. Se eliminaron también: ${incidentInfo.join(' y ')} y todos sus datos asociados (historial, archivos adjuntos, etc.).`;
            }
            
            res.json({ msg: message });
        } else {
            res.status(400).json({ msg: 'No se pudo eliminar el usuario' });
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Error del servidor');
    }
};