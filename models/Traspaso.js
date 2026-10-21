const db = require('../config/db');

const SELECT_TRASPASO = `
    SELECT
        t.*,
        tt.codigo AS tipo_codigo,
        tt.nombre AS tipo_nombre,
        uc.id AS empleado_id,
        CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido) AS empleado_nombre,
        uc.numero_identificacion AS empleado_identificacion,
        tca.nombre AS tipo_contrato_anterior_nombre,
        cia.nombre AS ciudad_anterior_nombre,
        aa.nombre AS area_anterior_nombre,
        an.nombre AS area_nueva_nombre,
        cama.nombre AS campania_anterior_nombre,
        camn.nombre AS campania_nueva_nombre,
        cca.nombre AS centro_costo_anterior_nombre,
        ccn.nombre AS centro_costo_nuevo_nombre,
        carga.nombre AS cargo_anterior_nombre,
        cargn.nombre AS cargo_nuevo_nombre,
        moda.nombre AS modalidad_anterior_nombre,
        modal.nombre AS modalidad_nombre,
        CONCAT_WS(' ', jaa.primer_nombre, jaa.segundo_nombre, jaa.primer_apellido, jaa.segundo_apellido) AS jefe_area_anterior_nombre,
        CONCAT_WS(' ', jan.primer_nombre, jan.segundo_nombre, jan.primer_apellido, jan.segundo_apellido) AS jefe_area_nuevo_nombre,
        CONCAT_WS(' ', jia.primer_nombre, jia.segundo_nombre, jia.primer_apellido, jia.segundo_apellido) AS jefe_inmediato_anterior_nombre,
        CONCAT_WS(' ', jin.primer_nombre, jin.segundo_nombre, jin.primer_apellido, jin.segundo_apellido) AS jefe_inmediato_nuevo_nombre,
        (SELECT COUNT(*) FROM tipo_traspaso_soporte tts WHERE tts.tipo_traspaso_id = t.tipo_traspaso_id) AS soportes_requeridos,
        (SELECT COUNT(*) FROM traspaso_soporte ts
           JOIN tipo_traspaso_soporte tts ON tts.tipo_soporte_traspaso_id = ts.tipo_soporte_traspaso_id
                                         AND tts.tipo_traspaso_id = t.tipo_traspaso_id
          WHERE ts.traspaso_id = t.idtraspaso) AS soportes_cargados
    FROM traspaso t
    JOIN contrato c ON t.contrato_idcontrato = c.idcontrato
    JOIN users_company uc ON c.users_company_id = uc.id
    LEFT JOIN tipo_traspaso tt ON t.tipo_traspaso_id = tt.idtipo_traspaso
    LEFT JOIN tipo_contrato tca ON t.tipo_contrato_anterior_id = tca.idtipo_contrato
    LEFT JOIN ciudad cia ON t.ciudad_anterior_id = cia.idciudad
    LEFT JOIN area aa ON t.area_anterior_id = aa.idarea
    LEFT JOIN area an ON t.area_nueva_id = an.idarea
    LEFT JOIN campania cama ON t.campania_anterior_id = cama.idcampania
    LEFT JOIN campania camn ON t.campania_nueva_id = camn.idcampania
    LEFT JOIN centro_costo cca ON t.centro_costo_anterior_id = cca.idcentro_costo
    LEFT JOIN centro_costo ccn ON t.centro_costo_nuevo_id = ccn.idcentro_costo
    LEFT JOIN cargo carga ON t.cargo_anterior_id = carga.idcargo
    LEFT JOIN cargo cargn ON t.cargo_nuevo_id = cargn.idcargo
    LEFT JOIN modalidad moda ON t.modalidad_anterior_id = moda.idmodalidad
    LEFT JOIN modalidad modal ON t.modalidad_idmodalidad = modal.idmodalidad
    LEFT JOIN users_company jaa ON t.jefe_area_anterior_id = jaa.id
    LEFT JOIN users_company jan ON t.jefe_area_nuevo_id = jan.id
    LEFT JOIN users_company jia ON t.jefe_inmediato_anterior_id = jia.id
    LEFT JOIN users_company jin ON t.jefe_inmediato_nuevo_id = jin.id
`;

function val(x) {
    return x === undefined || x === null || x === '' ? null : x;
}

