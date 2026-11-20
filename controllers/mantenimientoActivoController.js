const MantenimientoActivo = require('../models/MantenimientoActivo');
const {
    esComputador,
    validarMantenimiento,
    validarMotivoBaja,
    normalizarComentario,
    validarTraslado,
    nivelAlerta,
    diasDesde,
    fechaMasReciente,
    describirTareas
} = require('../utils/mantenimientoActivos');

/**
 * Mantenimientos (preventivo / correctivo), hoja de vida, traslados de puesto y flujo de baja con
 * observación obligatoria. Rutas en routes/activosTecnico.js; reglas puras en utils/mantenimientoActivos.js.
 *
 * Flujo de baja: el técnico solicita con observación → activo en `pendiente_baja` → el admin
 * aprueba (`dado_de_baja`) o rechaza (vuelve al estado anterior); el técnico puede cancelar su
 * propia solicitud mientras está pendiente. Todo queda en activo_solicitud_baja y en el historial.
 */

class ErrorNegocio extends Error {
    constructor(status, msg) {
        super(msg);
        this.status = status;
    }
}

const nombre = (n, u) => n || u || null;

function responderError(res, err, contexto) {
    if (err instanceof ErrorNegocio) {
        return res.status(err.status).json({ success: false, msg: err.message });
    }
    console.error(`Error al ${contexto}:`, err.message);
    return res.status(500).json({ success: false, msg: `Error del servidor al ${contexto}` });
}

/** Alerta de mantenimiento de un activo a partir de sus fechas (solo computadores). */
function alertaDeActivo(tipoActivo, fechas) {
    if (!esComputador(tipoActivo)) return null;
    const preventivo = fechas?.preventivo || null;
    const anterior = fechas?.anterior || null;
    const ultimo = fechaMasReciente(preventivo, anterior);
    return {
        nivel: nivelAlerta(ultimo),
        ultimoMantenimiento: ultimo,
        diasDesde: diasDesde(ultimo),
        // true si la fecha sale de una nota de mantenimiento anterior al registro nuevo
        deRegistroAnterior: Boolean(ultimo && ultimo === anterior && ultimo !== preventivo)
    };
}

/**
 * Agrega `alerta_mantenimiento` a la lista de activos de GET /api/activos-tecnico.
 * Lo usa activoTecnicoController.getActivosEditables.
 */
async function agregarAlertas(activos) {
    const mapa = await MantenimientoActivo.ultimosMantenimientos();
    return activos.map((a) => ({ ...a, alerta_mantenimiento: alertaDeActivo(a.tipo_activo, mapa.get(a.id)) }));
}

/**
 * @route   POST /api/activos-tecnico/:id/mantenimientos
 * @body    { tipo: 'preventivo'|'correctivo', pasta_termica, limpieza_componentes, formateo, descripcion }
 * Si el activo estaba "en mantenimiento", vuelve a "funcional".
 */
exports.registrarMantenimiento = async (req, res) => {
    try {
        const resultado = await MantenimientoActivo.enTransaccion(async (conn) => {
            const activo = await MantenimientoActivo.activoParaActualizar(conn, req.params.id);
            if (!activo) throw new ErrorNegocio(404, 'Activo no encontrado');
            if (['dado_de_baja', 'pendiente_baja'].includes(activo.estado)) {
                throw new ErrorNegocio(400, 'No se puede registrar mantenimiento a un equipo dado de baja o con baja pendiente');
            }
            const v = validarMantenimiento(req.body, activo.tipo_activo);
            if (!v.ok) throw new ErrorNegocio(400, v.error);

            const id = await MantenimientoActivo.crearMantenimiento(conn, activo, v.datos, req.user.id);
            let estadoNuevo = activo.estado;
            if (activo.estado === 'en_mantenimiento') {
                estadoNuevo = 'funcional';
                await MantenimientoActivo.cambiarEstado(conn, activo.id, activo.estado, estadoNuevo, req.user.id);
            }
            return { id, activo, estadoNuevo, tipo: v.datos.tipo };
        });

        res.status(201).json({
            success: true,
            msg: `Mantenimiento ${resultado.tipo} registrado para ${resultado.activo.numero_placa}`,
            data: { id: resultado.id, estado: resultado.estadoNuevo }
        });
    } catch (err) {
        responderError(res, err, 'registrar el mantenimiento');
    }
};

