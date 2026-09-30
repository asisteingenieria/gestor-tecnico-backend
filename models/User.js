const db = require('../config/db');
const bcrypt = require('bcryptjs');

class User {
    static async getAll() {
        try {
            const [rows] = await db.query(
                'SELECT id, username, full_name, role, sede, departamento, users_company_id, created_at FROM users WHERE role != ? ORDER BY full_name',
                ['anonimo']
            );
            return rows;
        } catch (error) {
            throw error;
        }
    }

    static async getById(id) {
        try {
            const [rows] = await db.query(
                'SELECT id, username, full_name, role, sede, departamento, users_company_id, created_at FROM users WHERE id = ?',
                [id]
            );
            return rows[0];
        } catch (error) {
            throw error;
        }
    }

    static async getByUsername(username) {
        try {
            const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
            return rows[0];
        } catch (error) {
            throw error;
        }
    }

    // Usuario (login) ya vinculado a una ficha de RRHH, si existe. `excludeUserId` permite
    // ignorar al propio usuario al editar (no chocar consigo mismo).
    static async getByUsersCompanyId(usersCompanyId, excludeUserId = null) {
        try {
            const params = [usersCompanyId];
            let query = 'SELECT id, username, full_name FROM users WHERE users_company_id = ?';
            if (excludeUserId) {
                query += ' AND id != ?';
                params.push(excludeUserId);
            }
            const [rows] = await db.query(query, params);
            return rows[0] || null;
        } catch (error) {
            throw error;
        }
    }

    static async getTechnicians() {
        try {
            const [rows] = await db.query(
                'SELECT id, username, full_name, sede, departamento FROM users WHERE role = "technician" ORDER BY full_name'
            );
            return rows;
        } catch (error) {
            throw error;
        }
    }

    static async getTechniciansBySede(sede) {
        try {
            const [rows] = await db.query(
                'SELECT id, username, full_name, sede, departamento FROM users WHERE role = "technician" AND sede = ? ORDER BY full_name',
                [sede]
            );
            return rows;
        } catch (error) {
            throw error;
        }
    }

    static async getAvailableTechniciansForIncident(incidentSede) {
        try {
            // Lógica de visibilidad:
            // - Técnicos de Bogotá: ven Bogotá y Barranquilla
            // - Barranquilla no tiene técnicos propios

            let query;
            let params;

            if (incidentSede === 'barranquilla') {
                // Para Barranquilla, pueden ayudar técnicos de Bogotá
                query = `
                    SELECT id, username, full_name, sede, departamento
                    FROM users
                    WHERE role = "technician" AND sede = "bogota"
                    ORDER BY full_name
                `;
                params = [];
            } else {
                // Para Bogotá, solo técnicos de la misma sede
                query = `
                    SELECT id, username, full_name, sede, departamento 
                    FROM users 
                    WHERE role = "technician" AND sede = ?
                    ORDER BY full_name
                `;
                params = [incidentSede];
            }
            
            const [rows] = await db.query(query, params);
            return rows;
        } catch (error) {
            throw error;
        }
    }

    static async create(userData) {
        try {
            const { username, password, full_name, role, sede, departamento, users_company_id } = userData;

            // Hash de la contraseña
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Construir query dinámicamente según los campos presentes
            let fields = ['username', 'password', 'full_name', 'role'];
            let values = [username, hashedPassword, full_name, role];
            let placeholders = ['?', '?', '?', '?'];

            if (sede) {
                fields.push('sede');
                values.push(sede);
                placeholders.push('?');
            }

            if (departamento) {
                fields.push('departamento');
                values.push(departamento);
                placeholders.push('?');
            }

            if (users_company_id) {
                fields.push('users_company_id');
                values.push(users_company_id);
                placeholders.push('?');
            }

            const query = `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
            const [result] = await db.query(query, values);

            return { id: result.insertId, username, full_name, role, sede, departamento, users_company_id };
        } catch (error) {
            throw error;
        }
    }

    static async update(id, userData) {
        try {
            const { username, full_name, role, sede, departamento, users_company_id } = userData;

            // Construir query dinámicamente según los campos presentes
            let updates = ['username = ?', 'full_name = ?', 'role = ?'];
            let values = [username, full_name, role];

            if (sede) {
                updates.push('sede = ?');
                values.push(sede);
            }

            if (departamento !== undefined) { // Permitir actualizar incluso si es null
                updates.push('departamento = ?');
                values.push(departamento);
            }

            if (users_company_id !== undefined) { // Permitir desvincular (null)
                updates.push('users_company_id = ?');
                values.push(users_company_id);
            }

            values.push(id); // ID va al final para la cláusula WHERE

            const query = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            const [result] = await db.query(query, values);

            return result.affectedRows > 0;
        } catch (error) {
            throw error;
        }
    }

    static async updatePassword(id, newPassword) {
        try {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, salt);
            
            const [result] = await db.query(
                'UPDATE users SET password = ? WHERE id = ?',
                [hashedPassword, id]
            );
            return result.affectedRows > 0;
        } catch (error) {
            throw error;
        }
    }

    static async delete(id) {
        try {
            const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);
            return result.affectedRows > 0;
        } catch (error) {
            throw error;
        }
    }

    static async deleteWithDependencies(id) {
        try {
            // Iniciar transacción
            await db.query('START TRANSACTION');

            // Eliminar dependencias en orden correcto para evitar errores de foreign key

            // 1. Eliminar mensajes de chat privados (como emisor y receptor)
            await db.query('DELETE FROM private_chat_messages WHERE from_user_id = ? OR to_user_id = ?', [id, id]);

            // 2. Eliminar conversaciones de chat (como usuario anónimo o admin)
            await db.query('DELETE FROM chat_conversations WHERE anonymous_user_id = ? OR admin_user_id = ?', [id, id]);

            // 3. Eliminar alertas de supervisión
            // NOTA: Esta tabla tiene ON DELETE CASCADE en la foreign key,
            // pero eliminamos manualmente para mantener control de la transacción
            await db.query('DELETE FROM supervision_alerts WHERE coordinator_id = ?', [id]);

            // 4. Eliminar calificaciones de técnicos (como técnico calificado y calificador)
            await db.query('DELETE FROM technician_ratings WHERE technician_id = ? OR rated_by_id = ?', [id, id]);

            // 5. Eliminar archivos adjuntos subidos por el usuario
            await db.query('DELETE FROM incident_attachments WHERE uploaded_by = ?', [id]);

            // 6. Eliminar historial de incidencias donde el usuario aparece
            await db.query('DELETE FROM incident_history WHERE user_id = ?', [id]);

            // 7. Eliminar todas las incidencias donde el usuario está como reported_by_id o assigned_to_id
            // Esto eliminará también automáticamente archivos adjuntos relacionados y historial restante
            await db.query('DELETE FROM incidents WHERE reported_by_id = ? OR assigned_to_id = ?', [id, id]);

            // 8. Finalmente eliminar el usuario
            const [result] = await db.query('DELETE FROM users WHERE id = ?', [id]);

            // Confirmar transacción
            await db.query('COMMIT');

            return result.affectedRows > 0;
        } catch (error) {
            // Revertir transacción en caso de error
            await db.query('ROLLBACK');
            throw error;
        }
    }

    static async validatePassword(plainPassword, hashedPassword) {
        return await bcrypt.compare(plainPassword, hashedPassword);
    }
}

module.exports = User;