const db = require('../config/db');

const SELECT_RETIRO = `
    SELECT
        r.*,
        tr.nombre AS tipo_retiro_nombre,
        c.users_company_id
    FROM retiro r
    JOIN tipo_retiro tr ON r.tipo_retiro_idtipo_retiro = tr.idtipo_retiro
    JOIN contrato c ON r.contrato_idcontrato = c.idcontrato
`;

function val(x) {
    return x === undefined || x === null || x === '' ? null : x;
}

class Retiro {
    static async getByUserCompanyId(ucId) {
        const [rows] = await db.query(
            `${SELECT_RETIRO} WHERE c.users_company_id = ? ORDER BY r.idretiro DESC LIMIT 1`,
            [ucId]
        );
        return rows[0] || null;
    }

    // Crea el retiro sobre el contrato vigente del empleado, lo pasa a estado
    // "retirado" y, si se confirma la entrega de equipo, libera los recursos que
    // tuviera asignados (diadema/locker/carnet) — reutiliza asignacion_recurso
    // (migración 039) en vez de duplicar el dato "Serial Diadema" del Excel.
    static async registrar(ucId, data) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [contratos] = await conn.query(
                'SELECT idcontrato FROM contrato WHERE users_company_id = ? ORDER BY idcontrato DESC LIMIT 1',
                [ucId]
            );
            if (contratos.length === 0) throw new Error('El empleado no tiene contrato registrado');
            const contratoId = contratos[0].idcontrato;

            const [existentes] = await conn.query('SELECT idretiro FROM retiro WHERE contrato_idcontrato = ?', [contratoId]);
            if (existentes.length > 0) throw new Error('Este empleado ya tiene un retiro registrado');

            const [estadoRetirado] = await conn.query("SELECT idestado_contrato FROM estado_contrato WHERE nombre = 'retirado'");
            if (estadoRetirado.length === 0) throw new Error("No existe el estado de contrato 'retirado' (ejecutar migración 035)");

            await conn.query(
                `INSERT INTO retiro (
                    fecha_retiro, fecha_ultima_conexion, fecha_entrega_certificacion, equipo_entregado,
                    tipo_retiro_idtipo_retiro, motivo_retiro, justificacion, contrato_idcontrato
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    data.fecha_retiro, val(data.fecha_ultima_conexion), val(data.fecha_entrega_certificacion),
                    data.equipo_entregado ? 1 : 0, data.tipo_retiro_id, val(data.motivo_retiro), val(data.justificacion),
                    contratoId
                ]
            );

            await conn.query(
                'UPDATE contrato SET estado_contrato_idestado_contrato = ?, updated_at = CURRENT_TIMESTAMP WHERE idcontrato = ?',
                [estadoRetirado[0].idestado_contrato, contratoId]
            );

            if (data.equipo_entregado) {
                await conn.query(
                    'UPDATE asignacion_recurso SET activa = 0 WHERE users_company_id = ? AND activa = 1',
                    [ucId]
                );
            }

            await conn.commit();
            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async actualizar(ucId, data) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [rows] = await conn.query(
                `SELECT r.idretiro, r.equipo_entregado AS equipo_entregado_anterior
                 FROM retiro r JOIN contrato c ON r.contrato_idcontrato = c.idcontrato
                 WHERE c.users_company_id = ? ORDER BY r.idretiro DESC LIMIT 1`,
                [ucId]
            );
            if (rows.length === 0) throw new Error('Este empleado no tiene un retiro registrado');

            await conn.query(
                `UPDATE retiro SET
                    fecha_retiro = ?, fecha_ultima_conexion = ?, fecha_entrega_certificacion = ?,
                    equipo_entregado = ?, tipo_retiro_idtipo_retiro = ?, motivo_retiro = ?, justificacion = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE idretiro = ?`,
                [
                    data.fecha_retiro, val(data.fecha_ultima_conexion), val(data.fecha_entrega_certificacion),
                    data.equipo_entregado ? 1 : 0, data.tipo_retiro_id, val(data.motivo_retiro), val(data.justificacion),
                    rows[0].idretiro
                ]
            );

            if (data.equipo_entregado && !rows[0].equipo_entregado_anterior) {
                await conn.query(
                    'UPDATE asignacion_recurso SET activa = 0 WHERE users_company_id = ? AND activa = 1',
                    [ucId]
                );
            }

            await conn.commit();
            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // Deshace el retiro: borra el registro y vuelve el contrato a "activo". No
    // reactiva recursos que se hayan liberado al registrar el retiro (habría que
    // volver a asignarlos a mano, la desasignación no se revierte sola).
    static async reactivar(ucId) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [contratos] = await conn.query(
                'SELECT idcontrato FROM contrato WHERE users_company_id = ? ORDER BY idcontrato DESC LIMIT 1',
                [ucId]
            );
            if (contratos.length === 0) throw new Error('El empleado no tiene contrato registrado');
            const contratoId = contratos[0].idcontrato;

            const [result] = await conn.query('DELETE FROM retiro WHERE contrato_idcontrato = ?', [contratoId]);
            if (result.affectedRows === 0) throw new Error('Este empleado no tiene un retiro registrado');

            const [estadoActivo] = await conn.query("SELECT idestado_contrato FROM estado_contrato WHERE nombre = 'activo'");
            if (estadoActivo.length === 0) throw new Error("No existe el estado de contrato 'activo' (ejecutar migración 035)");

            await conn.query(
                'UPDATE contrato SET estado_contrato_idestado_contrato = ?, updated_at = CURRENT_TIMESTAMP WHERE idcontrato = ?',
                [estadoActivo[0].idestado_contrato, contratoId]
            );

            await conn.commit();
            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

module.exports = Retiro;
