const pasivoEquipoService = require('../../services/asistencia/pasivoEquipoService');

async function pasivo(req, res) {
    res.json(await pasivoEquipoService.pasivo({ usersCompanyId: req.user.users_company_id, fecha: req.query.fecha }));
}

module.exports = { pasivo };
