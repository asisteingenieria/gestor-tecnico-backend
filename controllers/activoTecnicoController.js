const Activo = require('../models/Activo');
const ActivoHistorial = require('../models/ActivoHistorial');
const InventarioObservacion = require('../models/InventarioObservacion');
const db = require('../config/db');
const { agregarAlertas } = require('./mantenimientoActivoController');

// Todos los tipos de activos tecnológicos son accesibles por el técnico de inventario
const TIPOS_EDITABLES = ['ECC-CPU', 'ECC-POR', 'ECC-SER', 'ECC-MON', 'ECC-IMP', 'ECC-TV', 'OTHER'];

// Campos de componentes que puede editar el técnico
const CAMPOS_EDITABLES = ['cpu_procesador', 'memoria_ram', 'almacenamiento', 'sistema_operativo', 'clasificacion'];

// Labels para mostrar nombres amigables
const CAMPO_LABELS = {
    cpu_procesador: 'CPU / Procesador',
    memoria_ram: 'Memoria RAM',
    almacenamiento: 'Almacenamiento',
    sistema_operativo: 'Sistema Operativo',
    clasificacion: 'Clasificación',
    estado: 'Estado',
    puesto: 'Puesto',
    site: 'Site'
};

/**
 * @desc    Obtener activos editables (solo CPU, Portátil, Servidor)
 * @route   GET /api/activos-tecnico
 * @access  Private (tecnicoInventario, gestorActivos, admin)
 */
exports.getActivosEditables = async (req, res) => {
    try {
        const { numero_placa, ubicacion } = req.query;

        let query = `
            SELECT
                a.id,
                a.numero_placa,
                a.tipo_activo,
                a.ubicacion,
                a.site,
                a.responsable,
                a.asignado,
                a.puesto,
                a.marca_modelo,
                a.cpu_procesador,
                a.memoria_ram,
                a.almacenamiento,
                a.sistema_operativo,
                a.clasificacion,
                a.estado
            FROM activos a
            WHERE 1=1
        `;
        const params = [];

        // Filtro por número de placa
        if (numero_placa) {
            const normalizedSearch = numero_placa.replace(/'/g, '-');
            query += ' AND (a.numero_placa LIKE ? OR a.numero_placa LIKE ?)';
            params.push(`%${numero_placa}%`);
            params.push(`%${normalizedSearch}%`);
        }

        // Filtro por ubicación
        if (ubicacion) {
            query += ' AND a.ubicacion = ?';
            params.push(ubicacion);
        }

        query += ' ORDER BY a.numero_placa ASC';

        const [rows] = await db.query(query, params);

        res.json({
            success: true,
            data: await agregarAlertas(rows),
            tiposEditables: TIPOS_EDITABLES
        });
    } catch (err) {
        console.error('Error al obtener activos editables:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener activos'
        });
    }
};

/**
 * @desc    Obtener componentes editables de un activo
 * @route   GET /api/activos-tecnico/:id/componentes
 * @access  Private (tecnicoInventario, gestorActivos, admin)
 */
exports.getComponentesActivo = async (req, res) => {
    try {
        const { id } = req.params;

        const [rows] = await db.query(`
            SELECT
                id,
                numero_placa,
                tipo_activo,
                cpu_procesador,
                memoria_ram,
                almacenamiento,
                sistema_operativo,
                clasificacion,
                marca_modelo,
                ubicacion,
                site,
                puesto,
                responsable,
                asignado,
                estado
            FROM activos
            WHERE id = ?
        `, [id]);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                msg: 'Activo no encontrado'
            });
        }

        const activo = rows[0];

        // Construir respuesta con componentes
        const componentes = CAMPOS_EDITABLES.map(campo => ({
            campo,
            label: CAMPO_LABELS[campo],
            valorActual: activo[campo] || null
        }));

        res.json({
            success: true,
            activo: {
                id: activo.id,
                numero_placa: activo.numero_placa,
                tipo_activo: activo.tipo_activo,
                marca_modelo: activo.marca_modelo,
                ubicacion: activo.ubicacion,
                site: activo.site,
                puesto: activo.puesto,
                responsable: activo.responsable,
                asignado: activo.asignado,
                estado: activo.estado
            },
            componentes,
            camposEditables: CAMPOS_EDITABLES
        });
    } catch (err) {
        console.error('Error al obtener componentes:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener componentes'
        });
    }
};

/**
 * @desc    Actualizar un componente de hardware y registrar en historial
 * @route   PUT /api/activos-tecnico/:id/componente
 * @access  Private (tecnicoInventario, gestorActivos, admin)
 */
