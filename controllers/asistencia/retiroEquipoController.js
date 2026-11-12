const retiroEquipoService = require('../../services/asistencia/retiroEquipoService');

// Retiros del equipo para la Red Maestra de Claro (asistencia.md §59).

async function listar(req, res) {
    res.json(await retiroEquipoService.listar({
        usersCompanyId: req.user.users_company_id,
        soloPendientes: req.query.pendientes === 'true'
    }));
}

async function pendientes(req, res) {
    res.json(await retiroEquipoService.pendientes({ usersCompanyId: req.user.users_company_id }));
}

async function registrarRetiroRm(req, res) {
    res.json(await retiroEquipoService.registrarRetiroRm({
        usersCompanyId: req.user.users_company_id,
        empleadoId: Number(req.params.empleadoId),
        fecha: req.body.fecha_retiro_rm || null
    }));
}

module.exports = { listar, pendientes, registrarRetiroRm };
