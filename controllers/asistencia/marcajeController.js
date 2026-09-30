const marcajeService = require('../../services/asistencia/marcajeService');

function contextoDe(req) {
    return { userId: req.user.id, ip: req.ip, userAgent: req.get('user-agent') };
}

async function marcarEntrada(req, res) {
    const resultado = await marcajeService.marcarEntrada({
        usersCompanyId: req.user.users_company_id,
        contexto: contextoDe(req)
    });
    res.json(resultado);
}

async function iniciarPausa(req, res) {
    const resultado = await marcajeService.iniciarPausa({
        usersCompanyId: req.user.users_company_id,
        tipo: req.body.tipo,
        contexto: contextoDe(req)
    });
    res.json(resultado);
}

async function finalizarPausa(req, res) {
    const resultado = await marcajeService.finalizarPausa({
        usersCompanyId: req.user.users_company_id,
        contexto: contextoDe(req)
    });
    res.json(resultado);
}

async function marcarSalida(req, res) {
    const resultado = await marcajeService.marcarSalida({
        usersCompanyId: req.user.users_company_id,
        contexto: contextoDe(req)
    });
    res.json(resultado);
}

module.exports = { marcarEntrada, iniciarPausa, finalizarPausa, marcarSalida };