exports.actualizarComponente = async (req, res) => {
    try {
        const { id } = req.params;
        const { campo, nuevoValor } = req.body;
        const usuarioId = req.user.id;

        // Validar que el campo es editable
        if (!CAMPOS_EDITABLES.includes(campo)) {
            return res.status(400).json({
                success: false,
                msg: `Campo no permitido. Solo se pueden editar: ${CAMPOS_EDITABLES.join(', ')}`
            });
        }

        // Validar que el nuevo valor no está vacío
        if (!nuevoValor || nuevoValor.trim() === '') {
            return res.status(400).json({
                success: false,
                msg: 'El nuevo valor no puede estar vacío'
            });
        }

        // Verificar que el activo existe
        const [activos] = await db.query(`
            SELECT id, numero_placa, tipo_activo, ${campo} as valor_actual
            FROM activos
            WHERE id = ?
        `, [id]);

        if (activos.length === 0) {
            return res.status(404).json({
                success: false,
                msg: 'Activo no encontrado'
            });
        }

        const activo = activos[0];
        const valorAnterior = activo.valor_actual;

        // Verificar que el valor realmente cambió
        if (valorAnterior === nuevoValor.trim()) {
            return res.status(400).json({
                success: false,
                msg: 'El nuevo valor es igual al valor actual'
            });
        }

        // Actualizar el campo en la tabla activos
        const updateQuery = `UPDATE activos SET ${campo} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
        await db.query(updateQuery, [nuevoValor.trim(), id]);

        // Registrar el cambio en el historial
        await ActivoHistorial.registrarCambio(
            id,
            campo,
            valorAnterior,
            nuevoValor.trim(),
            usuarioId
        );

        res.json({
            success: true,
            msg: `${CAMPO_LABELS[campo]} actualizado correctamente`,
            data: {
                activoId: id,
                numero_placa: activo.numero_placa,
                campo,
                valorAnterior,
                valorNuevo: nuevoValor.trim()
            }
        });
    } catch (err) {
        console.error('Error al actualizar componente:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al actualizar componente'
        });
    }
};

/**
 * @desc    Obtener historial de cambios de un activo
 * @route   GET /api/activos-tecnico/:id/historial
 * @access  Private (gestorActivos, admin) - NO tecnicoInventario
 */
exports.getHistorialActivo = async (req, res) => {
    try {
        const { id } = req.params;

        // Verificar que el activo existe
        const activo = await Activo.getById(id);
        if (!activo) {
            return res.status(404).json({
                success: false,
                msg: 'Activo no encontrado'
            });
        }

        // Obtener historial
        const historial = await ActivoHistorial.getByActivoId(id);

        res.json({
            success: true,
            activo: {
                id: activo.id,
                numero_placa: activo.numero_placa,
                tipo_activo: activo.tipo_activo
            },
            historial: historial.map(h => ({
                id: h.id,
                campo: h.campo_modificado,
                campoLabel: CAMPO_LABELS[h.campo_modificado],
                valorAnterior: h.valor_anterior,
                valorNuevo: h.valor_nuevo,
                modificadoPor: h.modificado_por_nombre || h.modificado_por_usuario,
                fecha: h.fecha_modificacion
            }))
        });
    } catch (err) {
        console.error('Error al obtener historial:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener historial'
        });
    }
};

/**
 * @desc    Obtener estadísticas del historial de cambios
 * @route   GET /api/activos-tecnico/historial/stats
 * @access  Private (gestorActivos, admin)
 */
exports.getHistorialStats = async (req, res) => {
    try {
        // Total de cambios
        const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM activos_historial');

        // Cambios agrupados por usuario
        const [porUsuario] = await db.query(`
            SELECT
                u.id,
                u.full_name as nombre,
                u.username,
                COUNT(*) as cantidad,
                MAX(ah.fecha_modificacion) as ultimo_cambio
            FROM activos_historial ah
            LEFT JOIN users u ON ah.modificado_por_id = u.id
            GROUP BY u.id, u.full_name, u.username
            ORDER BY cantidad DESC
        `);

        // Cambios agrupados por campo
        const [porCampo] = await db.query(`
            SELECT
                campo_modificado as campo,
                COUNT(*) as cantidad
            FROM activos_historial
            GROUP BY campo_modificado
            ORDER BY cantidad DESC
        `);

        // Top 10 activos más modificados
        const [topActivos] = await db.query(`
            SELECT
                a.id,
                a.numero_placa,
                a.tipo_activo,
                COUNT(*) as cantidad
            FROM activos_historial ah
            LEFT JOIN activos a ON ah.activo_id = a.id
            GROUP BY a.id, a.numero_placa, a.tipo_activo
            ORDER BY cantidad DESC
            LIMIT 10
        `);

        // Tendencia últimos 7 días vs 7 días anteriores
        const [[{ ultimos7 }]] = await db.query(`
            SELECT COUNT(*) as ultimos7
            FROM activos_historial
            WHERE fecha_modificacion >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);
        const [[{ previos7 }]] = await db.query(`
            SELECT COUNT(*) as previos7
            FROM activos_historial
            WHERE fecha_modificacion >= DATE_SUB(NOW(), INTERVAL 14 DAY)
              AND fecha_modificacion < DATE_SUB(NOW(), INTERVAL 7 DAY)
        `);

        // Total activos únicos modificados
        const [[{ activosUnicos }]] = await db.query(
            'SELECT COUNT(DISTINCT activo_id) as activosUnicos FROM activos_historial'
        );

        // Total usuarios únicos
        const [[{ usuariosUnicos }]] = await db.query(
            'SELECT COUNT(DISTINCT modificado_por_id) as usuariosUnicos FROM activos_historial'
        );

        res.json({
            success: true,
            stats: {
                total,
                activosUnicos,
                usuariosUnicos,
                ultimos7dias: ultimos7,
                previos7dias: previos7,
                porUsuario: porUsuario.map(u => ({
                    id: u.id,
                    nombre: u.nombre || u.username,
                    cantidad: u.cantidad,
                    ultimoCambio: u.ultimo_cambio
                })),
                porCampo: porCampo.map(c => ({
                    campo: c.campo,
                    label: CAMPO_LABELS[c.campo] || c.campo,
                    cantidad: c.cantidad
                })),
                topActivos: topActivos.map(a => ({
                    id: a.id,
                    numeroPlaca: a.numero_placa,
                    tipoActivo: a.tipo_activo,
                    cantidad: a.cantidad
                }))
            }
        });
    } catch (err) {
        console.error('Error al obtener stats del historial:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener estadísticas del historial'
        });
    }
};

