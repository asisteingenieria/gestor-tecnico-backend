const Agente = require('../models/Agente');

const agenteController = {
    async getAgentes(req, res) {
        try {
            const agentes = await Agente.getAll();
            res.json({ agentes });
        } catch (error) {
            console.error('Error al obtener agentes:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getAgenteById(req, res) {
        try {
            const agente = await Agente.getById(req.params.id);
            if (!agente) {
                return res.status(404).json({ success: false, message: 'Agente no encontrado' });
            }
            res.json({ agente });
        } catch (error) {
            console.error('Error al obtener agente:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async createAgente(req, res) {
        try {
            const { cedula, nombres, apellidos, campana } = req.body;

            if (!cedula || !nombres || !apellidos || !campana) {
                return res.status(400).json({
                    success: false,
                    message: 'Los campos cédula, nombres, apellidos y campaña son obligatorios'
                });
            }

            const agente = await Agente.create({ cedula, nombres, apellidos, campana });
            res.status(201).json({ success: true, message: 'Agente creado exitosamente', agente });
        } catch (error) {
            console.error('Error al crear agente:', error);
            if (error.message.includes('ya existe')) {
                return res.status(409).json({ success: false, message: error.message, type: 'DUPLICATE_CEDULA' });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async updateAgente(req, res) {
        try {
            const { id } = req.params;
            const { cedula, nombres, apellidos, campana } = req.body;

            const existe = await Agente.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Agente no encontrado' });
            }

            if (!cedula || !nombres || !apellidos || !campana) {
                return res.status(400).json({
                    success: false,
                    message: 'Los campos cédula, nombres, apellidos y campaña son obligatorios'
                });
            }

            const actualizado = await Agente.update(id, { cedula, nombres, apellidos, campana });
            if (!actualizado) {
                return res.status(404).json({ success: false, message: 'No se pudo actualizar el agente' });
            }
            res.json({ success: true, message: 'Agente actualizado exitosamente' });
        } catch (error) {
            console.error('Error al actualizar agente:', error);
            if (error.message.includes('ya existe')) {
                return res.status(409).json({ success: false, message: error.message, type: 'DUPLICATE_CEDULA' });
            }
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async deleteAgente(req, res) {
        try {
            const { id } = req.params;

            const existe = await Agente.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Agente no encontrado' });
            }

            await Agente.delete(id);
            res.json({ success: true, message: 'Agente eliminado exitosamente. Los activos asignados quedaron sin agente.' });
        } catch (error) {
            console.error('Error al eliminar agente:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async getActivosDeAgente(req, res) {
        try {
            const { id } = req.params;

            const existe = await Agente.getById(id);
            if (!existe) {
                return res.status(404).json({ success: false, message: 'Agente no encontrado' });
            }

            const activos = await Agente.getActivos(id);
            res.json({ agente: existe, activos });
        } catch (error) {
            console.error('Error al obtener activos del agente:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    },

    async assignActivo(req, res) {
        try {
            const { id, activoId } = req.params;

            const agente = await Agente.getById(id);
            if (!agente) {
                return res.status(404).json({ success: false, message: 'Agente no encontrado' });
            }

            const ok = await Agente.assignActivo(id, activoId);
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

            const agente = await Agente.getById(id);
            if (!agente) {
                return res.status(404).json({ success: false, message: 'Agente no encontrado' });
            }

            const ok = await Agente.unassignActivo(activoId);
            if (!ok) {
                return res.status(404).json({ success: false, message: 'Activo no encontrado' });
            }
            res.json({ success: true, message: 'Activo desasignado exitosamente' });
        } catch (error) {
            console.error('Error al desasignar activo:', error);
            res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
        }
    }
};

module.exports = agenteController;
