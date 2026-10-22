const reporteService = require('../../services/asistencia/reporteHorasExtraService');

// Reporte mensual de horas extras (asistencia.md §32). Se llena solo con las horas aprobadas;
// es de solo lectura. El jefe ve su equipo; financiera ve a todos con el dinero (financieraController).

async function miReporte(req, res) {
    res.json(await reporteService.miReporte({
        jefeUsersCompanyId: req.user.users_company_id,
        periodo: req.query.periodo
    }));
}

module.exports = { miReporte };
