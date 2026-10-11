const rrhhService = require('../../services/contratacionHydra/rrhhService');
const registroService = require('../../services/contratacionHydra/registroService');
const despachoService = require('../../services/contratacionHydra/despachoService');

// Endpoints de RRHH sobre el staging de contratación (conexionhydra.md §8). Sin try/catch:
// los envuelve asyncHandler y los errores los responde middleware/errorHandler.js.

async function listarLotes(req, res) {
    res.json(await rrhhService.listarLotes({ estado: req.query.estado }));
}

async function obtenerLote(req, res) {
    res.json(await rrhhService.obtenerLote(Number(req.params.id)));
}

async function obtenerCandidato(req, res) {
    res.json(await rrhhService.obtenerCandidato(Number(req.params.id)));
}

async function guardarSeccion(req, res) {
    res.json(await rrhhService.guardarSeccion({
        id: Number(req.params.id),
        seccion: req.params.seccion,
        cambios: req.body
    }));
}

async function marcarVerificacion(req, res) {
    res.json(await rrhhService.marcarVerificacion({
        id: Number(req.params.id),
        seccion: req.params.seccion,
        verificado: req.body.verificado,
        usuarioId: req.user.id
    }));
}

async function descartarCandidato(req, res) {
    res.json(await rrhhService.descartarCandidato({ id: Number(req.params.id), motivo: req.body.motivo }));
}

async function opcionesCatalogos(req, res) {
    res.json(await rrhhService.opcionesCatalogos());
}

async function listarMapeos(req, res) {
    res.json(await rrhhService.listarMapeos());
}

async function guardarMapeo(req, res) {
    res.json(await rrhhService.guardarMapeo({
        catalogo: req.body.catalogo,
        valorHydra: req.body.valor_hydra,
        idGestor: req.body.id_gestor,
        usuarioId: req.user.id
    }));
}

async function registrarLote(req, res) {
    res.json(await registroService.registrarLote({
        loteId: Number(req.params.id),
        simular: req.query.simular === 'true',
        usuarioId: req.user.id
    }));
}

async function listarEnvios(req, res) {
    res.json(await despachoService.listarEnvios({ estado: req.query.estado }));
}

async function reintentarEnvio(req, res) {
    res.json(await despachoService.reintentarEnvio(Number(req.params.id)));
}

module.exports = {
    registrarLote,
    listarEnvios,
    reintentarEnvio,
    listarLotes,
    obtenerLote,
    obtenerCandidato,
    guardarSeccion,
    marcarVerificacion,
    descartarCandidato,
    opcionesCatalogos,
    listarMapeos,
    guardarMapeo
};