// Mismo orden de columnas para INSERT y UPDATE (evita desalineación de '?')
const CAMPOS = [
    'contrato_idcontrato', 'tipo_traspaso_id', 'estado', 'fecha_inicio', 'fecha_fin', 'ratificacion', 'observaciones',
    'tipo_contrato_anterior_id', 'ciudad_anterior_id', 'fecha_ingreso_anterior',
    'area_anterior_id', 'campania_anterior_id', 'centro_costo_anterior_id', 'cargo_anterior_id',
    'cargo_ssff_anterior', 'usuario_ssff_anterior', 'salario_anterior',
    'bono_no_prestacional_anterior', 'bono_cafeteria_anterior',
    'jefe_area_anterior_id', 'jefe_inmediato_anterior_id', 'modalidad_anterior_id',
    'area_nueva_id', 'campania_nueva_id', 'centro_costo_nuevo_id', 'cargo_nuevo_id',
    'cargo_ssff_nuevo', 'usuario_ssff_nuevo', 'salario_nuevo',
    'bono_no_prestacional_nuevo', 'bono_cafeteria_nuevo',
    'jefe_area_nuevo_id', 'jefe_inmediato_nuevo_id', 'modalidad_idmodalidad',
    'fecha_inicio_trabajo_casa', 'fecha_fin_trabajo_casa', 'diadema', 'equipo_computo'
];

function valoresDe(data) {
    return CAMPOS.map(campo => {
        if (campo === 'contrato_idcontrato') return data.contrato_id;
        if (campo === 'fecha_inicio') return data.fecha_inicio;
        if (campo === 'ratificacion') return data.ratificacion ? 1 : 0;
        return val(data[campo]);
    });
}

const TIPOS_CON_EVALUACION = ['RATIFICACION', 'NO_RATIFICACION'];
const DIAS_AVISO_RETORNO = 7; // hoja TRASPASOS: "una semana antes de que el trabajador retorne"

const fechaCorta = (f) => {
    const [a, m, d] = String(f instanceof Date ? f.toISOString() : f).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
};

class Traspaso {
    static async getAll(filters = {}) {
        const where = [];
        const params = [];

        if (filters.contrato_id) {
            where.push('t.contrato_idcontrato = ?');
            params.push(filters.contrato_id);
        }
        if (filters.desde) {
            where.push('t.fecha_inicio >= ?');
            params.push(filters.desde);
        }
        if (filters.hasta) {
            where.push('t.fecha_inicio <= ?');
            params.push(filters.hasta);
        }

        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const [rows] = await db.query(
            `${SELECT_TRASPASO} ${whereSql} ORDER BY t.fecha_inicio DESC`,
            params
        );
        return rows;
    }

    static async getById(id) {
        const [rows] = await db.query(`${SELECT_TRASPASO} WHERE t.idtraspaso = ?`, [id]);
        return rows[0];
    }

    static async codigoDeTipo(tipoId) {
        const [rows] = await db.query('SELECT codigo FROM tipo_traspaso WHERE idtipo_traspaso = ?', [tipoId]);
        return rows[0]?.codigo || null;
    }

    // Guarda el traspaso y deja sus alertas al día en la misma transacción.
    static async create(data, { hoy, userId } = {}) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [result] = await conn.query(
                `INSERT INTO traspaso (${CAMPOS.join(', ')}) VALUES (${CAMPOS.map(() => '?').join(', ')})`,
                valoresDe(data)
            );
            await Traspaso.sincronizarAlertas(result.insertId, { hoy, userId }, conn);
            await conn.commit();
            return { id: result.insertId, ...data };
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async update(id, data, { hoy, userId } = {}) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const sets = CAMPOS.map(campo => `${campo} = ?`).join(', ');
            const [result] = await conn.query(
                `UPDATE traspaso SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE idtraspaso = ?`,
                [...valoresDe(data), id]
            );
            if (result.affectedRows > 0) await Traspaso.sincronizarAlertas(id, { hoy, userId }, conn);
            await conn.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async delete(id) {
        const [result] = await db.query('DELETE FROM traspaso WHERE idtraspaso = ?', [id]);
        return result.affectedRows > 0;
    }

    // ---- Alertas (migración 070) ----

