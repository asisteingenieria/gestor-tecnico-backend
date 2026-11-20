const Activo = require('../models/Activo');
const ActivoHistorial = require('../models/ActivoHistorial');
const path = require('path');
const fs = require('fs');

// Campos que, si cambian desde el formulario del gestor, quedan en activos_historial
// (traslados de puesto, estado y componentes). Antes estos cambios no dejaban rastro.
const CAMPOS_AUDITADOS = ['puesto', 'site', 'estado', 'cpu_procesador', 'memoria_ram', 'almacenamiento', 'sistema_operativo'];

async function registrarCambiosEnHistorial(anterior, nuevo, usuarioId) {
    for (const campo of CAMPOS_AUDITADOS) {
        if (nuevo[campo] === undefined) continue;
        const antes = anterior[campo] ?? null;
        const despues = (typeof nuevo[campo] === 'string' ? nuevo[campo].trim() : nuevo[campo]) || null;
        if ((antes || null) === despues) continue;
        try {
            await ActivoHistorial.registrarCambio(anterior.id, campo, antes, despues ?? 'Sin valor', usuarioId);
        } catch (err) {
            // El activo ya se guardó: un fallo del historial no debe revertir la edición.
            console.error(`No se pudo registrar el cambio de ${campo} del activo ${anterior.id}:`, err.message);
        }
    }
}

