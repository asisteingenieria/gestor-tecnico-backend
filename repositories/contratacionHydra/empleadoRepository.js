const db = require('../../config/db');
const UserCompany = require('../../models/UserCompany');

// Detección de reintegros: ¿ya hay un empleado con esa identificación? Por número y,
// si se conoce, también por tipo (la llave única real de users_company es tipo+número).
async function findIdPorIdentificacion(numeroIdentificacion, tipoIdentificacionId, conn = db) {
    const condiciones = ['numero_identificacion = ?'];
    const params = [numeroIdentificacion];
    if (tipoIdentificacionId) {
        condiciones.push('tipo_identificacion_idtipo_identificacion = ?');
        params.push(tipoIdentificacionId);
    }
    const [rows] = await conn.query(
        `SELECT id FROM users_company WHERE ${condiciones.join(' AND ')} ORDER BY id LIMIT 1`,
        params
    );
    return rows[0]?.id ?? null;
}

// Alta del empleado con TODA la lógica existente del módulo de RRHH (contrato, salario,
// seguridad social, cuenta, dirección…). Se delega en el modelo en vez de duplicar su
// SQL: así el alta manual, el import masivo y Hydra crean empleados idénticos. Requiere
// una conexión con transacción abierta.
async function crear(datosEmpleado, conn) {
    return UserCompany.crearEnConexion(conn, datosEmpleado);
}

module.exports = { findIdPorIdentificacion, crear };