    // Datos que necesitan las alertas: tipo, empleado y sus jefes actuales.
    static async _datosAlerta(id, conn) {
        const [rows] = await conn.query(
            `SELECT t.idtraspaso, tt.codigo, t.fecha_fin_trabajo_casa, t.jefe_inmediato_nuevo_id,
                    c.director_area_id, c.jefe_area_id, c.jefe_inmediato_id,
                    CONCAT_WS(' ', uc.primer_nombre, uc.primer_apellido) AS empleado,
                    tt.nombre AS tipo_nombre,
                    EXISTS (SELECT 1 FROM traspaso_soporte ts
                              JOIN tipo_soporte_traspaso s ON s.idtipo_soporte_traspaso = ts.tipo_soporte_traspaso_id
                             WHERE ts.traspaso_id = t.idtraspaso AND s.codigo = 'FORMATO_EVALUACION') AS tiene_evaluacion
             FROM traspaso t
             JOIN contrato c ON c.idcontrato = t.contrato_idcontrato
             JOIN users_company uc ON uc.id = c.users_company_id
             LEFT JOIN tipo_traspaso tt ON tt.idtipo_traspaso = t.tipo_traspaso_id
             WHERE t.idtraspaso = ?`,
            [id]
        );
        return rows[0];
    }

    // - Ratificación / no ratificación: una alerta al director de área (si no hay, al jefe de
    //   área) para que haga la evaluación de desempeño del encargo, desde hoy y hasta que se
    //   cargue el formato de evaluación.
    // - Trabajo en casa: una alerta al jefe inmediato (el nuevo si se indicó, si no el actual)
    //   7 días antes de la fecha de retorno.
    // Las alertas pendientes que ya no corresponden al tipo se borran.
    static async sincronizarAlertas(id, { hoy, userId } = {}, conn = db) {
        const t = await Traspaso._datosAlerta(id, conn);
        if (!t) return;

        if (!TIPOS_CON_EVALUACION.includes(t.codigo)) {
            await conn.query("DELETE FROM alerta_traspaso WHERE traspaso_id = ? AND tipo = 'evaluacion_encargo' AND resuelta_en IS NULL", [id]);
        } else if (!t.tiene_evaluacion) {
            const [existentes] = await conn.query("SELECT 1 FROM alerta_traspaso WHERE traspaso_id = ? AND tipo = 'evaluacion_encargo'", [id]);
            if (existentes.length === 0) {
                await conn.query(
                    `INSERT INTO alerta_traspaso (traspaso_id, tipo, destinatario_users_company_id, fecha_alerta, mensaje, creada_por_user_id)
                     VALUES (?, 'evaluacion_encargo', ?, ?, ?, ?)`,
                    [id, t.director_area_id || t.jefe_area_id || null, hoy,
                        `Evaluación de desempeño pendiente del encargo de ${t.empleado} (${t.tipo_nombre}). Envía el formato de evaluación a Recursos Humanos.`,
                        userId ?? null]
                );
            }
        }

        if (t.codigo !== 'TRABAJO_CASA' || !t.fecha_fin_trabajo_casa) {
            await conn.query("DELETE FROM alerta_traspaso WHERE traspaso_id = ? AND tipo = 'retorno_trabajo_casa' AND resuelta_en IS NULL", [id]);
        } else {
            const destinatario = t.jefe_inmediato_nuevo_id || t.jefe_inmediato_id || null;
            const mensaje = `${t.empleado} retorna del trabajo en casa el ${fechaCorta(t.fecha_fin_trabajo_casa)}.`;
            const [existentes] = await conn.query(
                "SELECT idalerta_traspaso, mensaje FROM alerta_traspaso WHERE traspaso_id = ? AND tipo = 'retorno_trabajo_casa' AND resuelta_en IS NULL",
                [id]
            );
            if (existentes.length === 0) {
                await conn.query(
                    `INSERT INTO alerta_traspaso (traspaso_id, tipo, destinatario_users_company_id, fecha_alerta, mensaje, creada_por_user_id)
                     VALUES (?, 'retorno_trabajo_casa', ?, DATE_SUB(?, INTERVAL ? DAY), ?, ?)`,
                    [id, destinatario, t.fecha_fin_trabajo_casa, DIAS_AVISO_RETORNO, mensaje, userId ?? null]
                );
            } else {
                // Si cambió la fecha de retorno, la alerta se reprograma y vuelve a quedar sin leer.
                // (MySQL evalúa los SET en orden: leida_en va antes de pisar `mensaje`.)
                await conn.query(
                    `UPDATE alerta_traspaso
                        SET leida_en = IF(mensaje = ?, leida_en, NULL),
                            destinatario_users_company_id = ?, fecha_alerta = DATE_SUB(?, INTERVAL ? DAY), mensaje = ?
                      WHERE idalerta_traspaso = ?`,
                    [mensaje, destinatario, t.fecha_fin_trabajo_casa, DIAS_AVISO_RETORNO, mensaje, existentes[0].idalerta_traspaso]
                );
            }
        }
    }

