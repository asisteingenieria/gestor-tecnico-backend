const db = require('../config/db');

class Agente {
    static async getAll() {
        const [rows] = await db.query(`
            SELECT
                ag.*,
                COUNT(a.id) AS total_activos
            FROM agentes ag
            LEFT JOIN activos a ON a.agente_id = ag.id
            GROUP BY ag.id
            ORDER BY ag.apellidos ASC, ag.nombres ASC
        `);
        return rows;
    }

    static async getById(id) {
        const [rows] = await db.query(`
            SELECT
                ag.*,
                COUNT(a.id) AS total_activos
            FROM agentes ag
            LEFT JOIN activos a ON a.agente_id = ag.id
            WHERE ag.id = ?
            GROUP BY ag.id
        `, [id]);
        return rows[0];
    }

    static async create(data) {
        const { cedula, nombres, apellidos, campana } = data;

        const [existing] = await db.query('SELECT id FROM agentes WHERE cedula = ?', [cedula]);
        if (existing.length > 0) {
            throw new Error(`Ya existe un agente con la cédula '${cedula}'`);
        }

        const [result] = await db.query(
            'INSERT INTO agentes (cedula, nombres, apellidos, campana) VALUES (?, ?, ?, ?)',
            [cedula, nombres, apellidos, campana]
        );
        return { id: result.insertId, ...data };
    }

    static async update(id, data) {
        const { cedula, nombres, apellidos, campana } = data;

        const [existing] = await db.query('SELECT id FROM agentes WHERE cedula = ? AND id != ?', [cedula, id]);
        if (existing.length > 0) {
            throw new Error(`Ya existe otro agente con la cédula '${cedula}'`);
        }

        const [result] = await db.query(
            'UPDATE agentes SET cedula = ?, nombres = ?, apellidos = ?, campana = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [cedula, nombres, apellidos, campana, id]
        );
        return result.affectedRows > 0;
    }

    static async delete(id) {
        // ON DELETE SET NULL en activos.agente_id -> los activos quedan sin agente asignado
        const [result] = await db.query('DELETE FROM agentes WHERE id = ?', [id]);
        return result.affectedRows > 0;
    }

    static async getActivos(agenteId) {
        const [rows] = await db.query(`
            SELECT
                a.*,
                u.full_name AS created_by_name
            FROM activos a
            LEFT JOIN users u ON a.created_by_id = u.id
            WHERE a.agente_id = ?
            ORDER BY a.created_at DESC
        `, [agenteId]);
        return rows;
    }
}

module.exports = Agente;
