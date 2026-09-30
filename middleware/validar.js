const { ValidacionError } = require('../errors/AppError');

const validadoresTipo = {
    texto: (v) => typeof v === 'string',
    entero: (v) => v !== '' && v !== null && Number.isInteger(Number(v)),
    decimal: (v) => v !== '' && v !== null && !isNaN(Number(v)),
    booleano: (v) => typeof v === 'boolean',
    array: (v) => Array.isArray(v),
    fecha: (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
};

function validarCampo(nombre, reglas, valor, errores) {
    const presente = valor !== undefined && valor !== null && valor !== '';

    if (!presente) {
        if (reglas.requerido) errores.push(`${nombre} es requerido`);
        return;
    }

    if (reglas.tipo && validadoresTipo[reglas.tipo] && !validadoresTipo[reglas.tipo](valor)) {
        errores.push(`${nombre} debe ser de tipo ${reglas.tipo}`);
        return;
    }

    if (reglas.enum && !reglas.enum.includes(valor)) {
        errores.push(`${nombre} debe ser uno de: ${reglas.enum.join(', ')}`);
    }

    if (reglas.tipo === 'array') {
        if (reglas.minimo && valor.length < reglas.minimo) {
            errores.push(`${nombre} debe tener al menos ${reglas.minimo} elemento(s)`);
        }
        if (reglas.valores) {
            const invalidos = valor.filter((v) => !reglas.valores.includes(v));
            if (invalidos.length > 0) {
                errores.push(`${nombre} contiene valores no permitidos: ${invalidos.join(', ')}`);
            }
        }
    }
}

function validarSeccion(schemaSeccion, datos, errores) {
    if (!schemaSeccion) return;
    for (const [campo, reglas] of Object.entries(schemaSeccion)) {
        validarCampo(campo, reglas, datos ? datos[campo] : undefined, errores);
    }
}

function validar(schema) {
    return (req, res, next) => {
        const errores = [];
        validarSeccion(schema.body, req.body, errores);
        validarSeccion(schema.params, req.params, errores);
        validarSeccion(schema.query, req.query, errores);

        if (errores.length > 0) {
            return next(new ValidacionError('Datos inválidos', errores));
        }
        next();
    };
}

module.exports = validar;