/**
 * @route   GET /api/activos-tecnico/:id/hoja-vida
 * Datos del equipo, componentes actuales, mantenimientos (con quién y cuándo), traslados,
 * cambios de componentes/estado y solicitudes de baja. El PDF lo arma el frontend con esto.
 */
exports.getHojaVida = async (req, res) => {
    try {
        const activo = await MantenimientoActivo.activo(req.params.id);
        if (!activo) return res.status(404).json({ success: false, msg: 'Activo no encontrado' });

        const [mantenimientos, anteriores, historial, solicitudes] = await Promise.all([
            MantenimientoActivo.mantenimientosDeActivo(activo.id),
            MantenimientoActivo.observacionesAnteriores(activo.id),
            MantenimientoActivo.historialDeActivo(activo.id),
            MantenimientoActivo.solicitudesBajaDeActivo(activo.id)
        ]);

        const ultimoPreventivo = mantenimientos.find((m) => m.tipo === 'preventivo')?.fecha || null;
        const ultimaNota = anteriores[0]?.fecha_creacion || null;

        const listaMantenimientos = [
            ...mantenimientos.map((m) => ({
                id: `m-${m.id}`,
                tipo: m.tipo,
                tareas: m.tipo === 'preventivo' ? describirTareas(m) : [],
                descripcion: m.descripcion,
                componentes: {
                    cpu_procesador: m.cpu_procesador,
                    memoria_ram: m.memoria_ram,
                    almacenamiento: m.almacenamiento,
                    sistema_operativo: m.sistema_operativo
                },
                puesto: m.puesto,
                realizadoPor: nombre(m.realizado_por_nombre, m.realizado_por_usuario),
                fecha: m.fecha
            })),
            ...anteriores.map((o) => ({
                id: `o-${o.id}`,
                tipo: 'registro_anterior',
                tareas: [],
                descripcion: o.observaciones,
                componentes: null,
                puesto: null,
                realizadoPor: nombre(o.realizado_por_nombre, o.realizado_por_usuario),
                fecha: o.fecha_creacion
            }))
        ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

        const mapHist = (h) => ({
            id: h.id,
            campo: h.campo_modificado,
            valorAnterior: h.valor_anterior,
            valorNuevo: h.valor_nuevo,
            modificadoPor: nombre(h.modificado_por_nombre, h.modificado_por_usuario),
            fecha: h.fecha_modificacion
        });

        res.json({
            success: true,
            data: {
                activo,
                alerta: alertaDeActivo(activo.tipo_activo, { preventivo: ultimoPreventivo, anterior: ultimaNota }),
                mantenimientos: listaMantenimientos,
                traslados: historial.filter((h) => ['puesto', 'site'].includes(h.campo_modificado)).map(mapHist),
                cambios: historial.filter((h) => !['puesto', 'site'].includes(h.campo_modificado)).map(mapHist),
                solicitudesBaja: solicitudes.map((s) => ({
                    id: s.id,
                    motivo: s.motivo,
                    estado: s.estado,
                    solicitadoPor: nombre(s.solicitado_por_nombre, s.solicitado_por_usuario),
                    fechaSolicitud: s.fecha_solicitud,
                    resueltoPor: nombre(s.resuelto_por_nombre, s.resuelto_por_usuario),
                    fechaResolucion: s.fecha_resolucion,
                    comentario: s.comentario_resolucion
                })),
                generadoEn: new Date().toISOString()
            }
        });
    } catch (err) {
        responderError(res, err, 'obtener la hoja de vida');
    }
};

/**
 * @route   PUT /api/activos-tecnico/:id/puesto
 * @body    { puesto, site? }
 */
exports.trasladarPuesto = async (req, res) => {
    try {
        const v = validarTraslado(req.body);
        if (!v.ok) return res.status(400).json({ success: false, msg: v.error });

        const { activo, cambios } = await MantenimientoActivo.enTransaccion(async (conn) => {
            const a = await MantenimientoActivo.activoParaActualizar(conn, req.params.id);
            if (!a) throw new ErrorNegocio(404, 'Activo no encontrado');
            if (a.estado === 'dado_de_baja') throw new ErrorNegocio(400, 'No se puede trasladar un equipo dado de baja');
            return { activo: a, cambios: await MantenimientoActivo.trasladar(conn, a, v.puesto, v.site, req.user.id) };
        });

        if (cambios.length === 0) {
            return res.status(400).json({ success: false, msg: 'El equipo ya está en ese puesto' });
        }
        res.json({
            success: true,
            msg: `${activo.numero_placa} trasladado al puesto ${v.puesto}`,
            data: { puesto: v.puesto, site: v.site === undefined ? activo.site : v.site }
        });
    } catch (err) {
        responderError(res, err, 'trasladar el equipo');
    }
};

/**
 * @route   POST /api/activos-tecnico/:id/solicitar-baja
 * @body    { motivo }  — observación obligatoria del técnico
 */
exports.solicitarBaja = async (req, res) => {
    try {
        const v = validarMotivoBaja(req.body?.motivo);
        if (!v.ok) return res.status(400).json({ success: false, msg: v.error });

        const activo = await MantenimientoActivo.enTransaccion(async (conn) => {
            const a = await MantenimientoActivo.activoParaActualizar(conn, req.params.id);
            if (!a) throw new ErrorNegocio(404, 'Activo no encontrado');
            if (a.estado === 'dado_de_baja') throw new ErrorNegocio(400, 'Este activo ya está dado de baja');
            if (a.estado === 'pendiente_baja') throw new ErrorNegocio(400, 'Este activo ya tiene una solicitud de baja pendiente');
            await MantenimientoActivo.crearSolicitudBaja(conn, a.id, v.motivo, a.estado, req.user.id);
            await MantenimientoActivo.cambiarEstado(conn, a.id, a.estado, 'pendiente_baja', req.user.id);
            return a;
        });

        res.json({
            success: true,
            msg: `Solicitud de baja para ${activo.numero_placa} enviada al administrador`,
            data: { estado: 'pendiente_baja' }
        });
    } catch (err) {
        responderError(res, err, 'solicitar la baja');
    }
};

/**
 * Cierra la solicitud pendiente y devuelve el activo a su estado anterior (o a funcional si la
 * solicitud es anterior a la migración 104 y no se sabe).
 */
async function devolverDeBaja(req, estadoSolicitud, comentario) {
    return MantenimientoActivo.enTransaccion(async (conn) => {
        const a = await MantenimientoActivo.activoParaActualizar(conn, req.params.id);
        if (!a) throw new ErrorNegocio(404, 'Activo no encontrado');
        if (a.estado !== 'pendiente_baja') throw new ErrorNegocio(400, 'Este activo no tiene una solicitud de baja pendiente');

        const solicitud = await MantenimientoActivo.solicitudPendiente(conn, a.id);
        const estadoRestaurado = solicitud?.estado_anterior && solicitud.estado_anterior !== 'pendiente_baja'
            ? solicitud.estado_anterior
            : 'funcional';
        if (solicitud) {
            await MantenimientoActivo.resolverSolicitud(conn, solicitud.id, estadoSolicitud, req.user.id, comentario);
        }
        await MantenimientoActivo.cambiarEstado(conn, a.id, a.estado, estadoRestaurado, req.user.id);
        return { activo: a, estadoRestaurado };
    });
}

/** @route POST /api/activos-tecnico/:id/cancelar-baja — el técnico retira su solicitud. */
exports.cancelarSolicitudBaja = async (req, res) => {
    try {
        const { activo, estadoRestaurado } = await devolverDeBaja(req, 'cancelada', null);
        res.json({
            success: true,
            msg: `Solicitud de baja de ${activo.numero_placa} cancelada`,
            data: { estado: estadoRestaurado }
        });
    } catch (err) {
        responderError(res, err, 'cancelar la solicitud de baja');
    }
};

/** @route PUT /api/activos-tecnico/:id/rechazar-baja (admin) — @body { comentario? } */
exports.rechazarBaja = async (req, res) => {
    try {
        const { activo, estadoRestaurado } = await devolverDeBaja(req, 'rechazada', normalizarComentario(req.body?.comentario));
        res.json({
            success: true,
            msg: `Solicitud de baja de ${activo.numero_placa} rechazada`,
            data: { estado: estadoRestaurado }
        });
    } catch (err) {
        responderError(res, err, 'rechazar la solicitud de baja');
    }
};

/**
 * @route   PUT /api/activos-tecnico/:id/dar-de-baja (admin)
 * @body    { comentario? }
 * Aprueba la solicitud pendiente. Si el admin da de baja directo (sin solicitud del técnico),
 * el comentario es obligatorio: todo equipo dado de baja queda con su observación.
 */
exports.darDeBaja = async (req, res) => {
    try {
        const comentario = normalizarComentario(req.body?.comentario);
        const activo = await MantenimientoActivo.enTransaccion(async (conn) => {
            const a = await MantenimientoActivo.activoParaActualizar(conn, req.params.id);
            if (!a) throw new ErrorNegocio(404, 'Activo no encontrado');
            if (a.estado === 'dado_de_baja') throw new ErrorNegocio(400, 'Este activo ya se encuentra dado de baja');

            const solicitud = a.estado === 'pendiente_baja' ? await MantenimientoActivo.solicitudPendiente(conn, a.id) : null;
            if (solicitud) {
                await MantenimientoActivo.resolverSolicitud(conn, solicitud.id, 'aprobada', req.user.id, comentario);
            } else {
                const v = validarMotivoBaja(comentario || '');
                if (!v.ok) throw new ErrorNegocio(400, v.error);
                // Baja directa del admin (o solicitud anterior a la 104): queda registrada como aprobada.
                const estadoAnterior = a.estado;
                const id = await MantenimientoActivo.crearSolicitudBaja(conn, a.id, v.motivo, estadoAnterior, req.user.id);
                await MantenimientoActivo.resolverSolicitud(conn, id, 'aprobada', req.user.id, null);
            }
            await MantenimientoActivo.cambiarEstado(conn, a.id, a.estado, 'dado_de_baja', req.user.id);
            return a;
        });

        res.json({
            success: true,
            msg: `Activo ${activo.numero_placa} dado de baja correctamente`,
            data: { id: activo.id, numeroPlaca: activo.numero_placa, estadoNuevo: 'dado_de_baja' }
        });
    } catch (err) {
        responderError(res, err, 'dar de baja el activo');
    }
};

/** @route GET /api/activos-tecnico/pendientes-baja (admin) — incluye la observación del técnico. */
exports.getPendientesBaja = async (req, res) => {
    try {
        const rows = await MantenimientoActivo.pendientesBaja();
        res.json({
            success: true,
            data: rows.map((r) => ({
                id: r.id,
                numeroPlaca: r.numero_placa,
                tipoActivo: r.tipo_activo,
                ubicacion: r.ubicacion,
                site: r.site,
                puesto: r.puesto,
                marcaModelo: r.marca_modelo,
                estado: r.estado,
                clasificacion: r.clasificacion,
                solicitudId: r.solicitud_id,
                motivo: r.motivo,
                solicitadoPor: r.solicitado_por || null,
                fechaSolicitud: r.fecha_solicitud || null
            }))
        });
    } catch (err) {
        responderError(res, err, 'obtener las solicitudes de baja');
    }
};

exports.agregarAlertas = agregarAlertas;