const activoController = {
    // Obtener todos los activos
    async getActivos(req, res) {
        try {
            const filters = req.query;
            let activos;

            if (Object.keys(filters).length > 0) {
                activos = await Activo.getByFilter(filters);
            } else {
                activos = await Activo.getAll();
            }

            res.json({ activos });
        } catch (error) {
            console.error('Error al obtener activos:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Obtener un activo por ID
    async getActivoById(req, res) {
        try {
            const { id } = req.params;
            const activo = await Activo.getById(id);

            if (!activo) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Activo no encontrado' 
                });
            }

            res.json({ activo });
        } catch (error) {
            console.error('Error al obtener activo:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Crear un nuevo activo
    async createActivo(req, res) {
        try {
            const activoData = req.body;
            const createdById = req.user.id;

            // Validaciones básicas
            if (!activoData.numero_placa || !activoData.ubicacion || !activoData.site || !activoData.responsable || !activoData.clasificacion) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Los campos número de placa, ubicación, site, responsable y clasificación son obligatorios' 
                });
            }

            // Validar puesto si se proporciona (opcional)
            if (activoData.puesto && activoData.puesto.length > 50) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El puesto no puede exceder 50 caracteres' 
                });
            }

            // Validar asignado si se proporciona (opcional)
            if (activoData.asignado && activoData.asignado.length > 100) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El campo asignado no puede exceder 100 caracteres' 
                });
            }

            if (!activoData.centro_costes || activoData.centro_costes < 1 || activoData.centro_costes > 10) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El centro de costes debe ser un número entre 1 y 10' 
                });
            }

            // Validar valor si se proporciona
            if (activoData.valor !== undefined && activoData.valor !== null && activoData.valor !== '') {
                const valorNum = Number(activoData.valor);
                if (isNaN(valorNum) || valorNum < 0) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'El valor del activo debe ser un número positivo' 
                    });
                }
                // Actualizar el valor parseado
                activoData.valor = valorNum;
            }

            // Validar agente_id si se proporciona
            if (activoData.agente_id !== undefined && activoData.agente_id !== null && activoData.agente_id !== '') {
                const agenteId = parseInt(activoData.agente_id);
                if (isNaN(agenteId) || agenteId < 1) {
                    return res.status(400).json({
                        success: false,
                        message: 'El agente_id debe ser un número entero positivo'
                    });
                }
                activoData.agente_id = agenteId;
            }

            // Solo admin puede crear activos con estado 'dado_de_baja'
            if (activoData.estado === 'dado_de_baja' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Solo el administrador puede asignar el estado "dado de baja". Use "Solicitar Baja" para que el admin lo apruebe.'
                });
            }

            // Validar ubicaciones permitidas
            const ubicacionesPermitidas = ["Claro", "Obama", "IT", "Contratación", "Reclutamiento", "Selección", "Finanzas", "Majority"];
            if (!ubicacionesPermitidas.includes(activoData.ubicacion)) {
                return res.status(400).json({
                    success: false,
                    message: 'Ubicación no válida'
                });
            }

            // Validar clasificaciones permitidas
            const clasificacionesPermitidas = ['Activo productivo', 'Activo no productivo'];
            if (!clasificacionesPermitidas.includes(activoData.clasificacion)) {
                return res.status(400).json({
                    success: false,
                    message: 'Clasificación no válida'
                });
            }

            // Manejar archivo adjunto si existe
            if (req.file) {
                activoData.adjunto_archivo = req.file.filename;
            }

            const nuevoActivo = await Activo.create(activoData, createdById);

            res.status(201).json({ 
                success: true, 
                message: 'Activo creado exitosamente', 
                activo: nuevoActivo 
            });
        } catch (error) {
            console.error('Error al crear activo:', error);
            
            // Si hay error y se subió un archivo, eliminarlo
            if (req.file) {
                const filePath = path.join(__dirname, '../uploads/activos', req.file.filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            // Manejar errores específicos
            if (error.message.includes('ya existe en el sistema')) {
                return res.status(409).json({ 
                    success: false, 
                    message: error.message,
                    type: 'DUPLICATE_PLATE'
                });
            }

            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Actualizar un activo
    async updateActivo(req, res) {
        try {
            const { id } = req.params;
            const activoData = req.body;

            // Verificar que el activo existe
            const activoExistente = await Activo.getById(id);
            if (!activoExistente) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Activo no encontrado' 
                });
            }

            // Validaciones básicas
            if (!activoData.numero_placa || !activoData.ubicacion || !activoData.site || !activoData.responsable || !activoData.clasificacion) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Los campos número de placa, ubicación, site, responsable y clasificación son obligatorios' 
                });
            }

            // Validar puesto si se proporciona (opcional)
            if (activoData.puesto && activoData.puesto.length > 50) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El puesto no puede exceder 50 caracteres' 
                });
            }

            // Validar asignado si se proporciona (opcional)
            if (activoData.asignado && activoData.asignado.length > 100) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El campo asignado no puede exceder 100 caracteres' 
                });
            }

            if (!activoData.centro_costes || activoData.centro_costes < 1 || activoData.centro_costes > 10) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'El centro de costes debe ser un número entre 1 y 10' 
                });
            }

            // Validar valor si se proporciona
            if (activoData.valor !== undefined && activoData.valor !== null && activoData.valor !== '') {
                const valorNum = Number(activoData.valor);
                if (isNaN(valorNum) || valorNum < 0) {
                    return res.status(400).json({ 
                        success: false, 
                        message: 'El valor del activo debe ser un número positivo' 
                    });
                }
                // Actualizar el valor parseado
                activoData.valor = valorNum;
            }

            // Validar agente_id si se proporciona
            if (activoData.agente_id !== undefined && activoData.agente_id !== null && activoData.agente_id !== '') {
                const agenteId = parseInt(activoData.agente_id);
                if (isNaN(agenteId) || agenteId < 1) {
                    return res.status(400).json({
                        success: false,
                        message: 'El agente_id debe ser un número entero positivo'
                    });
                }
                activoData.agente_id = agenteId;
            }

            // Sin estado en el formulario se conserva el actual (Activo.update pondría 'funcional').
            if (!activoData.estado) activoData.estado = activoExistente.estado;

            // Solo admin puede establecer estado 'dado_de_baja' vía edición directa
            if (activoData.estado === 'dado_de_baja' && activoExistente.estado !== 'dado_de_baja' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Solo el administrador puede asignar el estado "dado de baja". Use "Solicitar Baja" para que el admin lo apruebe.'
                });
            }

            // La baja es definitiva: solo el admin puede sacar un equipo de "dado de baja".
            if (activoExistente.estado === 'dado_de_baja' && activoData.estado !== 'dado_de_baja' && req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Este equipo está dado de baja. Solo el administrador puede cambiar su estado.'
                });
            }

            // La solicitud de baja tiene su propio flujo (observación del técnico, aprobación del admin):
            // el formulario no la crea ni la saca de pendiente.
            if ((activoData.estado === 'pendiente_baja') !== (activoExistente.estado === 'pendiente_baja')) {
                return res.status(400).json({
                    success: false,
                    message: activoExistente.estado === 'pendiente_baja'
                        ? 'Este activo tiene una solicitud de baja pendiente: el administrador debe aprobarla o rechazarla desde "Historial de componentes".'
                        : 'Para dar de baja un equipo use "Solicitar Baja" desde el panel del técnico, con la observación.'
                });
            }

            // Manejar archivo adjunto si existe
            if (req.file) {
                // Eliminar archivo anterior si existe
                if (activoExistente.adjunto_archivo) {
                    const oldFilePath = path.join(__dirname, '../uploads/activos', activoExistente.adjunto_archivo);
                    if (fs.existsSync(oldFilePath)) {
                        fs.unlinkSync(oldFilePath);
                    }
                }
                activoData.adjunto_archivo = req.file.filename;
            } else {
                // Mantener el archivo existente si no se sube uno nuevo
                activoData.adjunto_archivo = activoExistente.adjunto_archivo;
            }

            const actualizado = await Activo.update(id, activoData);

            if (!actualizado) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'No se pudo actualizar el activo' 
                });
            }

            await registrarCambiosEnHistorial(activoExistente, activoData, req.user.id);

            res.json({ 
                success: true, 
                message: 'Activo actualizado exitosamente' 
            });
        } catch (error) {
            console.error('Error al actualizar activo:', error);
            
            // Si hay error y se subió un archivo, eliminarlo
            if (req.file) {
                const filePath = path.join(__dirname, '../uploads/activos', req.file.filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            // Manejar errores específicos
            if (error.message.includes('ya existe en el sistema')) {
                return res.status(409).json({ 
                    success: false, 
                    message: error.message,
                    type: 'DUPLICATE_PLATE'
                });
            }

            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Eliminar un activo
    async deleteActivo(req, res) {
        try {
            const { id } = req.params;

            // Verificar que el activo existe
            const activoExistente = await Activo.getById(id);
            if (!activoExistente) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Activo no encontrado' 
                });
            }

            // Eliminar archivo adjunto si existe
            if (activoExistente.adjunto_archivo) {
                const filePath = path.join(__dirname, '../uploads/activos', activoExistente.adjunto_archivo);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }

            const eliminado = await Activo.delete(id);

            if (!eliminado) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'No se pudo eliminar el activo' 
                });
            }

            res.json({ 
                success: true, 
                message: 'Activo eliminado exitosamente' 
            });
        } catch (error) {
            console.error('Error al eliminar activo:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Obtener responsables disponibles
    async getResponsables(req, res) {
        try {
            const responsables = await Activo.getResponsables();
            res.json({ responsables });
        } catch (error) {
            console.error('Error al obtener responsables:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Obtener estadísticas de activos
    async getStats(req, res) {
        try {
            const stats = await Activo.getStats();
            res.json({ stats });
        } catch (error) {
            console.error('Error al obtener estadísticas:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    },

    // Buscar activo por número de placa (tolerante a formatos de pistola)
    async getActivoByPlaca(req, res) {
        try {
            const { placa } = req.params;
            const activo = await Activo.getByNumeroPlaca(placa);

            if (!activo) {
                return res.status(404).json({ 
                    success: false, 
                    message: 'Activo no encontrado' 
                });
            }

            res.json({ activo });
        } catch (error) {
            console.error('Error al obtener activo por placa:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Error interno del servidor', 
                error: error.message 
            });
        }
    }
};

module.exports = activoController;