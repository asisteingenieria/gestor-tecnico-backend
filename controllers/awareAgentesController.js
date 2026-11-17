const CruceAware = require('../models/CruceAware');
const { cruzar } = require('../utils/cruceAware');
const { obtenerAgentesActivos, VoxproNoConfiguradoError } = require('../services/voxproAwareClient');

// @desc    Cruce por cédula de los empleados del Gestor con los usuarios activos de Aware
// @route   GET /api/aware-agentes/cruce?refrescar=1
// @access  Private (tecnicoInventario, gestorActivos, admin)
exports.getCruce = async (req, res) => {
    try {
        const [empleados, aware] = await Promise.all([
            CruceAware.listarEmpleados(),
            obtenerAgentesActivos({ refrescar: req.query.refrescar === '1' }),
        ]);
        const { filas, resumen } = cruzar(empleados, aware.agentes);
        res.json({
            success: true,
            data: {
                generado_en: aware.generadoEn,
                fuentes: aware.fuentes,
                resumen,
                filas,
            },
        });
    } catch (err) {
        if (err instanceof VoxproNoConfiguradoError) {
            return res.status(503).json({ success: false, msg: 'La conexión con Aware no está configurada en el servidor' });
        }
        console.error('Error al cruzar empleados con Aware:', err.message);
        const sinRespuesta = err.name === 'TimeoutError' || err.name === 'AbortError' || /fetch failed|VoxPro/.test(err.message);
        res.status(sinRespuesta ? 502 : 500).json({
            success: false,
            msg: sinRespuesta
                ? 'No se pudo consultar Aware (VoxPro no respondió). Intenta de nuevo en unos minutos.'
                : 'Error del servidor al cruzar los empleados con Aware',
        });
    }
};
