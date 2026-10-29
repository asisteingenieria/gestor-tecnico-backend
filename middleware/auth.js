const jwt = require('jsonwebtoken');

// Middleware para verificar el token JWT
const RUTAS_PERMITIDAS_SIN_CAMBIO = ['/api/auth/me', '/api/auth/change-password'];
const RUTAS_CUENTA_EMPLEADO = ['/api/auth/', '/api/asistencia/'];

const verifyToken = (req, res, next) => {
    const token = req.header('x-auth-token');

    if (!token) {
        return res.status(401).json({ msg: 'Token no proporcionado, acceso denegado' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded.user;
        // Cuenta con la contraseña inicial (cédula): hasta cambiarla solo puede consultar su
        // sesión y cambiar la contraseña. Ver asistencia.md §19.
        const ruta = req.originalUrl.split('?')[0];
        if (req.user.debe_cambiar_password && !RUTAS_PERMITIDAS_SIN_CAMBIO.includes(ruta)) {
            return res.status(403).json({ codigo: 'CAMBIO_PASSWORD_REQUERIDO', msg: 'Debes cambiar tu contraseña antes de continuar' });
        }
        // Sesión de cuenta_empleado (asistencia.md §24): su id no es un users.id y puede
        // coincidir con el de otro usuario, así que nunca llega a otro módulo.
        if (req.user.tipo_cuenta === 'empleado' && !RUTAS_CUENTA_EMPLEADO.some((prefijo) => ruta.startsWith(prefijo))) {
            return res.status(403).json({ msg: 'No tienes permisos para realizar esta acción' });
        }
        next();
    } catch (err) {
        res.status(401).json({ msg: 'Token no válido' });
    }
};

// Middleware para verificar roles específicos
const verifyRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ msg: 'No autenticado' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ msg: 'No tienes permisos para realizar esta acción' });
        }

        next();
    };
};

// Middleware específicos para cada rol
const isAdmin = verifyRole(['admin']);
const isCoordinador = verifyRole(['coordinador', 'admin']);
const isJefeOperaciones = verifyRole(['jefe_operaciones', 'admin']);
const isTechnician = verifyRole(['technician', 'admin']);
const isAdminOrCoordinador = verifyRole(['admin', 'coordinador']);
const isAdminOrTechnician = verifyRole(['admin', 'technician']);
const isAdminOrJefeOperaciones = verifyRole(['admin', 'jefe_operaciones']);
const canCreateIncidentsWithFiles = verifyRole(['admin', 'coordinador', 'administrativo', 'jefe_operaciones', 'directivoFinanciero']);

// Roles de supervisión (pueden crear y supervisar incidencias)
const canCreateIncidents = verifyRole(['admin', 'supervisor', 'coordinador', 'jefe_operaciones', 'directivoFinanciero']);
const canSuperviseIncidents = verifyRole(['admin', 'supervisor', 'coordinador', 'administrativo', 'jefe_operaciones']);
const canViewIncidents = verifyRole(['admin', 'supervisor', 'coordinador', 'jefe_operaciones', 'administrativo']);

// Mantener compatibilidad temporal con 'supervisor'
const isSupervisor = verifyRole(['supervisor', 'coordinador', 'admin']);
const isAdminOrSupervisor = verifyRole(['admin', 'supervisor', 'coordinador']);

// Middlewares para tecnicoInventario
const isTecnicoInventario = verifyRole(['tecnicoInventario']);
const canAccessAssets = verifyRole(['tecnicoInventario', 'gestorActivos', 'directivoFinanciero', 'admin']);
const canViewAssetHistory = verifyRole(['gestorActivos', 'admin']);
const canEditHardwareComponents = verifyRole(['tecnicoInventario', 'gestorActivos', 'admin']);

// Middleware para directivoFinanciero
const isDirectivoFinanciero = verifyRole(['directivoFinanciero', 'admin']);

// Middlewares para diseños
const isDisenador = verifyRole(['disenador', 'admin']);
const canManageDisenos = verifyRole(['admin', 'coordinador', 'disenador']);

// Middlewares para asistencia
const isDirectorOperaciones = verifyRole(['director_operaciones', 'admin']);
const isEmpleado = verifyRole(['empleado', 'admin']);
// Gestión de equipo (horarios, horas extra, trazabilidad): director_operaciones/admin por rol,
// o cualquier cuenta cuya ficha sea jefe de área de un contrato activo, sin importar su rol
// (asistencia.md §23). Qué empleados puede tocar lo sigue validando assertEmpleadoACargo.
const canDirigirEquipo = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ msg: 'No autenticado' });
    }
    if (['director_operaciones', 'admin'].includes(req.user.role)) {
        return next();
    }
    try {
        // Carga diferida: este archivo lo usan todos los módulos y solo esta función toca la BD.
        const { esJefeDeEquipo } = require('../services/asistencia/equipoService');
        if (await esJefeDeEquipo(req.user.users_company_id)) {
            return next();
        }
        return res.status(403).json({ msg: 'No tienes permisos para realizar esta acción' });
    } catch (err) {
        next(err);
    }
};
// Cambios de turno (asistencia.md §50): los pide el coordinador, que es quien es jefe inmediato de
// alguien con contrato activo (o un jefe de área). Como canDirigirEquipo, sale de RRHH en cada petición.
const canSolicitarCambioTurno = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ msg: 'No autenticado' });
    }
    try {
        const { puedeSolicitar } = require('../services/asistencia/cambioTurnoService');
        if (await puedeSolicitar(req.user.users_company_id)) {
            return next();
        }
        return res.status(403).json({ msg: 'Solo los coordinadores pueden solicitar cambios de turno' });
    } catch (err) {
        next(err);
    }
};
// recursosHumanos: su cuenta ya está vinculada a su ficha (es el "analista encargado" de las
// altas), así que ve su propia asistencia con ella en vez de tener cuenta de empleado aparte.
// financiera (§32) también tiene su cuenta vinculada a su ficha y ve su propia asistencia.
const canRegistrarAsistencia = verifyRole(['empleado', 'director_operaciones', 'recursosHumanos', 'financiera', 'admin']);

// Middleware para contratación desde Hydra (conexionhydra.md §8)
// financiera administra RRHH igual que recursosHumanos (asistencia.md §32).
const isRecursosHumanos = verifyRole(['recursosHumanos', 'financiera', 'admin']);

// financiera: recibe y revisa los reportes de horas extras y ve la trazabilidad de todos (§32).
const isFinanciera = verifyRole(['financiera', 'admin']);

module.exports = {
    verifyToken,
    verifyRole,
    isAdmin,
    isCoordinador,
    isJefeOperaciones,
    isSupervisor, // Mantener compatibilidad
    isTechnician,
    isAdminOrCoordinador,
    isAdminOrSupervisor, // Mantener compatibilidad
    isAdminOrTechnician,
    isAdminOrJefeOperaciones,
    canCreateIncidents,
    canSuperviseIncidents,
    canViewIncidents,
    canCreateIncidentsWithFiles,
    // Middlewares para tecnicoInventario
    isTecnicoInventario,
    canAccessAssets,
    canViewAssetHistory,
    canEditHardwareComponents,
    // Middleware para directivoFinanciero
    isDirectivoFinanciero,
    // Middlewares para diseños
    isDisenador,
    canManageDisenos,
    // Middlewares para asistencia
    isDirectorOperaciones,
    isEmpleado,
    canDirigirEquipo,
    canSolicitarCambioTurno,
    canRegistrarAsistencia,
    isFinanciera,
    // Middleware para contratación desde Hydra
    isRecursosHumanos
};