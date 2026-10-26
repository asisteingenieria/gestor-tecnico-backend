const db = require('../config/db');

const SELECT_NOVEDAD = `
    SELECT
        nr.*,
        tn.nombre AS tipo_novedad_nombre,
        tn.categoria AS tipo_novedad_categoria,
        uc.id AS empleado_id,
        CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido) AS empleado_nombre,
        uc.numero_identificacion AS empleado_identificacion,
        car.nombre AS cargo_nombre,
        cam.nombre AS campania_nombre,
        cc.nombre AS centro_costo_nombre,
        CONCAT_WS(' ', resp.primer_nombre, resp.segundo_nombre, resp.primer_apellido, resp.segundo_apellido) AS responsable_nombre,
        (SELECT COUNT(*) FROM tipo_novedad_soporte tns WHERE tns.tipo_novedad_id = nr.tipo_novedad_idtipo_novedad) AS soportes_requeridos,
        (SELECT COUNT(*) FROM novedad_rrhh_soporte nrs
           JOIN tipo_novedad_soporte tns ON tns.tipo_soporte_novedad_id = nrs.tipo_soporte_novedad_id
                                        AND tns.tipo_novedad_id = nr.tipo_novedad_idtipo_novedad
          WHERE nrs.novedad_rrhh_id = nr.idnovedad_rrhh) AS soportes_cargados
    FROM novedad_rrhh nr
    JOIN contrato c ON nr.contrato_idcontrato = c.idcontrato
    JOIN users_company uc ON c.users_company_id = uc.id
    JOIN tipo_novedad tn ON nr.tipo_novedad_idtipo_novedad = tn.idtipo_novedad
    LEFT JOIN cargo car ON c.cargo_idcargo = car.idcargo
    LEFT JOIN campania cam ON c.campania_idcampania = cam.idcampania
    LEFT JOIN centro_costo cc ON c.centro_costo_idcentro_costo = cc.idcentro_costo
    LEFT JOIN users_company resp ON nr.responsable_id = resp.id
`;

function val(x) {
    return x === undefined || x === null || x === '' ? null : x;
}

