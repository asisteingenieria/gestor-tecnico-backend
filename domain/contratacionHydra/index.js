const secciones = require('./secciones');
const completitud = require('./completitud');
const estados = require('./estados');
const mapeo = require('./mapearPayloadHydra');
const { crearResolverCatalogo } = require('./resolverCatalogo');
const { aplicarCambiosSeccion } = require('./edicionSeccion');
const outbox = require('./outbox');
const documentos = require('./documentos');

module.exports = {
    ...secciones,
    ...completitud,
    ...estados,
    ...mapeo,
    ...outbox,
    ...documentos,
    crearResolverCatalogo,
    aplicarCambiosSeccion
};
