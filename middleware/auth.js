const jwt = require('jsonwebtoken');

// Middleware para verificar el token JWT
const RUTAS_PERMITIDAS_SIN_CAMBIO = ['/api/auth/me', '/api/auth/change-password'];

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
        if (req.user.debe_cambiar_password && !RUTAS_PERMITIDAS_SIN_CAMBIO.includes(req.originalUrl.split('?')[0])) {
            return res.status(403).json({ codigo: 'CAMBIO_PASSWORD_REQUERIDO', msg: 'Debes cambiar tu contraseña antes de continuar' });
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
// recursosHumanos: su cuenta ya está vinculada a su ficha (es el "analista encargado" de las
// altas), así que ve su propia asistencia con ella en vez de tener cuenta de empleado aparte.
const canRegistrarAsistencia = verifyRole(['empleado', 'director_operaciones', 'recursosHumanos', 'admin']);

// Middleware para contratación desde Hydra (conexionhydra.md §8)
const isRecursosHumanos = verifyRole(['recursosHumanos', 'admin']);

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
    canRegistrarAsistencia,
    // Middleware para contratación desde Hydra
    isRecursosHumanos
};