class NovedadRrhh {
    static async getAll(filters = {}) {
        const where = [];
        const params = [];

        if (filters.contrato_id) {
            where.push('nr.contrato_idcontrato = ?');
            params.push(filters.contrato_id);
        }
        if (filters.tipo_novedad_id) {
            where.push('nr.tipo_novedad_idtipo_novedad = ?');
            params.push(filters.tipo_novedad_id);
        }
        if (filters.desde) {
            where.push('nr.fecha_inicial >= ?');
            params.push(filters.desde);
        }
        if (filters.hasta) {
            where.push('nr.fecha_inicial <= ?');
            params.push(filters.hasta);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [rows] = await db.query(
            `${SELECT_NOVEDAD} ${whereSql} ORDER BY nr.fecha_inicial DESC`,
            params
        );
        return rows;
    }

    static async getById(id) {
        const [rows] = await db.query(`${SELECT_NOVEDAD} WHERE nr.idnovedad_rrhh = ?`, [id]);
        return rows[0];
    }

    static async create(data) {
        const [result] = await db.query(
            `INSERT INTO novedad_rrhh (
                accidente_transito, fecha_inicial, fecha_final, fecha_retorno, total_dias,
                resumen_diagnostico, origen_incapacidad, observaciones, fecha_recibido, fecha_reporte,
                tiene_documento_original, tiene_copia_documento, tiene_historia_clinica,
                tiene_runt, tiene_furips, tiene_soat,
                tipo_novedad_idtipo_novedad, contrato_idcontrato, responsable_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                data.accidente_transito ? 1 : 0, data.fecha_inicial, val(data.fecha_final),
                val(data.fecha_retorno), val(data.total_dias),
                val(data.resumen_diagnostico), val(data.origen_incapacidad), val(data.observaciones),
                val(data.fecha_recibido), val(data.fecha_reporte),
                data.tiene_documento_original ? 1 : 0, data.tiene_copia_documento ? 1 : 0,
                data.tiene_historia_clinica ? 1 : 0, data.tiene_runt ? 1 : 0,
                data.tiene_furips ? 1 : 0, data.tiene_soat ? 1 : 0,
                data.tipo_novedad_id, data.contrato_id, val(data.responsable_id)
            ]
        );
        return { id: result.insertId, ...data };
    }

    static async update(id, data) {
        const [result] = await db.query(
            `UPDATE novedad_rrhh SET
                accidente_transito = ?, fecha_inicial = ?, fecha_final = ?, fecha_retorno = ?, total_dias = ?,
                resumen_diagnostico = ?, origen_incapacidad = ?, observaciones = ?, fecha_recibido = ?, fecha_reporte = ?,
                tiene_documento_original = ?, tiene_copia_documento = ?, tiene_historia_clinica = ?,
                tiene_runt = ?, tiene_furips = ?, tiene_soat = ?,
                tipo_novedad_idtipo_novedad = ?, contrato_idcontrato = ?, responsable_id = ?,
                updated_at = CURRENT_TIMESTAMP
             WHERE idnovedad_rrhh = ?`,
            [
                data.accidente_transito ? 1 : 0, data.fecha_inicial, val(data.fecha_final),
                val(data.fecha_retorno), val(data.total_dias),
                val(data.resumen_diagnostico), val(data.origen_incapacidad), val(data.observaciones),
                val(data.fecha_recibido), val(data.fecha_reporte),
                data.tiene_documento_original ? 1 : 0, data.tiene_copia_documento ? 1 : 0,
                data.tiene_historia_clinica ? 1 : 0, data.tiene_runt ? 1 : 0,
                data.tiene_furips ? 1 : 0, data.tiene_soat ? 1 : 0,
                data.tipo_novedad_id, data.contrato_id, val(data.responsable_id),
                id
            ]
        );
        return result.affectedRows > 0;
    }

    static async delete(id) {
        const [result] = await db.query('DELETE FROM novedad_rrhh WHERE idnovedad_rrhh = ?', [id]);
        return result.affectedRows > 0;
    }

    // ---- Soportes documentales (migración 069) ----

    // Los soportes que aplican al tipo de la novedad (hoja "Novedades"), con su archivo si ya
    // se cargó, más los cargados que ya no aplican (si se cambió el tipo) con `aplica = 0`.
    static async getSoportes(novedadId) {
        const [rows] = await db.query(
            `SELECT s.idtipo_soporte_novedad AS tipo_soporte_id, s.nombre, s.orden,
                    (tns.tipo_novedad_id IS NOT NULL) AS aplica,
                    nrs.idnovedad_rrhh_soporte AS id, nrs.nombre_original, nrs.mime, nrs.tamano, nrs.updated_at AS cargado_en
             FROM novedad_rrhh nr
             JOIN tipo_soporte_novedad s
             LEFT JOIN tipo_novedad_soporte tns
                    ON tns.tipo_novedad_id = nr.tipo_novedad_idtipo_novedad AND tns.tipo_soporte_novedad_id = s.idtipo_soporte_novedad
             LEFT JOIN novedad_rrhh_soporte nrs
                    ON nrs.novedad_rrhh_id = nr.idnovedad_rrhh AND nrs.tipo_soporte_novedad_id = s.idtipo_soporte_novedad
             WHERE nr.idnovedad_rrhh = ? AND (tns.tipo_novedad_id IS NOT NULL OR nrs.idnovedad_rrhh_soporte IS NOT NULL)
             ORDER BY aplica DESC, s.orden`,
            [novedadId]
        );
        return rows;
    }

    static async soporteAplica(novedadId, tipoSoporteId) {
        const [rows] = await db.query(
            `SELECT 1 FROM novedad_rrhh nr
             JOIN tipo_novedad_soporte tns ON tns.tipo_novedad_id = nr.tipo_novedad_idtipo_novedad
             WHERE nr.idnovedad_rrhh = ? AND tns.tipo_soporte_novedad_id = ?`,
            [novedadId, tipoSoporteId]
        );
        return rows.length > 0;
    }

    static async getSoporte(novedadId, tipoSoporteId) {
        const [rows] = await db.query(
            'SELECT * FROM novedad_rrhh_soporte WHERE novedad_rrhh_id = ? AND tipo_soporte_novedad_id = ?',
            [novedadId, tipoSoporteId]
        );
        return rows[0];
    }

    // Guarda (o reemplaza) el archivo de un soporte. Devuelve el nombre del archivo anterior,
    // si había, para que el controller lo borre del disco después del commit.
    static async guardarSoporte(novedadId, tipoSoporteId, archivo, userId) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [previo] = await conn.query(
                'SELECT archivo FROM novedad_rrhh_soporte WHERE novedad_rrhh_id = ? AND tipo_soporte_novedad_id = ? FOR UPDATE',
                [novedadId, tipoSoporteId]
            );
            await conn.query(
                `INSERT INTO novedad_rrhh_soporte
                    (novedad_rrhh_id, tipo_soporte_novedad_id, archivo, nombre_original, mime, tamano, subido_por_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE archivo = VALUES(archivo), nombre_original = VALUES(nombre_original),
                    mime = VALUES(mime), tamano = VALUES(tamano), subido_por_user_id = VALUES(subido_por_user_id)`,
                [novedadId, tipoSoporteId, archivo.nombre, archivo.nombreOriginal, archivo.mime, archivo.tamano, userId ?? null]
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
    static async eliminarSoporte(novedadId, tipoSoporteId) {
        const actual = await NovedadRrhh.getSoporte(novedadId, tipoSoporteId);
        if (!actual) return null;
        await db.query('DELETE FROM novedad_rrhh_soporte WHERE idnovedad_rrhh_soporte = ?', [actual.idnovedad_rrhh_soporte]);
        return actual.archivo;
    }

    // Archivos de una novedad, para borrarlos del disco al eliminarla (las filas caen por CASCADE).
    static async archivosDeNovedad(novedadId) {
        const [rows] = await db.query('SELECT archivo FROM novedad_rrhh_soporte WHERE novedad_rrhh_id = ?', [novedadId]);
        return rows.map(r => r.archivo);
    }

    // Archivos de todas las novedades de un empleado, para borrarlos del disco al eliminar su ficha.
    static async archivosDeEmpleado(ucId) {
        const [rows] = await db.query(
            `SELECT nrs.archivo FROM novedad_rrhh_soporte nrs
             JOIN novedad_rrhh nr ON nrs.novedad_rrhh_id = nr.idnovedad_rrhh
             JOIN contrato c ON nr.contrato_idcontrato = c.idcontrato
             WHERE c.users_company_id = ?`,
            [ucId]
        );
        return rows.map(r => r.archivo);
    }
}

module.exports = NovedadRrhh;