/**
 * @desc    Obtener historial filtrado con paginación
 * @route   GET /api/activos-tecnico/historial/filtered
 * @access  Private (gestorActivos, admin)
 */
exports.getFilteredHistorial = async (req, res) => {
    try {
        const { usuario, campo, fechaInicio, fechaFin, numeroPlaca, activoId, limit = 50, offset = 0 } = req.query;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (usuario) {
            whereClause += ' AND ah.modificado_por_id = ?';
            params.push(usuario);
        }
        if (campo) {
            whereClause += ' AND ah.campo_modificado = ?';
            params.push(campo);
        }
        if (fechaInicio) {
            whereClause += ' AND ah.fecha_modificacion >= ?';
            params.push(fechaInicio);
        }
        if (fechaFin) {
            whereClause += ' AND ah.fecha_modificacion <= ?';
            params.push(fechaFin + ' 23:59:59');
        }
        if (numeroPlaca) {
            whereClause += ' AND a.numero_placa LIKE ?';
            params.push(`%${numeroPlaca}%`);
        }
        if (activoId) {
            whereClause += ' AND ah.activo_id = ?';
            params.push(activoId);
        }

        // Contar total con filtros
        const [[{ total }]] = await db.query(`
            SELECT COUNT(*) as total
            FROM activos_historial ah
            LEFT JOIN activos a ON ah.activo_id = a.id
            ${whereClause}
        `, params);

        // Obtener datos paginados
        const [rows] = await db.query(`
            SELECT
                ah.*,
                a.numero_placa,
                a.tipo_activo,
                u.full_name as modificado_por_nombre,
                u.username as modificado_por_usuario
            FROM activos_historial ah
            LEFT JOIN activos a ON ah.activo_id = a.id
            LEFT JOIN users u ON ah.modificado_por_id = u.id
            ${whereClause}
            ORDER BY ah.fecha_modificacion DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), parseInt(offset)]);

        res.json({
            success: true,
            data: rows.map(h => ({
                id: h.id,
                activoId: h.activo_id,
                numeroPlaca: h.numero_placa,
                tipoActivo: h.tipo_activo,
                campo: h.campo_modificado,
                campoLabel: CAMPO_LABELS[h.campo_modificado] || h.campo_modificado,
                valorAnterior: h.valor_anterior,
                valorNuevo: h.valor_nuevo,
                modificadoPor: h.modificado_por_nombre || h.modificado_por_usuario,
                fecha: h.fecha_modificacion
            })),
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (err) {
        console.error('Error al obtener historial filtrado:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener historial filtrado'
        });
    }
};

/**
 * @desc    Obtener todo el historial de cambios (para reportes admin)
 * @route   GET /api/activos-tecnico/historial
 * @access  Private (gestorActivos, admin)
 */
exports.getAllHistorial = async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;

        const historial = await ActivoHistorial.getAll(
            parseInt(limit),
            parseInt(offset)
        );
        const total = await ActivoHistorial.countAll();

        res.json({
            success: true,
            data: historial.map(h => ({
                id: h.id,
                activoId: h.activo_id,
                numeroPlaca: h.numero_placa,
                tipoActivo: h.tipo_activo,
                campo: h.campo_modificado,
                campoLabel: CAMPO_LABELS[h.campo_modificado],
                valorAnterior: h.valor_anterior,
                valorNuevo: h.valor_nuevo,
                modificadoPor: h.modificado_por_nombre || h.modificado_por_usuario,
                fecha: h.fecha_modificacion
            })),
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
    } catch (err) {
        console.error('Error al obtener historial general:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener historial'
        });
    }
};

/**
 * @desc    Obtener activos clasificados como "Activo no productivo" (CPUs y Portátiles)
 * @route   GET /api/activos-tecnico/no-productivos
 * @access  Private (gestorActivos, admin)
 */
exports.getActivosNoProductivos = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                a.id,
                a.numero_placa,
                a.tipo_activo,
                a.ubicacion,
                a.marca_modelo,
                a.estado,
                h.modificado_por_id,
                u.full_name AS clasificado_por_nombre,
                u.username AS clasificado_por_usuario,
                h.fecha_modificacion AS fecha_clasificacion
            FROM activos a
            LEFT JOIN (
                SELECT ah1.*
                FROM activos_historial ah1
                INNER JOIN (
                    SELECT activo_id, MAX(id) AS max_id
                    FROM activos_historial
                    WHERE campo_modificado = 'clasificacion'
                      AND valor_nuevo = 'Activo no productivo'
                    GROUP BY activo_id
                ) ah2 ON ah1.id = ah2.max_id
            ) h ON a.id = h.activo_id
            LEFT JOIN users u ON h.modificado_por_id = u.id
            WHERE a.clasificacion = 'Activo no productivo'
            ORDER BY a.numero_placa ASC
        `);

        res.json({
            success: true,
            data: rows.map(r => ({
                id: r.id,
                numeroPlaca: r.numero_placa,
                tipoActivo: r.tipo_activo,
                ubicacion: r.ubicacion,
                marcaModelo: r.marca_modelo,
                estado: r.estado,
                clasificadoPor: r.clasificado_por_nombre || r.clasificado_por_usuario || null,
                fechaClasificacion: r.fecha_clasificacion || null
            }))
        });
    } catch (err) {
        console.error('Error al obtener activos no productivos:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener activos no productivos'
        });
    }
};

