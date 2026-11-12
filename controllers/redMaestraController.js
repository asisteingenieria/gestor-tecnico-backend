const RedMaestra = require('../models/RedMaestra');
const redMaestra = require('../utils/redMaestra');
const { fechaLaboral, combinarFechaHora, sumarDias } = require('../utils/fechaBogota');
// Regla compartida con el retiro que registran los jefes (asistencia.md §59): función pura del dominio.
const { errorFechaRetiroRm } = require('../domain/asistencia/retirosEquipo');

const DIAS_INGRESOS = 30; // rango por defecto del historial de nuevos ingresos

/**
 * Red Maestra (RM) de Claro — solo el admin del Gestor (claude/modulo recursoshumanos.md §52).
 * DOCUMENTO, CÉDULA, NOMBRE, CAMPAÑA y USUARIO SSFF se leen de la ficha de RRHH y aquí no se editan.
 */

const CAMPOS_FICHA = ['estado_agente', 'cargo_rm', 'estado_rm'];
const CAMPOS_REQ = ['observacion', 'estado_requerimiento'];
const MAX_NOVEDADES = 2000;

const idOpcional = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : NaN;
};

const textoOpcional = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
};

const fechaValida = (v) => {
    if (v === null || v === undefined || v === '') return null;
    // Desde la API solo AAAA-MM-DD (fechaISO también acepta seriales de Excel, que aquí no aplican).
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return NaN;
    return redMaestra.fechaISO(String(v)) || NaN;
};

const error = (res, status, message) => res.status(status).json({ success: false, message });

/** Lee y valida los ids de lista del body: devuelve { valores } o { mensaje }. */
async function leerOpciones(body, campos) {
    const valores = {};
    for (const campo of campos) {
        const id = idOpcional(body[`${campo}_id`]);
        if (Number.isNaN(id)) return { mensaje: `${redMaestra.CAMPOS_OPCION[campo].etiqueta} no es válido` };
        valores[campo] = id;
    }
    const invalido = await RedMaestra.validarOpciones(valores);
    if (invalido) return { mensaje: `${redMaestra.CAMPOS_OPCION[invalido].etiqueta} no es una opción de esa lista` };
    return { valores };
}

/** Valida el body de un requerimiento: devuelve { data } o { mensaje }. */
async function leerRequerimiento(body) {
    const numero = textoOpcional(body.numero)?.toUpperCase();
    if (!numero) return { mensaje: 'El número de requerimiento es obligatorio' };
    if (numero.length > 40) return { mensaje: 'El número de requerimiento admite máximo 40 caracteres' };
    const fecha = fechaValida(body.fecha_envio);
    if (Number.isNaN(fecha)) return { mensaje: 'La fecha de envío no es válida' };
    const { valores, mensaje } = await leerOpciones(body, CAMPOS_REQ);
    if (mensaje) return { mensaje };
    return {
        data: {
            numero,
            fecha_envio: fecha,
            observacion_id: valores.observacion,
            estado_requerimiento_id: valores.estado_requerimiento
        }
    };
}