    // "Reenviar" la alerta de evaluación: vuelve a quedar con fecha de hoy y sin leer.
    // Devuelve false si ya no hay nada pendiente (el formato ya se cargó o el tipo no la lleva).
    static async reenviarAlertaEvaluacion(id, { hoy, userId } = {}) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const t = await Traspaso._datosAlerta(id, conn);
            if (!t || !TIPOS_CON_EVALUACION.includes(t.codigo) || t.tiene_evaluacion) {
                await conn.rollback();
                return false;
            }
            const [result] = await conn.query(
                `UPDATE alerta_traspaso SET fecha_alerta = ?, leida_en = NULL, destinatario_users_company_id = ?
                  WHERE traspaso_id = ? AND tipo = 'evaluacion_encargo' AND resuelta_en IS NULL`,
                [hoy, t.director_area_id || t.jefe_area_id || null, id]
            );
            if (result.affectedRows === 0) await Traspaso.sincronizarAlertas(id, { hoy, userId }, conn);
            await conn.commit();
            return true;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // Alertas sin resolver, para el panel de RRHH. `estado`: programada (aún no llega su fecha),
    // enviada (ya la ve el destinatario) o leida. Las de retorno dejan de mostrarse cuando pasa
    // la fecha de retorno.
    static async getAlertas(hoy) {
        const [rows] = await db.query(
            `SELECT a.idalerta_traspaso AS id, a.traspaso_id, a.tipo, a.fecha_alerta, a.mensaje, a.leida_en,
                    CASE WHEN a.fecha_alerta > ? THEN 'programada' WHEN a.leida_en IS NULL THEN 'enviada' ELSE 'leida' END AS estado,
                    tt.nombre AS tipo_traspaso,
                    CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido) AS empleado_nombre,
                    uc.numero_identificacion AS empleado_identificacion,
                    CONCAT_WS(' ', d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido) AS destinatario_nombre
             FROM alerta_traspaso a
             JOIN traspaso t ON t.idtraspaso = a.traspaso_id
             JOIN contrato c ON c.idcontrato = t.contrato_idcontrato
             JOIN users_company uc ON uc.id = c.users_company_id
             LEFT JOIN tipo_traspaso tt ON tt.idtipo_traspaso = t.tipo_traspaso_id
             LEFT JOIN users_company d ON d.id = a.destinatario_users_company_id
             WHERE a.resuelta_en IS NULL
               AND (a.tipo <> 'retorno_trabajo_casa' OR t.fecha_fin_trabajo_casa >= ?)
             ORDER BY a.fecha_alerta, a.idalerta_traspaso`,
            [hoy, hoy]
        );
        return rows;
    }

    // ---- Documentos (migración 070) ----

    // Los documentos que aplican al tipo del traspaso, con su archivo si ya se cargó, más los
    // cargados que ya no aplican (si se cambió el tipo) con `aplica = 0`.
    static async getSoportes(traspasoId) {
        const [rows] = await db.query(
            `SELECT s.idtipo_soporte_traspaso AS tipo_soporte_id, s.codigo, s.nombre, s.orden,
                    (tts.tipo_traspaso_id IS NOT NULL) AS aplica,
                    ts.idtraspaso_soporte AS id, ts.nombre_original, ts.mime, ts.tamano, ts.updated_at AS cargado_en
             FROM traspaso t
             JOIN tipo_soporte_traspaso s
             LEFT JOIN tipo_traspaso_soporte tts
                    ON tts.tipo_traspaso_id = t.tipo_traspaso_id AND tts.tipo_soporte_traspaso_id = s.idtipo_soporte_traspaso
             LEFT JOIN traspaso_soporte ts
                    ON ts.traspaso_id = t.idtraspaso AND ts.tipo_soporte_traspaso_id = s.idtipo_soporte_traspaso
             WHERE t.idtraspaso = ? AND (tts.tipo_traspaso_id IS NOT NULL OR ts.idtraspaso_soporte IS NOT NULL)
             ORDER BY aplica DESC, s.orden`,
            [traspasoId]
        );
        return rows;
    }

