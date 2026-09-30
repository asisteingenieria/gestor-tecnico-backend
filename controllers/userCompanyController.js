const UserCompany = require('../models/UserCompany');
const NovedadRrhh = require('../models/NovedadRrhh');
const Traspaso = require('../models/Traspaso');
const Vacaciones = require('../models/Vacaciones');
const Retiro = require('../models/Retiro');
const importEmpleadosExcel = require('../utils/importEmpleadosExcel');
const importEmpleadosService = require('../services/importEmpleadosService');

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

const CAMPOS_CONTRATO_OBLIGATORIOS = {
    campania_id: 'campaña',
    area_id: 'área',
    centro_costo_id: 'centro de costo',
    cargo_id: 'cargo',
    tipo_contrato_id: 'tipo de contrato',
    modalidad_id: 'modalidad',
    oleada_id: 'oleada',
    ciudad_id: 'ciudad del contrato',
    fecha_ingreso: 'fecha de ingreso'
};

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

function validarObligatorios(data) {
    if (!data.numero_identificacion || !data.tipo_identificacion_id || !data.primer_nombre || !data.primer_apellido) {
        return 'Los campos tipo de identificación, número de identificación, primer nombre y primer apellido son obligatorios';
    }

    const faltantes = Object.entries(CAMPOS_CONTRATO_OBLIGATORIOS)
        .filter(([campo]) => !data.contrato[campo])
        .map(([, nombre]) => nombre);
    if (faltantes.length > 0) {
        return `Faltan campos obligatorios del contrato: ${faltantes.join(', ')}`;
    }

    if (!data.salario.salario || Number(data.salario.salario) <= 0) {
        return 'El salario es obligatorio y debe ser mayor a cero';
    }

    const tarifaArl = data.seguridad_social?.tarifa_arl;
    if (tarifaArl !== undefined && tarifaArl !== null && tarifaArl !== '' &&
        (isNaN(Number(tarifaArl)) || Number(tarifaArl) < 0 || Number(tarifaArl) > 100)) {
        return 'La tarifa ARL debe ser un porcentaje entre 0 y 100';
    }

    return null;
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

            await UserCompany.delete(id);
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
            const { contrato_id, tipo_novedad_id, fecha_inicial } = req.body;
            if (!contrato_id || !tipo_novedad_id || !fecha_inicial) {
                return res.status(400).json({ success: false, message: 'contrato_id, tipo_novedad_id y fecha_inicial son obligatorios' });
            }
            const novedad = await NovedadRrhh.create(req.body);
            res.status(201).json({ success: true, message: 'Novedad creada exitosamente', novedad });
        } catch (error) {
            console.error('Error al crear novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateNovedad(req, res) {
        try {
            const { contrato_id, tipo_novedad_id, fecha_inicial } = req.body;
            if (!contrato_id || !tipo_novedad_id || !fecha_inicial) {
                return res.status(400).json({ success: false, message: 'contrato_id, tipo_novedad_id y fecha_inicial son obligatorios' });
            }
            const ok = await NovedadRrhh.update(req.params.novedadId, req.body);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            res.json({ success: true, message: 'Novedad actualizada exitosamente' });
        } catch (error) {
            console.error('Error al actualizar novedad:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async deleteNovedad(req, res) {
        try {
            const ok = await NovedadRrhh.delete(req.params.novedadId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Novedad no encontrada' });
            }
            res.json({ success: true, message: 'Novedad eliminada exitosamente' });
        } catch (error) {
            console.error('Error al eliminar novedad:', error);
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
            const { contrato_id, fecha_inicio } = req.body;
            if (!contrato_id || !fecha_inicio) {
                return res.status(400).json({ success: false, message: 'contrato_id y fecha_inicio son obligatorios' });
            }
            const traspaso = await Traspaso.create(req.body);
            res.status(201).json({ success: true, message: 'Traspaso creado exitosamente', traspaso });
        } catch (error) {
            console.error('Error al crear traspaso:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateTraspaso(req, res) {
        try {
            const { contrato_id, fecha_inicio } = req.body;
            if (!contrato_id || !fecha_inicio) {
                return res.status(400).json({ success: false, message: 'contrato_id y fecha_inicio son obligatorios' });
            }
            const ok = await Traspaso.update(req.params.traspasoId, req.body);
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
            const ok = await Traspaso.delete(req.params.traspasoId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Traspaso no encontrado' });
            }
            res.json({ success: true, message: 'Traspaso eliminado exitosamente' });
        } catch (error) {
            console.error('Error al eliminar traspaso:', error);
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
            const { contrato_id, fecha_corte } = req.body;
            if (!contrato_id || !fecha_corte) {
                return res.status(400).json({ success: false, message: 'contrato_id y fecha_corte son obligatorios' });
            }
            const vacaciones = await Vacaciones.create(req.body);
            res.status(201).json({ success: true, message: 'Registro de vacaciones creado exitosamente', vacaciones });
        } catch (error) {
            console.error('Error al crear vacaciones:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateVacaciones(req, res) {
        try {
            const { contrato_id, fecha_corte } = req.body;
            if (!contrato_id || !fecha_corte) {
                return res.status(400).json({ success: false, message: 'contrato_id y fecha_corte son obligatorios' });
            }
            const ok = await Vacaciones.update(req.params.vacacionesId, req.body);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Registro de vacaciones no encontrado' });
            }
            res.json({ success: true, message: 'Registro de vacaciones actualizado exitosamente' });
        } catch (error) {
            console.error('Error al actualizar vacaciones:', error);
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