const redMaestraController = {
    async listar(req, res) {
        try {
            const registros = await RedMaestra.listar();
            res.json({ success: true, data: registros });
        } catch (e) {
            console.error('Error al listar la Red Maestra:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async getEmpleado(req, res) {
        try {
            const empleado = await RedMaestra.getEmpleado(req.params.id);
            if (!empleado) return error(res, 404, 'Empleado no encontrado');
            res.json({ success: true, data: empleado });
        } catch (e) {
            console.error('Error al obtener la ficha RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async guardarFicha(req, res) {
        try {
            const { id } = req.params;
            if (!(await RedMaestra.existeEmpleado(id))) return error(res, 404, 'Empleado no encontrado');
            const novedades = textoOpcional(req.body.novedades);
            if (novedades && novedades.length > MAX_NOVEDADES) {
                return error(res, 400, `Novedades admite máximo ${MAX_NOVEDADES} caracteres`);
            }
            const { valores, mensaje } = await leerOpciones(req.body, CAMPOS_FICHA);
            if (mensaje) return error(res, 400, mensaje);
            await RedMaestra.guardarFicha(id, {
                novedades,
                estado_agente_id: valores.estado_agente,
                cargo_rm_id: valores.cargo_rm,
                estado_rm_id: valores.estado_rm
            }, req.user.id);
            res.json({ success: true, data: await RedMaestra.getEmpleado(id) });
        } catch (e) {
            console.error('Error al guardar la ficha RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async crearRequerimiento(req, res) {
        try {
            const { id } = req.params;
            if (!(await RedMaestra.existeEmpleado(id))) return error(res, 404, 'Empleado no encontrado');
            const { data, mensaje } = await leerRequerimiento(req.body);
            if (mensaje) return error(res, 400, mensaje);
            if (await RedMaestra.buscarRequerimiento(id, data.numero)) {
                return error(res, 409, `El requerimiento ${data.numero} ya está registrado para este empleado`);
            }
            await RedMaestra.crearRequerimiento(id, data, req.user.id);
            res.status(201).json({ success: true, data: await RedMaestra.getEmpleado(id) });
        } catch (e) {
            console.error('Error al crear el requerimiento RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async actualizarRequerimiento(req, res) {
        try {
            const actual = await RedMaestra.getRequerimiento(req.params.reqId);
            if (!actual) return error(res, 404, 'Requerimiento no encontrado');
            const { data, mensaje } = await leerRequerimiento(req.body);
            if (mensaje) return error(res, 400, mensaje);
            if (await RedMaestra.buscarRequerimiento(actual.users_company_id, data.numero, actual.id)) {
                return error(res, 409, `El requerimiento ${data.numero} ya está registrado para este empleado`);
            }
            await RedMaestra.actualizarRequerimiento(actual.id, data);
            res.json({ success: true, data: await RedMaestra.getEmpleado(actual.users_company_id) });
        } catch (e) {
            console.error('Error al actualizar el requerimiento RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async eliminarRequerimiento(req, res) {
        try {
            const actual = await RedMaestra.getRequerimiento(req.params.reqId);
            if (!actual) return error(res, 404, 'Requerimiento no encontrado');
            await RedMaestra.eliminarRequerimiento(actual.id);
            res.json({ success: true, data: await RedMaestra.getEmpleado(actual.users_company_id) });
        } catch (e) {
            console.error('Error al eliminar el requerimiento RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    // ── Nuevos ingresos y retiros (§53) ──────────────────────────────────────────────────────

    /** Fichas de Claro registradas por RRHH entre dos fechas de Bogotá (por defecto, los últimos 30 días). */
    async ingresos(req, res) {
        try {
            const hoy = fechaLaboral(new Date());
            const hasta = req.query.hasta ? redMaestra.fechaISO(String(req.query.hasta)) : hoy;
            const desde = req.query.desde ? redMaestra.fechaISO(String(req.query.desde)) : sumarDias(hoy, -(DIAS_INGRESOS - 1));
            if (!desde || !hasta) return error(res, 400, 'Las fechas no son válidas');
            if (desde > hasta) return error(res, 400, 'La fecha inicial no puede ser posterior a la final');
            const filas = await RedMaestra.ingresos({
                desdeUtc: combinarFechaHora(desde, '00:00'),
                hastaUtc: combinarFechaHora(sumarDias(hasta, 1), '00:00')
            });
            res.json({ success: true, desde, hasta, data: filas });
        } catch (e) {
            console.error('Error al listar los nuevos ingresos RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async retiros(req, res) {
        try {
            const desde = req.query.desde ? redMaestra.fechaISO(String(req.query.desde)) : null;
            const hasta = req.query.hasta ? redMaestra.fechaISO(String(req.query.hasta)) : null;
            if ((req.query.desde && !desde) || (req.query.hasta && !hasta)) return error(res, 400, 'Las fechas no son válidas');
            res.json({ success: true, data: await RedMaestra.retiros({ desde, hasta }) });
        } catch (e) {
            console.error('Error al listar los retiros RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    /** El admin registra o corrige la fecha del retiro en la RM (la misma que registran los jefes). */
    async guardarRetiroRm(req, res) {
        try {
            const retiro = await RedMaestra.getRetiroClaro(req.params.id);
            if (!retiro) return error(res, 404, 'El empleado no tiene un retiro de Claro registrado por RRHH');
            const fecha = fechaValida(req.body.fecha_retiro_rm);
            if (Number.isNaN(fecha)) return error(res, 400, 'La fecha de retiro en la Red Maestra no es válida');
            const mensaje = errorFechaRetiroRm(fecha, { hoy: fechaLaboral(new Date()), fechaIngreso: retiro.fecha_ingreso });
            if (mensaje) return error(res, 400, mensaje);
            await RedMaestra.guardarFechaRetiroRm(retiro.id, fecha, req.user.id);
            res.json({ success: true, data: await RedMaestra.getEmpleado(retiro.id) });
        } catch (e) {
            console.error('Error al guardar el retiro RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    // ── Listas ────────────────────────────────────────────────────────────────────────────────

    async getOpciones(req, res) {
        try {
            res.json({
                success: true,
                data: await RedMaestra.getOpciones(),
                campos: Object.entries(redMaestra.CAMPOS_OPCION).map(([campo, c]) => ({ campo, etiqueta: c.etiqueta }))
            });
        } catch (e) {
            console.error('Error al obtener las listas RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async crearOpcion(req, res) {
        try {
            const { campo } = req.body;
            const valor = redMaestra.valorOpcion(req.body.valor);
            if (!redMaestra.CAMPOS_OPCION[campo]) return error(res, 400, 'Lista no válida');
            if (!valor) return error(res, 400, 'El valor es obligatorio');
            if (valor.length > 120) return error(res, 400, 'El valor admite máximo 120 caracteres');
            if (await RedMaestra.buscarOpcionPorValor(campo, valor)) return error(res, 409, `"${valor}" ya está en la lista`);
            const id = await RedMaestra.crearOpcion({ campo, valor });
            res.status(201).json({ success: true, data: await RedMaestra.getOpcion(id) });
        } catch (e) {
            console.error('Error al crear la opción RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async actualizarOpcion(req, res) {
        try {
            const actual = await RedMaestra.getOpcion(req.params.opcionId);
            if (!actual) return error(res, 404, 'Opción no encontrada');
            const cambios = {};
            if (req.body.valor !== undefined) {
                const valor = redMaestra.valorOpcion(req.body.valor);
                if (!valor) return error(res, 400, 'El valor es obligatorio');
                if (valor.length > 120) return error(res, 400, 'El valor admite máximo 120 caracteres');
                if (await RedMaestra.buscarOpcionPorValor(actual.campo, valor, actual.id)) {
                    return error(res, 409, `"${valor}" ya está en la lista`);
                }
                cambios.valor = valor;
            }
            if (req.body.activo !== undefined) cambios.activo = Boolean(req.body.activo);
            await RedMaestra.actualizarOpcion(actual.id, cambios);
            res.json({ success: true, data: await RedMaestra.getOpcion(actual.id) });
        } catch (e) {
            console.error('Error al actualizar la opción RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    // ── Excel ─────────────────────────────────────────────────────────────────────────────────

    async exportar(req, res) {
        try {
            const [registros, requerimientos] = await Promise.all([RedMaestra.listar(), RedMaestra.getTodosRequerimientos()]);
            const buffer = redMaestra.generarLibro(registros, requerimientos);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="red_maestra_${fechaLaboral(new Date())}.xlsx"`);
            res.send(buffer);
        } catch (e) {
            console.error('Error al exportar la Red Maestra:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    /** Lee el archivo y lo resuelve contra el Gestor. Lo comparten la vista previa y la confirmación. */
    async _resolverArchivo(req) {
        if (!req.file) return { status: 400, mensaje: 'Adjunta el archivo Excel' };
        let leido;
        try {
            leido = redMaestra.parsearArchivo(req.file.buffer);
        } catch (e) {
            return { status: 400, mensaje: 'No se pudo leer el archivo. ¿Es un Excel válido?' };
        }
        if (leido.faltantes.length) {
            return { status: 400, mensaje: `Al archivo le falta la columna ${leido.faltantes.join(', ')}` };
        }
        if (!leido.filas.length) return { status: 400, mensaje: 'El archivo no tiene filas con datos' };
        const [empleados, opciones] = await Promise.all([RedMaestra.getEmpleadosParaCargue(), RedMaestra.getOpciones()]);
        const resuelto = redMaestra.resolverFilas(leido.filas, empleados, opciones);
        const validas = resuelto.filas.filter((f) => !f.errores.length);
        // Solo se crean las opciones nuevas que usan filas que sí se van a cargar.
        const usadas = new Set(validas.flatMap((f) => Object.entries(f.ids).filter(([, v]) => v && v.nuevo).map(([c, v]) => `${c}|${v.nuevo}`)));
        const opcionesNuevas = resuelto.opciones_nuevas.filter((o) => usadas.has(`${o.campo}|${o.valor}`));
        return { leido, filas: resuelto.filas, validas, opcionesNuevas };
    },

    async previewCargue(req, res) {
        try {
            const r = await redMaestraController._resolverArchivo(req);
            if (r.mensaje) return error(res, r.status, r.mensaje);
            res.json({
                success: true,
                data: {
                    hoja: r.leido.hoja,
                    total_filas: r.filas.length,
                    a_cargar: r.validas.length,
                    con_errores: r.filas.length - r.validas.length,
                    con_requerimiento: r.validas.filter((f) => f.requerimiento).length,
                    opciones_nuevas: r.opcionesNuevas.map((o) => ({ ...o, etiqueta: redMaestra.CAMPOS_OPCION[o.campo].etiqueta })),
                    filas: r.filas.map((f) => ({
                        fila: f.fila,
                        cedula: f.cedula,
                        nombre: f.nombre_gestor || f.nombre,
                        estado_rm: f.estado_rm,
                        requerimiento: f.requerimiento,
                        errores: f.errores,
                        advertencias: f.advertencias
                    }))
                }
            });
        } catch (e) {
            console.error('Error en la vista previa del cargue RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    },

    async confirmarCargue(req, res) {
        try {
            const r = await redMaestraController._resolverArchivo(req);
            if (r.mensaje) return error(res, r.status, r.mensaje);
            if (!r.validas.length) return error(res, 400, 'Ninguna fila se puede cargar: revisa los errores');
            const resultado = await RedMaestra.aplicarCargue(r.validas, r.opcionesNuevas, req.user.id);
            res.json({ success: true, data: { ...resultado, omitidas: r.filas.length - r.validas.length } });
        } catch (e) {
            console.error('Error al confirmar el cargue RM:', e);
            error(res, 500, 'Error interno del servidor');
        }
    }
};

module.exports = redMaestraController;
