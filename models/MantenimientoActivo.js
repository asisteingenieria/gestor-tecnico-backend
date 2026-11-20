const db = require('../config/db');

/**
 * SQL de mantenimientos, hoja de vida, traslados de puesto y solicitudes de baja de activos
 * (migración 104). Los métodos que reciben `conn` corren dentro de la transacción del controller.
 */

const COLUMNAS_ACTIVO = `
    id, numero_placa, tipo_activo, marca_modelo, numero_serie_fabricante, ubicacion, site, puesto,
    responsable, asignado, estado, clasificacion, fecha_compra, garantia, fecha_vencimiento_garantia,
    cpu_procesador, memoria_ram, almacenamiento, sistema_operativo`;

class MantenimientoActivo {
    /** Ejecuta fn(conn) en una transacción. */
    static async enTransaccion(fn) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const resultado = await fn(conn);
            await conn.commit();
            return resultado;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    /** Activo bloqueado para actualizar (FOR UPDATE) dentro de una transacción. */
    static async activoParaActualizar(conn, id) {
        const [rows] = await conn.query(`SELECT ${COLUMNAS_ACTIVO} FROM activos WHERE id = ? FOR UPDATE`, [id]);
        return rows[0] || null;
    }

    static async activo(id) {
        const [rows] = await db.query(`SELECT ${COLUMNAS_ACTIVO} FROM activos WHERE id = ?`, [id]);
        return rows[0] || null;
    }

    static async registrarHistorial(conn, activoId, campo, valorAnterior, valorNuevo, usuarioId) {
        await conn.query(
            `INSERT INTO activos_historial (activo_id, campo_modificado, valor_anterior, valor_nuevo, modificado_por_id)
             VALUES (?, ?, ?, ?, ?)`,
            [activoId, campo, valorAnterior ?? null, valorNuevo ?? '', usuarioId]
        );
    }

