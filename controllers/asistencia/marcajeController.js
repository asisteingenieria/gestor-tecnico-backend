const marcajeService = require('../../services/asistencia/marcajeService');
const { autorDe } = require('./autor');

function contextoDe(req) {
    return { autor: autorDe(req), ip: req.ip, userAgent: req.get('user-agent') };
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
