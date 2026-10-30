const UserCompany = require('../models/UserCompany');
const NovedadRrhh = require('../models/NovedadRrhh');
const Traspaso = require('../models/Traspaso');
const Vacaciones = require('../models/Vacaciones');
const Retiro = require('../models/Retiro');
const EmpleadoDocumento = require('../models/EmpleadoDocumento');
const importEmpleadosExcel = require('../utils/importEmpleadosExcel');
const importEmpleadosService = require('../services/importEmpleadosService');
const { validarObligatorios } = require('../utils/validarEmpleado');
const fs = require('fs');
const { soportesNovedad, soportesTraspaso, documentosEmpleado } = require('../middleware/uploadSoportesRrhh');
const { fechaLaboral } = require('../utils/fechaBogota');

const { prepararTraspaso, ETIQUETAS: ETIQUETAS_TRASPASO } = require('../utils/camposTraspaso');

// Valida un traspaso según su tipo (hoja "TRASPASOS", migración 070) y deja en NULL lo que no
// aplica. Devuelve { error } o { datos }.
async function prepararPayloadTraspaso(body) {
    if (!body.contrato_id) return { error: 'Selecciona un empleado con contrato' };
    if (!body.tipo_traspaso_id) return { error: 'El tipo de traspaso es obligatorio' };
    const codigo = await Traspaso.codigoDeTipo(body.tipo_traspaso_id);
    if (!codigo) return { error: 'Tipo de traspaso inválido' };
    const { datos, faltantes } = prepararTraspaso(codigo, body);
    if (faltantes.length) return { error: `Faltan datos para este tipo de traspaso: ${faltantes.map(f => ETIQUETAS_TRASPASO[f] || f).join(', ')}` };
    return { datos };
}

// Un ID de catálogo o de contrato que no existe llega a MySQL como violación de FK: es un dato
// inválido del cliente (400), no un error del servidor.
const esReferenciaInvalida = (error) => error.status === 400 || error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW';
const MENSAJE_REFERENCIA_INVALIDA = 'Alguno de los datos seleccionados (empleado, contrato o catálogo) no existe';

// Un archivo que no es Excel (o un Excel sin la hoja de empleados) se leía como "0 filas" y la
// previsualización salía en blanco sin explicar nada.
const ARCHIVO_SIN_EMPLEADOS = 'El archivo no tiene filas de empleados: revisa que sea el Excel de la plantilla (hoja "TOTAL PERSONAL")';

const fechaDia = (f) => (f ? String(f).slice(0, 10) : '');

function validarNovedad({ contrato_id, tipo_novedad_id, fecha_inicial, fecha_final, fecha_retorno, total_dias }) {
    if (!contrato_id || !tipo_novedad_id || !fecha_inicial) return 'contrato_id, tipo_novedad_id y fecha_inicial son obligatorios';
    if (fecha_final && fechaDia(fecha_final) < fechaDia(fecha_inicial)) return 'La fecha final no puede ser anterior a la fecha inicial';
    if (fecha_retorno && fechaDia(fecha_retorno) < fechaDia(fecha_inicial)) return 'La fecha de retorno no puede ser anterior a la fecha inicial';
    if (Number(total_dias) < 0) return 'El total de días no puede ser negativo';
    return null;
}

function validarVacaciones(body) {
    if (!body.contrato_id || !body.fecha_corte) return 'contrato_id y fecha_corte son obligatorios';
    for (const campo of ['dias_trabajados', 'dias_acumulados', 'dias_tomados', 'dias_compensados', 'pasivo_vacacional']) {
        if (Number(body[campo]) < 0) return 'Los días y el pasivo vacacional no pueden ser negativos';
    }
    for (const periodo of (body.periodos || [])) {
        if (periodo.fecha_inicio && periodo.fecha_final && fechaDia(periodo.fecha_final) < fechaDia(periodo.fecha_inicio)) {
            return `El periodo ${periodo.periodo_tomado || ''} termina antes de empezar`.replace('  ', ' ');
        }
    }
    return null;
}

const rutaArchivoSoporte = soportesNovedad.ruta;
const borrarArchivoSoporte = soportesNovedad.borrar;

