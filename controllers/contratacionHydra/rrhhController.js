const rrhhService = require('../../services/contratacionHydra/rrhhService');
const registroService = require('../../services/contratacionHydra/registroService');
const despachoService = require('../../services/contratacionHydra/despachoService');
const documentosService = require('../../services/contratacionHydra/documentosService');
const examenesService = require('../../services/contratacionHydra/examenesService');

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

// Exámenes médicos (SST, migración 089).
async function marcarExamen(req, res) {
    res.json(await examenesService.marcarExamen({
        id: Number(req.params.id),
        evento: req.body.evento,
        nota: req.body.nota,
        usuarioId: req.user.id
    }));
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

// Inline (se abre en el navegador); el nombre original solo va en la cabecera.
function enviarArchivo(res, { ruta, mime, nombre_original: nombreOriginal }) {
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(nombreOriginal)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(ruta, (error) => {
        if (error && !res.headersSent) res.status(404).json({ success: false, message: 'Documento no encontrado' });
    });
}

async function archivoDocumentoCandidato(req, res) {
    enviarArchivo(res, await documentosService.archivoDeCandidato(Number(req.params.id), Number(req.params.documentoId)));
}

async function documentosEmpleado(req, res) {
    res.json(await documentosService.documentosDeEmpleado(Number(req.params.usersCompanyId)));
}

async function archivoDocumentoEmpleado(req, res) {
    enviarArchivo(res, await documentosService.archivoDeEmpleado(Number(req.params.usersCompanyId), Number(req.params.documentoId)));
}

module.exports = {
    archivoDocumentoCandidato,
    documentosEmpleado,
    archivoDocumentoEmpleado,
    registrarLote,
    listarEnvios,
    reintentarEnvio,
    listarLotes,
    obtenerLote,
    obtenerCandidato,
    guardarSeccion,
    marcarVerificacion,
    descartarCandidato,
    marcarExamen,
    opcionesCatalogos,
    listarMapeos,
    guardarMapeo
};
