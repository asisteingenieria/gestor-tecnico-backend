const novedadEquipoService = require('../../services/asistencia/novedadEquipoService');

async function historial(req, res) {
    const q = req.query;
    res.json(await novedadEquipoService.historial({
        usersCompanyId: req.user.users_company_id,
        desde: q.desde,
        hasta: q.hasta,
        empleadoId: q.empleado_id ? Number(q.empleado_id) : null,
        tipoNovedadId: q.tipo_novedad_id ? Number(q.tipo_novedad_id) : null
    }));
}

module.exports = { historial };
