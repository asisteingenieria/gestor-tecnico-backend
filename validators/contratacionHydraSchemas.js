const { ESTADOS_LOTE, CLAVES_SECCION, CATALOGOS } = require('../domain/contratacionHydra');

// Esquemas de los endpoints de RRHH (conexionhydra.md §8), para middleware/validar.js.
// Los valores de cada sección se validan campo a campo en el dominio
// (aplicarCambiosSeccion); aquí solo se exige que el cuerpo sea un objeto.

const idParamSchema = {
    params: { id: { requerido: true, tipo: 'entero' } }
};

const listarLotesQuerySchema = {
    query: { estado: { enum: ESTADOS_LOTE } }
};

const seccionParamsSchema = {
    params: {
        id: { requerido: true, tipo: 'entero' },
        seccion: { requerido: true, enum: CLAVES_SECCION }
    }
};

const verificacionSchema = {
    ...seccionParamsSchema,
    body: { verificado: { requerido: true, tipo: 'booleano' } }
};

const descartarSchema = {
    ...idParamSchema,
    body: { motivo: { requerido: true, tipo: 'texto' } }
};

const guardarMapeoSchema = {
    body: {
        catalogo: { requerido: true, enum: CATALOGOS },
        valor_hydra: { requerido: true, tipo: 'texto' },
        id_gestor: { requerido: true, tipo: 'entero' }
    }
};

const registrarLoteSchema = {
    ...idParamSchema,
    query: { simular: { enum: ['true', 'false'] } }
};

const listarEnviosQuerySchema = {
    query: { estado: { enum: ['pendiente', 'enviado', 'fallido'] } }
};

function validarCuerpoSeccion(body) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return ['El cuerpo debe ser un objeto con los campos de la sección'];
    }
    return [];
}

module.exports = {
    idParamSchema,
    listarLotesQuerySchema,
    seccionParamsSchema,
    verificacionSchema,
    descartarSchema,
    guardarMapeoSchema,
    registrarLoteSchema,
    listarEnviosQuerySchema,
    validarCuerpoSeccion
};