// Envía un archivo de soporte (novedad o traspaso) con su nombre original, para verlo en el navegador.
// Los primeros bytes de un PDF son "%PDF-".
async function empiezaComoPdf(ruta) {
    const handle = await fs.promises.open(ruta, 'r');
    try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(5), 0, 5, 0);
        return bytesRead === 5 && buffer.toString('latin1') === '%PDF-';
    } finally {
        await handle.close();
    }
}

function enviarSoporte(res, soporte, ruta) {
    if (!ruta || !fs.existsSync(ruta)) {
        return res.status(404).json({ success: false, message: 'Soporte no encontrado' });
    }
    res.setHeader('Content-Type', soporte.mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(soporte.nombre_original)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(ruta);
}

const CAMPOS_PERSONALES = [
    'numero_identificacion', 'tipo_identificacion_id',
    'numero_identificacion_secundaria', 'tipo_identificacion_secundaria_id',
    'fecha_expedicion', 'ciudad_expedicion_id',
    'primer_nombre', 'segundo_nombre', 'primer_apellido', 'segundo_apellido',
    'fecha_nacimiento', 'ciudad_nacimiento_id', 'numero_hijos',
    'estado_civil_id', 'grupo_sanguineo_id', 'genero_id',
    'email', 'telefono', 'usuario_ssff', 'rut',
    'declarante_renta', 'libreta_militar_numero'
];

function extraerCampos(body) {
    const data = {};
    for (const campo of CAMPOS_PERSONALES) {
        data[campo] = body[campo];
    }
    data.contrato = body.contrato || {};
    data.salario = body.salario || {};
    data.seguridad_social = body.seguridad_social || {};
    data.cuenta_bancaria = body.cuenta_bancaria || {};
    data.direccion = body.direccion || {};
    data.contacto_emergencia = body.contacto_emergencia || {};
    data.vacunacion = body.vacunacion || null;
    data.dotacion = body.dotacion || null;
    data.recursos = body.recursos || null;
    return data;
}

const userCompanyController = {
    async getAll(req, res) {
        try {
            const soloSinUsuario = req.query.sin_usuario === 'true';
            const empleados = await UserCompany.getAll({ soloSinUsuario });
            res.json({ empleados });
        } catch (error) {
            console.error('Error al obtener empleados:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getById(req, res) {
        try {
            const empleado = await UserCompany.getByIdCompleto(req.params.id);
            if (!empleado) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }
            res.json({ empleado });
        } catch (error) {
            console.error('Error al obtener empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getCatalogos(req, res) {
        try {
            const catalogos = await UserCompany.getCatalogos();
            res.json({ catalogos });
        } catch (error) {
            console.error('Error al obtener catálogos:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async create(req, res) {
        try {
            const data = extraerCampos(req.body);
            // Analista encargado = quien registra el empleado, tomado del login (no del
            // formulario) — por eso se pisa aquí sin importar lo que traiga el body.
            data.contrato.analista_encargado_id = req.user.users_company_id || null;

            const errorValidacion = validarObligatorios(data);
            if (errorValidacion) {
                return res.status(400).json({ success: false, message: errorValidacion });
            }

            const empleado = await UserCompany.create(data);
            res.status(201).json({ success: true, message: 'Empleado creado exitosamente', empleado });
        } catch (error) {
            console.error('Error al crear empleado:', error);
            if (error.message.includes('Ya existe')) {
                return res.status(409).json({ success: false, message: error.message, type: 'DUPLICATE_IDENTIFICACION' });
            }
            if (esReferenciaInvalida(error)) {
                return res.status(400).json({ success: false, message: error.status === 400 ? error.message : MENSAJE_REFERENCIA_INVALIDA });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async update(req, res) {
        try {
            const { id } = req.params;
            const data = extraerCampos(req.body);

            const existe = await UserCompany.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }

            const errorValidacion = validarObligatorios(data);
            if (errorValidacion) {
                return res.status(400).json({ success: false, message: errorValidacion });
            }

            const actualizado = await UserCompany.update(id, data);
            if (!actualizado) {
                return res.status(404).json({ success: false, message: 'No se pudo actualizar el empleado' });
            }
            res.json({ success: true, message: 'Empleado actualizado exitosamente' });
        } catch (error) {
            console.error('Error al actualizar empleado:', error);
            if (error.message.includes('Ya existe')) {
                return res.status(409).json({ success: false, message: error.message, type: 'DUPLICATE_IDENTIFICACION' });
            }
            if (esReferenciaInvalida(error)) {
                return res.status(400).json({ success: false, message: error.status === 400 ? error.message : MENSAJE_REFERENCIA_INVALIDA });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async delete(req, res) {
        try {
            const { id } = req.params;

            const existe = await UserCompany.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }

            // Las novedades y traspasos caen por CASCADE con el contrato, pero sus archivos de
            // soporte están en disco: se recogen antes y se borran después del commit.
            const archivosNovedades = await NovedadRrhh.archivosDeEmpleado(id);
            const archivosTraspasos = await Traspaso.archivosDeEmpleado(id);
            const archivosDocumentos = await EmpleadoDocumento.archivosDeEmpleado(id);
            await UserCompany.delete(id);
            archivosNovedades.forEach(borrarArchivoSoporte);
            archivosTraspasos.forEach(soportesTraspaso.borrar);
            archivosDocumentos.forEach(documentosEmpleado.borrar);
            res.json({ success: true, message: 'Empleado eliminado exitosamente. Los activos asignados quedaron sin empleado.' });
        } catch (error) {
            console.error('Error al eliminar empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ==================== IMPORT MASIVO DESDE EXCEL ====================

    async previewImportExcel(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
            }
            const { filas, errores_parseo } = importEmpleadosExcel.parsearArchivo(req.file.buffer);
            if (filas.length === 0 && errores_parseo.length === 0) {
                return res.status(400).json({ success: false, message: ARCHIVO_SIN_EMPLEADOS });
            }
            const reporte = await importEmpleadosService.previsualizar(filas);
            res.json({ success: true, errores_parseo, ...reporte });
        } catch (error) {
            console.error('Error al previsualizar import de empleados:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async commitImportExcel(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
            }
            const { filas, errores_parseo } = importEmpleadosExcel.parsearArchivo(req.file.buffer);
            if (filas.length === 0 && errores_parseo.length === 0) {
                return res.status(400).json({ success: false, message: ARCHIVO_SIN_EMPLEADOS });
            }
            const reporte = await importEmpleadosService.confirmar(filas);
            res.json({ success: true, message: 'Importación completada', errores_parseo, ...reporte });
        } catch (error) {
            console.error('Error al confirmar import de empleados:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getGastoTotal(req, res) {
        try {
            const gasto = await UserCompany.getGastoTotal();
            res.json({ gasto });
        } catch (error) {
            console.error('Error al obtener gasto total:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getActivos(req, res) {
        try {
            const { id } = req.params;

            const existe = await UserCompany.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }

            const activos = await UserCompany.getActivos(id);
            res.json({ empleado: existe, activos });
        } catch (error) {
            console.error('Error al obtener activos del empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async assignActivo(req, res) {
        try {
            const { id, activoId } = req.params;

            const empleado = await UserCompany.getById(id);
            if (!empleado) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }

            const ok = await UserCompany.assignActivo(id, activoId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Activo no encontrado' });
            }
            res.json({ success: true, message: 'Activo asignado exitosamente' });
        } catch (error) {
            console.error('Error al asignar activo:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async unassignActivo(req, res) {
        try {
            const { id, activoId } = req.params;

            const empleado = await UserCompany.getById(id);
            if (!empleado) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }

            const ok = await UserCompany.unassignActivo(activoId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Activo no encontrado' });
            }
            res.json({ success: true, message: 'Activo desasignado exitosamente' });
        } catch (error) {
            console.error('Error al desasignar activo:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ==================== NOVEDADES RRHH ====================

    async getNovedades(req, res) {
        try {
            const { contrato_id, tipo_novedad_id, desde, hasta } = req.query;
            const novedades = await NovedadRrhh.getAll({ contrato_id, tipo_novedad_id, desde, hasta });
            res.json({ novedades });
        } catch (error) {
            console.error('Error al obtener novedades:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getNovedadById(req, res) {
        try {
            const novedad = await NovedadRrhh.getById(req.params.novedadId);
            if (!novedad) {
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            res.json({ novedad });
        } catch (error) {
            console.error('Error al obtener novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async createNovedad(req, res) {
        try {
            const errorValidacion = validarNovedad(req.body);
            if (errorValidacion) {
                return res.status(400).json({ success: false, message: errorValidacion });
            }
            const novedad = await NovedadRrhh.create(req.body);
            res.status(201).json({ success: true, message: 'Novedad creada exitosamente', novedad });
        } catch (error) {
            console.error('Error al crear novedad:', error);
            if (esReferenciaInvalida(error)) {
                return res.status(400).json({ success: false, message: error.status === 400 ? error.message : MENSAJE_REFERENCIA_INVALIDA });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateNovedad(req, res) {
        try {
            const errorValidacion = validarNovedad(req.body);
            if (errorValidacion) {
                return res.status(400).json({ success: false, message: errorValidacion });
            }
            const ok = await NovedadRrhh.update(req.params.novedadId, req.body);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            res.json({ success: true, message: 'Novedad actualizada exitosamente' });
        } catch (error) {
            console.error('Error al actualizar novedad:', error);
            if (esReferenciaInvalida(error)) {
                return res.status(400).json({ success: false, message: error.status === 400 ? error.message : MENSAJE_REFERENCIA_INVALIDA });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async deleteNovedad(req, res) {
        try {
            const archivos = await NovedadRrhh.archivosDeNovedad(req.params.novedadId);
            const ok = await NovedadRrhh.delete(req.params.novedadId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            archivos.forEach(borrarArchivoSoporte);
            res.json({ success: true, message: 'Novedad eliminada exitosamente' });
        } catch (error) {
            console.error('Error al eliminar novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ---- Soportes documentales de una novedad (PDF o imagen, migración 069) ----

    async getSoportesNovedad(req, res) {
        try {
            if (!await NovedadRrhh.getById(req.params.novedadId)) {
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            res.json({ soportes: await NovedadRrhh.getSoportes(req.params.novedadId) });
        } catch (error) {
            console.error('Error al obtener soportes de la novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async subirSoporteNovedad(req, res) {
        const { novedadId, tipoSoporteId } = req.params;
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Falta el archivo del soporte' });
            }
            if (!await NovedadRrhh.getById(novedadId)) {
                borrarArchivoSoporte(req.file.filename);
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            if (!await NovedadRrhh.soporteAplica(novedadId, tipoSoporteId)) {
                borrarArchivoSoporte(req.file.filename);
                return res.status(400).json({ success: false, message: 'Ese soporte no aplica al tipo de esta novedad' });
            }
            const anterior = await NovedadRrhh.guardarSoporte(novedadId, tipoSoporteId, {
                nombre: req.file.filename, nombreOriginal: req.file.originalname, mime: req.file.mimetype, tamano: req.file.size
            }, req.user?.id);
            if (anterior) borrarArchivoSoporte(anterior);
            res.status(201).json({ success: true, message: 'Soporte cargado', soportes: await NovedadRrhh.getSoportes(novedadId) });
        } catch (error) {
            if (req.file) borrarArchivoSoporte(req.file.filename);
            console.error('Error al cargar soporte de la novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async descargarSoporteNovedad(req, res) {
        try {
            const soporte = await NovedadRrhh.getSoporte(req.params.novedadId, req.params.tipoSoporteId);
            enviarSoporte(res, soporte, soporte && rutaArchivoSoporte(soporte.archivo));
        } catch (error) {
            console.error('Error al descargar soporte de la novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async eliminarSoporteNovedad(req, res) {
        try {
            const archivo = await NovedadRrhh.eliminarSoporte(req.params.novedadId, req.params.tipoSoporteId);
            if (!archivo) {
                return res.status(404).json({ success: false, message: 'Soporte no encontrado' });
            }
            borrarArchivoSoporte(archivo);
            res.json({ success: true, message: 'Soporte eliminado', soportes: await NovedadRrhh.getSoportes(req.params.novedadId) });
        } catch (error) {
            console.error('Error al eliminar soporte de la novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ==================== DOCUMENTOS DEL EMPLEADO (migración 088) ====================
    // Documentación del empleado y contrato y anexos: un PDF unificado por tipo, hasta 50 MB.

    async getDocumentosEmpleado(req, res) {
        try {
            if (!await UserCompany.getById(req.params.id)) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }
            res.json({ success: true, documentos: await EmpleadoDocumento.getByEmpleado(req.params.id) });
        } catch (error) {
            console.error('Error al obtener documentos del empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async subirDocumentoEmpleado(req, res) {
        const { id, tipo } = req.params;
        const descartar = () => req.file && documentosEmpleado.borrar(req.file.filename);
        try {
            if (!EmpleadoDocumento.esTipoValido(tipo)) {
                descartar();
                return res.status(400).json({ success: false, message: 'Tipo de documento no válido' });
            }
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Falta el archivo PDF' });
            }
            // El mime lo declara el navegador: se comprueba que el contenido sea de verdad un PDF.
            if (!await empiezaComoPdf(req.file.path)) {
                descartar();
                return res.status(400).json({ success: false, message: 'El archivo no es un PDF válido' });
            }
            if (!await UserCompany.getById(id)) {
                descartar();
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }
            const anterior = await EmpleadoDocumento.guardar(id, tipo, {
                nombre: req.file.filename, nombreOriginal: req.file.originalname, mime: req.file.mimetype, tamano: req.file.size
            }, req.user?.id);
            if (anterior) documentosEmpleado.borrar(anterior);
            res.status(201).json({ success: true, message: 'Documento cargado', documentos: await EmpleadoDocumento.getByEmpleado(id) });
        } catch (error) {
            descartar();
            console.error('Error al cargar documento del empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async descargarDocumentoEmpleado(req, res) {
        try {
            if (!EmpleadoDocumento.esTipoValido(req.params.tipo)) {
                return res.status(404).json({ success: false, message: 'Documento no encontrado' });
            }
            const documento = await EmpleadoDocumento.get(req.params.id, req.params.tipo);
            enviarSoporte(res, documento, documento && documentosEmpleado.ruta(documento.archivo));
        } catch (error) {
            console.error('Error al descargar documento del empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async eliminarDocumentoEmpleado(req, res) {
        try {
            const archivo = EmpleadoDocumento.esTipoValido(req.params.tipo)
                ? await EmpleadoDocumento.eliminar(req.params.id, req.params.tipo)
                : null;
            if (!archivo) {
                return res.status(404).json({ success: false, message: 'Documento no encontrado' });
            }
            documentosEmpleado.borrar(archivo);
            res.json({ success: true, message: 'Documento eliminado', documentos: await EmpleadoDocumento.getByEmpleado(req.params.id) });
        } catch (error) {
            console.error('Error al eliminar documento del empleado:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ==================== TRASPASOS ====================

    async getTraspasos(req, res) {
        try {
            const { contrato_id, desde, hasta } = req.query;
            const traspasos = await Traspaso.getAll({ contrato_id, desde, hasta });
            res.json({ traspasos });
        } catch (error) {
            console.error('Error al obtener traspasos:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getTraspasoById(req, res) {
        try {
            const traspaso = await Traspaso.getById(req.params.traspasoId);
            if (!traspaso) {
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            res.json({ traspaso });
        } catch (error) {
            console.error('Error al obtener traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async createTraspaso(req, res) {
        try {
            const { error, datos } = await prepararPayloadTraspaso(req.body);
            if (error) return res.status(400).json({ success: false, message: error });
            const traspaso = await Traspaso.create(datos, { hoy: fechaLaboral(new Date()), userId: req.user?.id });
            res.status(201).json({ success: true, message: 'Traspaso creado exitosamente', traspaso });
        } catch (error) {
            console.error('Error al crear traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateTraspaso(req, res) {
        try {
            const { error, datos } = await prepararPayloadTraspaso(req.body);
            if (error) return res.status(400).json({ success: false, message: error });
            const ok = await Traspaso.update(req.params.traspasoId, datos, { hoy: fechaLaboral(new Date()), userId: req.user?.id });
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            res.json({ success: true, message: 'Traspaso actualizado exitosamente' });
        } catch (error) {
            console.error('Error al actualizar traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async deleteTraspaso(req, res) {
        try {
            const archivos = await Traspaso.archivosDeTraspaso(req.params.traspasoId);
            const ok = await Traspaso.delete(req.params.traspasoId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            archivos.forEach(soportesTraspaso.borrar);
            res.json({ success: true, message: 'Traspaso eliminado exitosamente' });
        } catch (error) {
            console.error('Error al eliminar traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ---- Alertas de traspasos (migración 070) ----

    async getAlertasTraspasos(req, res) {
        try {
            res.json({ alertas: await Traspaso.getAlertas(fechaLaboral(new Date())) });
        } catch (error) {
            console.error('Error al obtener alertas de traspasos:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async reenviarAlertaEvaluacion(req, res) {
        try {
            if (!await Traspaso.getById(req.params.traspasoId)) {
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            const ok = await Traspaso.reenviarAlertaEvaluacion(req.params.traspasoId, { hoy: fechaLaboral(new Date()), userId: req.user?.id });
            if (!ok) {
                return res.status(409).json({ success: false, message: 'No hay evaluación pendiente: el traspaso no es una ratificación o ya tiene el formato de evaluación' });
            }
            res.json({ success: true, message: 'Recordatorio enviado al director' });
        } catch (error) {
            console.error('Error al reenviar alerta de evaluación:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ---- Documentos de un traspaso (PDF o imagen, migración 070) ----

    async getSoportesTraspaso(req, res) {
        try {
            if (!await Traspaso.getById(req.params.traspasoId)) {
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            res.json({ soportes: await Traspaso.getSoportes(req.params.traspasoId) });
        } catch (error) {
            console.error('Error al obtener documentos del traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async subirSoporteTraspaso(req, res) {
        const { traspasoId, tipoSoporteId } = req.params;
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'Falta el archivo del documento' });
            }
            if (!await Traspaso.getById(traspasoId)) {
                soportesTraspaso.borrar(req.file.filename);
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            if (!await Traspaso.soporteAplica(traspasoId, tipoSoporteId)) {
                soportesTraspaso.borrar(req.file.filename);
                return res.status(400).json({ success: false, message: 'Ese documento no aplica al tipo de este traspaso' });
            }
            const anterior = await Traspaso.guardarSoporte(traspasoId, tipoSoporteId, {
                nombre: req.file.filename, nombreOriginal: req.file.originalname, mime: req.file.mimetype, tamano: req.file.size
            }, req.user?.id);
            if (anterior) soportesTraspaso.borrar(anterior);
            res.status(201).json({ success: true, message: 'Documento cargado', soportes: await Traspaso.getSoportes(traspasoId) });
        } catch (error) {
            if (req.file) soportesTraspaso.borrar(req.file.filename);
            console.error('Error al cargar documento del traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async descargarSoporteTraspaso(req, res) {
        try {
            const soporte = await Traspaso.getSoporte(req.params.traspasoId, req.params.tipoSoporteId);
            enviarSoporte(res, soporte, soporte && soportesTraspaso.ruta(soporte.archivo));
        } catch (error) {
            console.error('Error al descargar documento del traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async eliminarSoporteTraspaso(req, res) {
        try {
            const archivo = await Traspaso.eliminarSoporte(req.params.traspasoId, req.params.tipoSoporteId);
            if (!archivo) {
                return res.status(404).json({ success: false, message: 'Documento no encontrado' });
            }
            soportesTraspaso.borrar(archivo);
            res.json({ success: true, message: 'Documento eliminado', soportes: await Traspaso.getSoportes(req.params.traspasoId) });
        } catch (error) {
            console.error('Error al eliminar documento del traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ==================== PASIVO VACACIONAL ====================

    async getVacaciones(req, res) {
        try {
            const { contrato_id } = req.query;
            const vacaciones = await Vacaciones.getAll({ contrato_id });
            res.json({ vacaciones });
        } catch (error) {
            console.error('Error al obtener vacaciones:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getVacacionesById(req, res) {
        try {
            const vacaciones = await Vacaciones.getById(req.params.vacacionesId);
            if (!vacaciones) {
                return res.status(404).json({ success: false, message: 'Registro de vacaciones no encontrado' });
            }
            res.json({ vacaciones });
        } catch (error) {
            console.error('Error al obtener vacaciones:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async createVacaciones(req, res) {
        try {
            const errorValidacion = validarVacaciones(req.body);
            if (errorValidacion) {
                return res.status(400).json({ success: false, message: errorValidacion });
            }
            const vacaciones = await Vacaciones.create(req.body);
            res.status(201).json({ success: true, message: 'Registro de vacaciones creado exitosamente', vacaciones });
        } catch (error) {
            console.error('Error al crear vacaciones:', error);
            if (esReferenciaInvalida(error)) {
                return res.status(400).json({ success: false, message: error.status === 400 ? error.message : MENSAJE_REFERENCIA_INVALIDA });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateVacaciones(req, res) {
        try {
            const errorValidacion = validarVacaciones(req.body);
            if (errorValidacion) {
                return res.status(400).json({ success: false, message: errorValidacion });
            }
            const ok = await Vacaciones.update(req.params.vacacionesId, req.body);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Registro de vacaciones no encontrado' });
            }
            res.json({ success: true, message: 'Registro de vacaciones actualizado exitosamente' });
        } catch (error) {
            console.error('Error al actualizar vacaciones:', error);
            if (esReferenciaInvalida(error)) {
                return res.status(400).json({ success: false, message: error.status === 400 ? error.message : MENSAJE_REFERENCIA_INVALIDA });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async deleteVacaciones(req, res) {
        try {
            const ok = await Vacaciones.delete(req.params.vacacionesId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Registro de vacaciones no encontrado' });
            }
            res.json({ success: true, message: 'Registro de vacaciones eliminado exitosamente' });
        } catch (error) {
            console.error('Error al eliminar vacaciones:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    // ==================== RETIRO ====================

    async getRetiro(req, res) {
        try {
            const { id } = req.params;
            const existe = await UserCompany.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }
            const retiro = await Retiro.getByUserCompanyId(id);
            res.json({ retiro });
        } catch (error) {
            console.error('Error al obtener retiro:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async registrarRetiro(req, res) {
        try {
            const { id } = req.params;
            const { fecha_retiro, tipo_retiro_id } = req.body;
            if (!fecha_retiro || !tipo_retiro_id) {
                return res.status(400).json({ success: false, message: 'La fecha de retiro y el tipo de retiro son obligatorios' });
            }
            const existe = await UserCompany.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
            }
            await Retiro.registrar(id, req.body);
            res.status(201).json({ success: true, message: 'Retiro registrado exitosamente' });
        } catch (error) {
            console.error('Error al registrar retiro:', error);
            if (error.status === 400) {
                return res.status(400).json({ success: false, message: error.message });
            }
            if (error.message.includes('ya tiene un retiro') || error.message.includes('no tiene contrato')) {
                return res.status(409).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async actualizarRetiro(req, res) {
        try {
            const { id } = req.params;
            const { fecha_retiro, tipo_retiro_id } = req.body;
            if (!fecha_retiro || !tipo_retiro_id) {
                return res.status(400).json({ success: false, message: 'La fecha de retiro y el tipo de retiro son obligatorios' });
            }
            await Retiro.actualizar(id, req.body);
            res.json({ success: true, message: 'Retiro actualizado exitosamente' });
        } catch (error) {
            console.error('Error al actualizar retiro:', error);
            if (error.status === 400) {
                return res.status(400).json({ success: false, message: error.message });
            }
            if (error.message.includes('no tiene un retiro')) {
                return res.status(404).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async reactivarEmpleado(req, res) {
        try {
            const { id } = req.params;
            await Retiro.reactivar(id);
            res.json({ success: true, message: 'Empleado reactivado exitosamente' });
        } catch (error) {
            console.error('Error al reactivar empleado:', error);
            if (error.message.includes('no tiene un retiro') || error.message.includes('no tiene contrato')) {
                return res.status(404).json({ success: false, message: error.message });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    }
};

module.exports = userCompanyController;