/**
 * @desc    Obtener activos que están en estado bodega
 * @route   GET /api/activos-tecnico/en-bodega
 * @access  Private (gestorActivos, admin)
 */
exports.getActivosEnBodega = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                a.id,
                a.numero_placa,
                a.tipo_activo,
                a.ubicacion,
                a.marca_modelo,
                a.estado,
                h.modificado_por_id,
                u.full_name AS enviado_por_nombre,
                u.username AS enviado_por_usuario,
                h.fecha_modificacion AS fecha_bodega
            FROM activos a
            LEFT JOIN (
                SELECT ah1.*
                FROM activos_historial ah1
                INNER JOIN (
                    SELECT activo_id, MAX(id) AS max_id
                    FROM activos_historial
                    WHERE campo_modificado = 'estado'
                      AND valor_nuevo = 'bodega'
                    GROUP BY activo_id
                ) ah2 ON ah1.id = ah2.max_id
            ) h ON a.id = h.activo_id
            LEFT JOIN users u ON h.modificado_por_id = u.id
            WHERE a.estado = 'bodega'
            ORDER BY h.fecha_modificacion DESC
        `);

        res.json({
            success: true,
            data: rows.map(r => ({
                id: r.id,
                numeroPlaca: r.numero_placa,
                tipoActivo: r.tipo_activo,
                ubicacion: r.ubicacion,
                marcaModelo: r.marca_modelo,
                estado: r.estado,
                enviadoPor: r.enviado_por_nombre || r.enviado_por_usuario || null,
                fechaBodega: r.fecha_bodega || null
            }))
        });
    } catch (err) {
        console.error('Error al obtener activos en bodega:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener activos en bodega'
        });
    }
};

/**
 * @desc    Cambiar estado de mantenimiento de un activo (en_mantenimiento <-> funcional)
 * @route   PUT /api/activos-tecnico/:id/estado-mantenimiento
 * @access  Private (tecnicoInventario, gestorActivos, admin)
 */
exports.actualizarEstadoMantenimiento = async (req, res) => {
    try {
        const { id } = req.params;
        const { nuevoEstado } = req.body;
        const usuarioId = req.user.id;

        // La baja ya no pasa por aquí: va por POST /:id/solicitar-baja (con observación) y la
        // resuelve el admin (dar-de-baja / rechazar-baja) o el técnico la cancela (cancelar-baja).
        const estadosPermitidos = ['en_mantenimiento', 'funcional', 'bodega'];
        if (!estadosPermitidos.includes(nuevoEstado)) {
            return res.status(400).json({
                success: false,
                msg: `Estado inválido. Solo se permite: ${estadosPermitidos.join(', ')}`
            });
        }

        const [activos] = await db.query(
            'SELECT id, numero_placa, estado FROM activos WHERE id = ?',
            [id]
        );
        if (activos.length === 0) {
            return res.status(404).json({ success: false, msg: 'Activo no encontrado' });
        }

        const activo = activos[0];

        if (activo.estado === 'dado_de_baja') {
            return res.status(400).json({ success: false, msg: 'No se puede modificar un activo dado de baja' });
        }

        if (activo.estado === 'pendiente_baja') {
            return res.status(400).json({
                success: false,
                msg: 'El activo tiene una solicitud de baja pendiente: el administrador debe aprobarla o rechazarla, o el técnico cancelarla'
            });
        }

        if (activo.estado === nuevoEstado) {
            return res.status(400).json({ success: false, msg: `El activo ya se encuentra en estado "${nuevoEstado}"` });
        }

        const estadoAnterior = activo.estado;

        await db.query(
            'UPDATE activos SET estado = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [nuevoEstado, id]
        );

        await ActivoHistorial.registrarCambio(id, 'estado', estadoAnterior, nuevoEstado, usuarioId);

        const mensajes = {
            en_mantenimiento: `Activo ${activo.numero_placa} puesto en mantenimiento`,
            funcional: `Activo ${activo.numero_placa} marcado como funcional`,
            bodega: `Activo ${activo.numero_placa} enviado a bodega`
        };

        res.json({
            success: true,
            msg: mensajes[nuevoEstado],
            data: { id: activo.id, numeroPlaca: activo.numero_placa, estadoAnterior, estadoNuevo: nuevoEstado }
        });
    } catch (err) {
        console.error('Error al actualizar estado de mantenimiento:', err.message);
        res.status(500).json({ success: false, msg: 'Error del servidor al actualizar el estado' });
    }
};

/**
 * @desc    Crear observación de inventario para un activo
 * @route   POST /api/activos-tecnico/:id/inventario
 * @access  Private (tecnicoInventario, gestorActivos, admin)
 */
exports.crearObservacionInventario = async (req, res) => {
    try {
        const { id } = req.params;
        const { observaciones } = req.body;
        const usuarioId = req.user.id;

        // Validar que observaciones no esté vacío
        if (!observaciones || observaciones.trim() === '') {
            return res.status(400).json({
                success: false,
                msg: 'Las observaciones no pueden estar vacías'
            });
        }

        // Verificar que el activo existe
        const [activos] = await db.query(`
            SELECT id, numero_placa, tipo_activo
            FROM activos
            WHERE id = ?
        `, [id]);

        if (activos.length === 0) {
            return res.status(404).json({
                success: false,
                msg: 'Activo no encontrado'
            });
        }

        const resultado = await InventarioObservacion.crear(id, observaciones.trim(), usuarioId);

        res.json({
            success: true,
            msg: 'Observación de mantenimiento registrada correctamente',
            data: resultado
        });
    } catch (err) {
        console.error('Error al crear observación de inventario:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al registrar observación de inventario'
        });
    }
};

/**
 * @desc    Obtener observaciones de inventario de un activo
 * @route   GET /api/activos-tecnico/:id/inventario
 * @access  Private (tecnicoInventario, gestorActivos, admin)
 */
exports.getObservacionesInventario = async (req, res) => {
    try {
        const { id } = req.params;

        const observaciones = await InventarioObservacion.getByActivoId(id);

        res.json({
            success: true,
            data: observaciones.map(o => ({
                id: o.id,
                observaciones: o.observaciones,
                realizadoPor: o.realizado_por_nombre || o.realizado_por_usuario,
                fecha: o.fecha_creacion
            }))
        });
    } catch (err) {
        console.error('Error al obtener observaciones de inventario:', err.message);
        res.status(500).json({
            success: false,
            msg: 'Error del servidor al obtener observaciones de inventario'
        });
    }
};
