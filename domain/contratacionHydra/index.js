const secciones = require('./secciones');
const completitud = require('./completitud');
const estados = require('./estados');
const mapeo = require('./mapearPayloadHydra');
const { crearResolverCatalogo } = require('./resolverCatalogo');
const { aplicarCambiosSeccion } = require('./edicionSeccion');
const outbox = require('./outbox');
const documentos = require('./documentos');
const examenes = require('./examenes');

module.exports = {
    ...secciones,
    ...completitud,
    ...estados,
    ...mapeo,
    ...outbox,
    ...documentos,
    ...examenes,
    crearResolverCatalogo,
    aplicarCambiosSeccion
};