    static async cambiarEstado(conn, activoId, estadoAnterior, estadoNuevo, usuarioId) {
        await conn.query('UPDATE activos SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [estadoNuevo, activoId]);
        await MantenimientoActivo.registrarHistorial(conn, activoId, 'estado', estadoAnterior, estadoNuevo, usuarioId);
    }

    static async crearMantenimiento(conn, activo, datos, usuarioId) {
        const [r] = await conn.query(
            `INSERT INTO activo_mantenimiento
                (activo_id, tipo, pasta_termica, limpieza_componentes, formateo, descripcion,
                 cpu_procesador, memoria_ram, almacenamiento, sistema_operativo, puesto, realizado_por_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                activo.id, datos.tipo, datos.pasta_termica ? 1 : 0, datos.limpieza_componentes ? 1 : 0,
                datos.formateo ? 1 : 0, datos.descripcion, activo.cpu_procesador, activo.memoria_ram,
                activo.almacenamiento, activo.sistema_operativo, activo.puesto, usuarioId
            ]
        );
        return r.insertId;
    }

    static async mantenimientosDeActivo(activoId) {
        const [rows] = await db.query(
            `SELECT m.*, u.full_name AS realizado_por_nombre, u.username AS realizado_por_usuario
               FROM activo_mantenimiento m
               LEFT JOIN users u ON u.id = m.realizado_por_id
              WHERE m.activo_id = ?
              ORDER BY m.fecha DESC, m.id DESC`,
            [activoId]
        );
        return rows;
    }

    /** Notas de "Finalizar mantenimiento" de antes de la migración 104 (texto libre). */
    static async observacionesAnteriores(activoId) {
        const [rows] = await db.query(
            `SELECT io.id, io.observaciones, io.fecha_creacion, u.full_name AS realizado_por_nombre,
                    u.username AS realizado_por_usuario
               FROM inventario_observaciones io
               LEFT JOIN users u ON u.id = io.realizado_por_id
              WHERE io.activo_id = ?
              ORDER BY io.fecha_creacion DESC`,
            [activoId]
        );
        return rows;
    }

    /** Historial del activo para la hoja de vida (traslados, componentes y estados). */
    static async historialDeActivo(activoId) {
        const [rows] = await db.query(
            `SELECT h.id, h.campo_modificado, h.valor_anterior, h.valor_nuevo, h.fecha_modificacion,
                    u.full_name AS modificado_por_nombre, u.username AS modificado_por_usuario
               FROM activos_historial h
               LEFT JOIN users u ON u.id = h.modificado_por_id
              WHERE h.activo_id = ?
              ORDER BY h.fecha_modificacion DESC, h.id DESC`,
            [activoId]
        );
        return rows;
    }

    static async solicitudesBajaDeActivo(activoId) {
        const [rows] = await db.query(
            `SELECT s.*, us.full_name AS solicitado_por_nombre, us.username AS solicitado_por_usuario,
                    ur.full_name AS resuelto_por_nombre, ur.username AS resuelto_por_usuario
               FROM activo_solicitud_baja s
               LEFT JOIN users us ON us.id = s.solicitado_por_id
               LEFT JOIN users ur ON ur.id = s.resuelto_por_id
              WHERE s.activo_id = ?
              ORDER BY s.fecha_solicitud DESC, s.id DESC`,
            [activoId]
        );
        return rows;
    }

    /**
     * Fecha del último mantenimiento preventivo por activo (y, de respaldo, la última nota de
     * mantenimiento anterior a la migración 104). Devuelve Map<activoId, {preventivo, anterior}>.
     */
    static async ultimosMantenimientos() {
        const [prev] = await db.query(
            `SELECT activo_id, MAX(fecha) AS fecha FROM activo_mantenimiento WHERE tipo = 'preventivo' GROUP BY activo_id`
        );
        const [ant] = await db.query(
            'SELECT activo_id, MAX(fecha_creacion) AS fecha FROM inventario_observaciones GROUP BY activo_id'
        );
        const mapa = new Map();
        for (const r of prev) mapa.set(r.activo_id, { preventivo: r.fecha, anterior: null });
        for (const r of ant) {
            const actual = mapa.get(r.activo_id) || { preventivo: null, anterior: null };
            actual.anterior = r.fecha;
            mapa.set(r.activo_id, actual);
        }
        return mapa;
    }

    static async solicitudPendiente(conn, activoId) {
        const [rows] = await conn.query(
            `SELECT * FROM activo_solicitud_baja WHERE activo_id = ? AND estado = 'pendiente'
              ORDER BY id DESC LIMIT 1 FOR UPDATE`,
            [activoId]
        );
        return rows[0] || null;
    }

    static async crearSolicitudBaja(conn, activoId, motivo, estadoAnterior, usuarioId) {
        const [r] = await conn.query(
            `INSERT INTO activo_solicitud_baja (activo_id, motivo, estado_anterior, solicitado_por_id)
             VALUES (?, ?, ?, ?)`,
            [activoId, motivo, estadoAnterior, usuarioId]
        );
        return r.insertId;
    }

    static async resolverSolicitud(conn, solicitudId, estado, usuarioId, comentario) {
        await conn.query(
            `UPDATE activo_solicitud_baja
                SET estado = ?, resuelto_por_id = ?, fecha_resolucion = CURRENT_TIMESTAMP, comentario_resolucion = ?
              WHERE id = ?`,
            [estado, usuarioId, comentario, solicitudId]
        );
    }

    /** Solicitudes de baja pendientes con su observación, para el administrador. */
    static async pendientesBaja() {
        const [rows] = await db.query(`
            SELECT a.id, a.numero_placa, a.tipo_activo, a.ubicacion, a.site, a.puesto, a.marca_modelo,
                   a.estado, a.clasificacion,
                   s.id AS solicitud_id, s.motivo,
                   COALESCE(s.fecha_solicitud, h.fecha_modificacion) AS fecha_solicitud,
                   COALESCE(us.full_name, us.username, uh.full_name, uh.username) AS solicitado_por
              FROM activos a
              LEFT JOIN activo_solicitud_baja s
                     ON s.id = (SELECT MAX(s2.id) FROM activo_solicitud_baja s2
                                 WHERE s2.activo_id = a.id AND s2.estado = 'pendiente')
              LEFT JOIN users us ON us.id = s.solicitado_por_id
              LEFT JOIN activos_historial h
                     ON h.id = (SELECT MAX(h2.id) FROM activos_historial h2
                                 WHERE h2.activo_id = a.id AND h2.campo_modificado = 'estado'
                                   AND h2.valor_nuevo = 'pendiente_baja')
              LEFT JOIN users uh ON uh.id = h.modificado_por_id
             WHERE a.estado = 'pendiente_baja'
             ORDER BY fecha_solicitud ASC`);
        return rows;
    }

    static async trasladar(conn, activo, puesto, site, usuarioId) {
        const cambios = [];
        if ((activo.puesto || '') !== puesto) cambios.push(['puesto', activo.puesto, puesto]);
        if (site !== undefined && (activo.site || null) !== site) cambios.push(['site', activo.site, site]);
        if (cambios.length === 0) return cambios;

        const sets = cambios.map(([campo]) => `${campo} = ?`).join(', ');
        await conn.query(
            `UPDATE activos SET ${sets}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [...cambios.map(([, , nuevo]) => nuevo), activo.id]
        );
        for (const [campo, anterior, nuevo] of cambios) {
            await MantenimientoActivo.registrarHistorial(conn, activo.id, campo, anterior, nuevo ?? 'Sin site', usuarioId);
        }
        return cambios;
    }
}

module.exports = MantenimientoActivo;
