const db = require('../config/db');

// Documentos del empleado que carga RRHH después de registrarlo (migración 088): dos PDF
// unificados, uno por tipo. El archivo vive en storage/empleados/.
const TIPOS = Object.freeze({
    documentacion_empleado: 'Documentación del empleado',
    contrato_anexos: 'Contrato y anexos'
});

class EmpleadoDocumento {
    static esTipoValido(tipo) {
        return Object.prototype.hasOwnProperty.call(TIPOS, tipo);
    }

    // Los dos tipos, con su archivo si ya se cargó (sin el nombre en disco).
    static async getByEmpleado(usersCompanyId) {
        const [rows] = await db.query(
            `SELECT tipo, nombre_original, mime, tamano, updated_at AS cargado_en
             FROM empleado_documento WHERE users_company_id = ?`,
            [usersCompanyId]
        );
        return Object.entries(TIPOS).map(([tipo, nombre]) => {
            const cargado = rows.find((r) => r.tipo === tipo);
            return cargado ? { tipo, nombre, cargado: true, ...cargado } : { tipo, nombre, cargado: false };
        });
    }

    static async get(usersCompanyId, tipo) {
        const [rows] = await db.query(
            'SELECT * FROM empleado_documento WHERE users_company_id = ? AND tipo = ?',
            [usersCompanyId, tipo]
        );
        return rows[0];
    }

    // Guarda (o reemplaza) el archivo. Devuelve el nombre del archivo anterior, si había,
    // para que el controller lo borre del disco después del commit.
    static async guardar(usersCompanyId, tipo, archivo, userId) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [previo] = await conn.query(
                'SELECT archivo FROM empleado_documento WHERE users_company_id = ? AND tipo = ? FOR UPDATE',
                [usersCompanyId, tipo]
            );
            await conn.query(
                `INSERT INTO empleado_documento
                    (users_company_id, tipo, archivo, nombre_original, mime, tamano, subido_por_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE archivo = VALUES(archivo), nombre_original = VALUES(nombre_original),
                    mime = VALUES(mime), tamano = VALUES(tamano), subido_por_user_id = VALUES(subido_por_user_id)`,
                [usersCompanyId, tipo, archivo.nombre, archivo.nombreOriginal, archivo.mime, archivo.tamano, userId ?? null]
            );
            await conn.commit();
            return previo[0]?.archivo || null;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // Devuelve el nombre del archivo borrado (o null si no había) para quitarlo del disco.
    static async eliminar(usersCompanyId, tipo) {
        const actual = await EmpleadoDocumento.get(usersCompanyId, tipo);
        if (!actual) return null;
        await db.query('DELETE FROM empleado_documento WHERE idempleado_documento = ?', [actual.idempleado_documento]);
        return actual.archivo;
    }

    // Archivos del empleado, para borrarlos del disco al eliminarlo (las filas caen por CASCADE).
    static async archivosDeEmpleado(usersCompanyId) {
        const [rows] = await db.query('SELECT archivo FROM empleado_documento WHERE users_company_id = ?', [usersCompanyId]);
        return rows.map((r) => r.archivo);
    }
}

EmpleadoDocumento.TIPOS = TIPOS;

module.exports = EmpleadoDocumento;
