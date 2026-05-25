const pool = require('../config/db');

class Diseno {
    static async getAll(filters = {}) {
        let query = `
            SELECT d.*,
                   us.full_name AS solicitante_nombre,
                   ud.full_name AS disenador_nombre,
                   JSON_ARRAYAGG(
                       IF(di.filename IS NOT NULL,
                          JSON_OBJECT('id', di.id, 'filename', di.filename),
                          NULL)
                   ) AS imagenes,
                   (SELECT COUNT(*) FROM diseno_entregas WHERE diseno_id = d.id) AS entregas_count
            FROM disenos d
            LEFT JOIN users us ON d.solicitante_id = us.id
            LEFT JOIN users ud ON d.disenador_id = ud.id
            LEFT JOIN diseno_imagenes di ON di.diseno_id = d.id
        `;
        const params = [];
        const conditions = [];

        if (filters.estado) {
            conditions.push('d.estado = ?');
            params.push(filters.estado);
        }
        if (filters.solicitante_id) {
            conditions.push('d.solicitante_id = ?');
            params.push(filters.solicitante_id);
        }
        if (filters.disenador_id) {
            conditions.push('d.disenador_id = ?');
            params.push(filters.disenador_id);
        }
        if (filters.fecha_desde) {
            conditions.push('DATE(d.created_at) >= ?');
            params.push(filters.fecha_desde);
        }
        if (filters.fecha_hasta) {
            conditions.push('DATE(d.created_at) <= ?');
            params.push(filters.fecha_hasta);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' GROUP BY d.id ORDER BY d.created_at DESC';

        const [rows] = await pool.query(query, params);
        return rows.map(r => ({
            ...r,
            imagenes: (r.imagenes || []).filter(Boolean)
        }));
    }

    static async getById(id) {
        const [rows] = await pool.query(
            `SELECT d.*,
                    us.full_name AS solicitante_nombre,
                    ud.full_name AS disenador_nombre,
                    JSON_ARRAYAGG(
                        IF(di.filename IS NOT NULL,
                           JSON_OBJECT('id', di.id, 'filename', di.filename),
                           NULL)
                    ) AS imagenes
             FROM disenos d
             LEFT JOIN users us ON d.solicitante_id = us.id
             LEFT JOIN users ud ON d.disenador_id = ud.id
             LEFT JOIN diseno_imagenes di ON di.diseno_id = d.id
             WHERE d.id = ?
             GROUP BY d.id`,
            [id]
        );
        if (!rows[0]) return null;
        const [entregas] = await pool.query(
            'SELECT id, filename, original_name, mimetype, size, uploaded_at FROM diseno_entregas WHERE diseno_id = ? ORDER BY uploaded_at ASC',
            [id]
        );
        return {
            ...rows[0],
            imagenes: (rows[0].imagenes || []).filter(Boolean),
            entregas
        };
    }

    static async create({ nombre, descripcion, solicitante_id }) {
        const [result] = await pool.query(
            'INSERT INTO disenos (nombre, descripcion, solicitante_id) VALUES (?, ?, ?)',
            [nombre, descripcion, solicitante_id]
        );
        return result.insertId;
    }

    static async addImagenes(diseno_id, filenames) {
        if (!filenames || filenames.length === 0) return;
        const values = filenames.map(f => [diseno_id, f]);
        await pool.query('INSERT INTO diseno_imagenes (diseno_id, filename) VALUES ?', [values]);
    }

    static async deleteImagen(id) {
        const [rows] = await pool.query('SELECT filename FROM diseno_imagenes WHERE id = ?', [id]);
        if (!rows[0]) return null;
        await pool.query('DELETE FROM diseno_imagenes WHERE id = ?', [id]);
        return rows[0].filename;
    }

    static async assign(id, disenador_id) {
        await pool.query(
            "UPDATE disenos SET disenador_id = ?, estado = 'en_progreso', updated_at = NOW() WHERE id = ?",
            [disenador_id, id]
        );
    }

    static async setFechaEstimada(id, fecha_estimada) {
        const fechaMysql = fecha_estimada
            ? new Date(fecha_estimada).toISOString().slice(0, 19).replace('T', ' ')
            : null;
        await pool.query(
            'UPDATE disenos SET fecha_estimada = ?, updated_at = NOW() WHERE id = ?',
            [fechaMysql, id]
        );
    }

    static async markCompleted(id) {
        await pool.query(
            "UPDATE disenos SET estado = 'completado', devolucion_nota = NULL, devuelto_at = NULL, updated_at = NOW() WHERE id = ?",
            [id]
        );
    }

    static async toggleEspera(id, currentEstado) {
        const newEstado = currentEstado === 'en_espera' ? 'en_progreso' : 'en_espera';
        await pool.query(
            'UPDATE disenos SET estado = ?, updated_at = NOW() WHERE id = ?',
            [newEstado, id]
        );
        return newEstado;
    }

    static async returnDiseno(id, nota) {
        await pool.query(
            "UPDATE disenos SET estado = 'devuelto', devolucion_nota = ?, devuelto_at = NOW(), updated_at = NOW() WHERE id = ?",
            [nota, id]
        );
    }

    static async createDevolucion(diseno_id, nota, solicitante_id, numero_devolucion) {
        await pool.query(
            'INSERT INTO diseno_devoluciones (diseno_id, nota, solicitante_id, numero_devolucion) VALUES (?, ?, ?, ?)',
            [diseno_id, nota, solicitante_id, numero_devolucion]
        );
    }

    static async countDevoluciones(diseno_id) {
        const [[{ total }]] = await pool.query(
            'SELECT COUNT(*) AS total FROM diseno_devoluciones WHERE diseno_id = ?',
            [diseno_id]
        );
        return total;
    }

    static async getDevoluciones(diseno_id) {
        const [rows] = await pool.query(
            `SELECT dd.id, dd.nota, dd.numero_devolucion, dd.created_at,
                    u.full_name AS solicitante_nombre
             FROM diseno_devoluciones dd
             JOIN users u ON dd.solicitante_id = u.id
             WHERE dd.diseno_id = ?
             ORDER BY dd.numero_devolucion ASC`,
            [diseno_id]
        );
        return rows;
    }

    static async replaceImagenes(diseno_id, newFilenames) {
        const [old] = await pool.query('SELECT filename FROM diseno_imagenes WHERE diseno_id = ?', [diseno_id]);
        await pool.query('DELETE FROM diseno_imagenes WHERE diseno_id = ?', [diseno_id]);
        if (newFilenames && newFilenames.length > 0) {
            const values = newFilenames.map(f => [diseno_id, f]);
            await pool.query('INSERT INTO diseno_imagenes (diseno_id, filename) VALUES ?', [values]);
        }
        return old.map(o => o.filename);
    }

    static async replaceEntregas(diseno_id, newFiles) {
        const [old] = await pool.query('SELECT filename FROM diseno_entregas WHERE diseno_id = ?', [diseno_id]);
        await pool.query('DELETE FROM diseno_entregas WHERE diseno_id = ?', [diseno_id]);
        if (newFiles && newFiles.length > 0) {
            const values = newFiles.map(f => [diseno_id, f.filename, f.original_name, f.mimetype, f.size]);
            await pool.query(
                'INSERT INTO diseno_entregas (diseno_id, filename, original_name, mimetype, size) VALUES ?',
                [values]
            );
        }
        return old.map(o => o.filename);
    }

    static async update(id, { nombre, descripcion }) {
        await pool.query(
            'UPDATE disenos SET nombre = ?, descripcion = ?, updated_at = NOW() WHERE id = ?',
            [nombre, descripcion, id]
        );
    }

    static async delete(id) {
        const [imagenes] = await pool.query('SELECT filename FROM diseno_imagenes WHERE diseno_id = ?', [id]);
        await pool.query('DELETE FROM disenos WHERE id = ?', [id]);
        return imagenes.map(i => i.filename);
    }

    static async getForEntregasDownload(id) {
        const [[row]] = await pool.query(
            'SELECT id, nombre, solicitante_id, disenador_id FROM disenos WHERE id = ?',
            [id]
        );
        if (!row) return null;
        const [entregas] = await pool.query(
            'SELECT id, filename, original_name FROM diseno_entregas WHERE diseno_id = ? ORDER BY uploaded_at ASC',
            [id]
        );
        return { ...row, entregas };
    }

    static async getForDownload(id) {
        const [[row]] = await pool.query(
            'SELECT id, nombre, solicitante_id, disenador_id FROM disenos WHERE id = ?',
            [id]
        );
        if (!row) return null;
        const [imagenes] = await pool.query(
            'SELECT id, filename FROM diseno_imagenes WHERE diseno_id = ? ORDER BY id ASC',
            [id]
        );
        return { ...row, imagenes };
    }

    static async addEntregas(diseno_id, files) {
        if (!files || files.length === 0) return;
        const values = files.map(f => [diseno_id, f.filename, f.original_name, f.mimetype, f.size]);
        await pool.query(
            'INSERT INTO diseno_entregas (diseno_id, filename, original_name, mimetype, size) VALUES ?',
            [values]
        );
    }

    static async deleteEntrega(id) {
        const [rows] = await pool.query('SELECT filename FROM diseno_entregas WHERE id = ?', [id]);
        if (!rows[0]) return null;
        await pool.query('DELETE FROM diseno_entregas WHERE id = ?', [id]);
        return rows[0].filename;
    }

    static async getDisenadores() {
        const [rows] = await pool.query(
            "SELECT id, full_name FROM users WHERE role = 'disenador' ORDER BY full_name"
        );
        return rows;
    }
}

module.exports = Diseno;
