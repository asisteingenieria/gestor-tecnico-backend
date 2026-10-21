const alertaService = require('../../services/asistencia/alertaService');

async function misAlertas(req, res) {
    const resultado = await alertaService.misAlertas({ usersCompanyId: req.user.users_company_id });
    res.json(resultado);
}

async function marcarLeida(req, res) {
    const resultado = await alertaService.marcarLeida({
        usersCompanyId: req.user.users_company_id,
        idalerta: Number(req.params.id)
    });
    res.json(resultado);
}

module.exports = { misAlertas, marcarLeida };
