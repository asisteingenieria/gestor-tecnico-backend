const { ValidacionError } = require('../errors/AppError');

// Adaptador para validadores con forma `(body, req) → errores[]`, cuando el esquema
// plano de middleware/validar.js no alcanza (objetos anidados, arreglos).
module.exports = (validador) => (req, res, next) => {
    const errores = validador(req.body, req);
    if (errores.length > 0) return next(new ValidacionError('Datos inválidos', errores));
    next();
};
