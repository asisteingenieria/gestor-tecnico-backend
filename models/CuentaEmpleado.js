const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Cuentas de empleado (asistencia.md §24, migración 065): una por ficha de RRHH, usuario y
// contraseña inicial = cédula, con cambio obligatorio en el primer ingreso. Viven aparte de
// `users` (los usuarios del sistema que crea el admin) y solo dan acceso a asistencia.
class CuentaEmpleado {
    static async getByUsuario(usuario) {
        const [rows] = await db.query(
            `SELECT ce.*, uc.nombre_propio,
                    TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido)) AS nombre_completo
               FROM cuenta_empleado ce
               JOIN users_company uc ON uc.id = ce.users_company_id
              WHERE ce.usuario = ?`,
            [usuario]
        );
        return rows[0];
    }

    static async getById(id) {
        const [rows] = await db.query(
            `SELECT ce.idcuenta_empleado, ce.usuario, ce.users_company_id, ce.debe_cambiar_password, ce.creado_en,
                    uc.nombre_propio,
                    TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido)) AS nombre_completo
               FROM cuenta_empleado ce
               JOIN users_company uc ON uc.id = ce.users_company_id
              WHERE ce.idcuenta_empleado = ?`,
            [id]
        );
        return rows[0];
    }

    // Crea la cuenta de una ficha dentro de la transacción de quien llama. No falla si no se
    // puede (la ficha ya tiene cuenta, de empleado o vinculada en `users`, o la cédula ya es
    // un usuario): devuelve el motivo, para que el alta del empleado nunca se caiga por esto.
    static async crearEnConexion(conn, { usersCompanyId, cedula }) {
        const usuario = String(cedula ?? '').trim();
        if (!usuario) return { creada: false, motivo: 'sin_cedula' };

        const [propia] = await conn.query('SELECT idcuenta_empleado FROM cuenta_empleado WHERE users_company_id = ? LIMIT 1', [usersCompanyId]);
        if (propia.length > 0) return { creada: false, motivo: 'ya_tiene_cuenta' };

        // Una ficha vinculada a mano a un usuario del sistema activo (RRHH…) ya entra con esa
        // cuenta. Una desactivada (las director_operaciones, 067) no cuenta.
        const [vinculada] = await conn.query('SELECT id, username, role FROM users WHERE users_company_id = ? AND activo = 1 LIMIT 1', [usersCompanyId]);
        if (vinculada.length > 0) return { creada: false, motivo: 'ya_tiene_cuenta', cuenta: vinculada[0] };

        // El login busca primero en `users`: con la cédula ocupada ahí, esta cuenta nunca entraría.
        const [ocupado] = await conn.query(
            'SELECT 1 FROM users WHERE username = ? UNION ALL SELECT 1 FROM cuenta_empleado WHERE usuario = ? LIMIT 1',
            [usuario, usuario]
        );
        if (ocupado.length > 0) return { creada: false, motivo: 'usuario_ocupado' };

        const hash = await bcrypt.hash(usuario, await bcrypt.genSalt(10));
        const [resultado] = await conn.query(
            'INSERT INTO cuenta_empleado (users_company_id, usuario, password, debe_cambiar_password) VALUES (?, ?, ?, 1)',
            [usersCompanyId, usuario, hash]
        );
        return { creada: true, id: resultado.insertId, usuario };
    }

    static async existeUsuario(usuario) {
        const [rows] = await db.query('SELECT 1 FROM cuenta_empleado WHERE usuario = ? LIMIT 1', [usuario]);
        return rows.length > 0;
    }

    static async cambiarPassword(id, nuevaPassword) {
        const hash = await bcrypt.hash(nuevaPassword, await bcrypt.genSalt(10));
        await db.query('UPDATE cuenta_empleado SET password = ?, debe_cambiar_password = 0 WHERE idcuenta_empleado = ?', [hash, id]);
    }

    static async registrarIngreso(id) {
        await db.query('UPDATE cuenta_empleado SET ultimo_ingreso = NOW() WHERE idcuenta_empleado = ?', [id]);
    }
}

module.exports = CuentaEmpleado;
