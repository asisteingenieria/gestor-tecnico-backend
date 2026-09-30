const { AppError } = require('../errors/AppError');

module.exports = (err, req, res, next) => {
    if (err instanceof AppError) {
        const body = { success: false, codigo: err.codigo, message: err.message };
        if (err.detalles && err.detalles.length > 0) body.detalles = err.detalles;
        return res.status(err.statusCode).json(body);
    }
    console.error('[asistencia]', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
};
