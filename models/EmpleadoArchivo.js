const db = require('../config/db');
const { CATEGORIAS } = require('../utils/expedientes');

// Archivos del expediente documental del empleado (migración 097). El archivo vive en
// storage/expedientes/<ruta>; aquí solo su registro.
const CATEGORIAS_VALIDAS = [...CATEGORIAS.map(c => c.clave), 'otros'];

class EmpleadoArchivo {
    static esCategoriaValida(categoria) {
        return CATEGORIAS_VALIDAS.includes(categoria);
    }

    /** La carpeta del expediente del empleado ("<año>/<NOMBRE>") o null si todavía no tiene. */
    static async carpetaDe(usersCompanyId, conn = db) {
        const [rows] = await conn.query('SELECT expediente_carpeta FROM users_company WHERE id = ?', [usersCompanyId]);
        return rows[0]?.expediente_carpeta || null;
    }

    /** Fija la carpeta solo si el empleado todavía no tiene una. Devuelve la carpeta vigente. */
    static async fijarCarpetaSiFalta(usersCompanyId, carpeta, conn = db) {
        await conn.query(
            'UPDATE users_company SET expediente_carpeta = ? WHERE id = ? AND expediente_carpeta IS NULL',
            [carpeta, usersCompanyId]
        );
        return EmpleadoArchivo.carpetaDe(usersCompanyId, conn);
    }

    /** Expediente agrupado por categoría, en el orden de las carpetas (OTROS al final, si tiene algo). */
    static async getExpediente(usersCompanyId) {
        const [rows] = await db.query(
            `SELECT idempleado_archivo AS id, categoria, subcarpeta, nombre, mime, tamano, origen, created_at
             FROM empleado_archivo WHERE users_company_id = ?
             ORDER BY subcarpeta IS NOT NULL, subcarpeta, nombre`,
            [usersCompanyId]
        );
        const categorias = CATEGORIAS.map(c => ({ ...c, archivos: rows.filter(r => r.categoria === c.clave) }));
        const otros = rows.filter(r => r.categoria === 'otros');
        if (otros.length) categorias.push({ clave: 'otros', carpeta: 'OTROS', nombre: 'Otros', archivos: otros });
        return { carpeta: await EmpleadoArchivo.carpetaDe(usersCompanyId), total: rows.length, categorias };
    }

    static async get(usersCompanyId, archivoId) {
        const [rows] = await db.query(
            'SELECT * FROM empleado_archivo WHERE idempleado_archivo = ? AND users_company_id = ?',
            [archivoId, usersCompanyId]
        );
        return rows[0];
    }

    /** Registra un archivo. Con `ignorarRepetido`, una ruta ya registrada no es error (re-ejecutar la copia). */
    static async registrar(a, { ignorarRepetido = false, conn = db } = {}) {
        const [res] = await conn.query(
            `INSERT ${ignorarRepetido ? 'IGNORE' : ''} INTO empleado_archivo
                (users_company_id, categoria, subcarpeta, nombre, ruta, mime, tamano, sha256, origen, subido_por_user_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [a.usersCompanyId, a.categoria, a.subcarpeta || null, a.nombre, a.ruta, a.mime, a.tamano,
                a.sha256 || null, a.origen || 'sistema', a.subidoPor ?? null]
        );
        return res.affectedRows === 1 ? res.insertId : null;
    }

    static async eliminar(usersCompanyId, archivoId) {
        const actual = await EmpleadoArchivo.get(usersCompanyId, archivoId);
        if (!actual) return null;
        await db.query('DELETE FROM empleado_archivo WHERE idempleado_archivo = ?', [archivoId]);
        return actual;
    }

    static async rutasDeEmpleado(usersCompanyId) {
        const [rows] = await db.query('SELECT ruta FROM empleado_archivo WHERE users_company_id = ?', [usersCompanyId]);
        return rows.map(r => r.ruta);
    }
}

EmpleadoArchivo.CATEGORIAS_VALIDAS = CATEGORIAS_VALIDAS;

module.exports = EmpleadoArchivo;
