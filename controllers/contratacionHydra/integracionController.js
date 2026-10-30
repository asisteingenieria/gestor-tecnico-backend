const recepcionService = require('../../services/contratacionHydra/recepcionService');

// Endpoints que llama Hydra (máquina a máquina). Sin try/catch: los envuelve asyncHandler
// y los errores los responde middleware/errorHandler.js.

function contexto(req, endpoint) {
    return { idempotencyKey: req.idempotencyKey, endpoint, rawBody: req.rawBody, ip: req.ip };
}

async function recibirLote(req, res) {
    const { status, body } = await recepcionService.recibirLote(req.body, contexto(req, 'POST /lotes'));
    res.status(status).json(body);
}

async function actualizarCandidato(req, res) {
    const { status, body } = await recepcionService.actualizarCandidato(
        req.body, contexto(req, `PUT /candidatos/${req.params.hydraCandidatoId}`)
    );
    res.status(status).json(body);
}

async function cancelarCandidato(req, res) {
    const { status, body } = await recepcionService.cancelarCandidato(
        Number(req.params.hydraCandidatoId), req.body?.motivo,
        contexto(req, `POST /candidatos/${req.params.hydraCandidatoId}/cancelar`)
    );
    res.status(status).json(body);
}

async function decidirContinuidad(req, res) {
    const { status, body } = await recepcionService.decidirContinuidad(
        Number(req.params.hydraCandidatoId), req.body,
        contexto(req, `POST /candidatos/${req.params.hydraCandidatoId}/examenes/continuidad`)
    );
    res.status(status).json(body);
}

async function consultarCandidato(req, res) {
    res.json(await recepcionService.consultarCandidato(Number(req.params.hydraCandidatoId)));
}

async function recibirDocumento(req, res) {
    const { hydraCandidatoId, tipo } = req.params;
    const { status, body } = await recepcionService.recibirDocumento(
        Number(hydraCandidatoId), req.body,
        contexto(req, `PUT /candidatos/${hydraCandidatoId}/documentos/${tipo}`)
    );
    res.status(status).json(body);
}

module.exports = { recibirLote, actualizarCandidato, cancelarCandidato, decidirContinuidad, recibirDocumento, consultarCandidato };