    static async soporteAplica(traspasoId, tipoSoporteId) {
        const [rows] = await db.query(
            `SELECT 1 FROM traspaso t
             JOIN tipo_traspaso_soporte tts ON tts.tipo_traspaso_id = t.tipo_traspaso_id
             WHERE t.idtraspaso = ? AND tts.tipo_soporte_traspaso_id = ?`,
            [traspasoId, tipoSoporteId]
        );
        return rows.length > 0;
    }

    static async getSoporte(traspasoId, tipoSoporteId) {
        const [rows] = await db.query(
            'SELECT * FROM traspaso_soporte WHERE traspaso_id = ? AND tipo_soporte_traspaso_id = ?',
            [traspasoId, tipoSoporteId]
        );
        return rows[0];
    }

    // Guarda (o reemplaza) el archivo de un documento y, si es el formato de evaluación, da por
    // resuelta la alerta al director. Devuelve el archivo anterior, si había, para borrarlo del
    // disco después del commit.
    static async guardarSoporte(traspasoId, tipoSoporteId, archivo, userId) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [previo] = await conn.query(
                'SELECT archivo FROM traspaso_soporte WHERE traspaso_id = ? AND tipo_soporte_traspaso_id = ? FOR UPDATE',
                [traspasoId, tipoSoporteId]
            );
            await conn.query(
                `INSERT INTO traspaso_soporte
                    (traspaso_id, tipo_soporte_traspaso_id, archivo, nombre_original, mime, tamano, subido_por_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE archivo = VALUES(archivo), nombre_original = VALUES(nombre_original),
                    mime = VALUES(mime), tamano = VALUES(tamano), subido_por_user_id = VALUES(subido_por_user_id)`,
                [traspasoId, tipoSoporteId, archivo.nombre, archivo.nombreOriginal, archivo.mime, archivo.tamano, userId ?? null]
            );
            await conn.query(
                `UPDATE alerta_traspaso SET resuelta_en = NOW()
                  WHERE traspaso_id = ? AND tipo = 'evaluacion_encargo' AND resuelta_en IS NULL
                    AND EXISTS (SELECT 1 FROM tipo_soporte_traspaso s WHERE s.idtipo_soporte_traspaso = ? AND s.codigo = 'FORMATO_EVALUACION')`,
                [traspasoId, tipoSoporteId]
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

    // Devuelve el archivo borrado (o null si no había). Si era el formato de evaluación, la
    // alerta al director vuelve a quedar pendiente.
    static async eliminarSoporte(traspasoId, tipoSoporteId) {
        const actual = await Traspaso.getSoporte(traspasoId, tipoSoporteId);
        if (!actual) return null;
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM traspaso_soporte WHERE idtraspaso_soporte = ?', [actual.idtraspaso_soporte]);
            await conn.query(
                `UPDATE alerta_traspaso SET resuelta_en = NULL
                  WHERE traspaso_id = ? AND tipo = 'evaluacion_encargo'
                    AND EXISTS (SELECT 1 FROM tipo_soporte_traspaso s WHERE s.idtipo_soporte_traspaso = ? AND s.codigo = 'FORMATO_EVALUACION')`,
                [traspasoId, tipoSoporteId]
            );
            await conn.commit();
            return actual.archivo;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    // Archivos de un traspaso, para borrarlos del disco al eliminarlo (las filas caen por CASCADE).
    static async archivosDeTraspaso(traspasoId) {
        const [rows] = await db.query('SELECT archivo FROM traspaso_soporte WHERE traspaso_id = ?', [traspasoId]);
        return rows.map(r => r.archivo);
    }
}

module.exports = Traspaso;
