// Autor de un registro de asistencia (asistencia.md §24): un usuario del sistema (users.id) o
// una cuenta de empleado (cuenta_empleado). Cada tabla tiene una columna para cada uno.
function autorDe(req) {
    return req.user.tipo_cuenta === 'empleado'
        ? { userId: null, cuentaId: req.user.id }
        : { userId: req.user.id, cuentaId: null };
}

module.exports = { autorDe };
