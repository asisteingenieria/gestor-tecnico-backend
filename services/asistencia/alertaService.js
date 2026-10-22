const alertaRepo = require('../../repositories/asistencia/alertaTraspasoRepository');
const { fechaLaboral } = require('../../utils/fechaBogota');
const { NoEncontradoError } = require('../../errors/AppError');

// Campana del portal: las alertas de traspasos dirigidas a la ficha del usuario (migración 070).
// Un usuario sin ficha no tiene alertas (no es un error: la campana sale vacía).
async function misAlertas({ usersCompanyId }) {
    if (!usersCompanyId) return [];
    const hoy = fechaLaboral(new Date());
    return alertaRepo.findVisiblesPara(usersCompanyId, hoy);
}

async function marcarLeida({ usersCompanyId, idalerta }) {
    const ok = usersCompanyId && await alertaRepo.marcarLeida(idalerta, usersCompanyId);
    if (!ok) throw new NoEncontradoError('Alerta no encontrada');
    return { success: true };
}

module.exports = { misAlertas, marcarLeida };
