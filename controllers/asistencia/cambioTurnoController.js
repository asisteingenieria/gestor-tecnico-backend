const cambioTurnoService = require('../../services/asistencia/cambioTurnoService');
const { autorDe } = require('./autor');

async function permisos(req, res) {
    res.json(await cambioTurnoService.permisos({ usersCompanyId: req.user.users_company_id }));
}

async function empleados(req, res) {
    res.json(await cambioTurnoService.empleadosSolicitables({ usersCompanyId: req.user.users_company_id }));
}

async function plantillas(req, res) {
    res.json(await cambioTurnoService.plantillasPara({ solicitanteUsersCompanyId: req.user.users_company_id }));
}

// `empleados` llega como "12,34" en la query.
async function horarios(req, res) {
    const resultado = await cambioTurnoService.horariosDe({
        solicitanteUsersCompanyId: req.user.users_company_id,
        empleados: String(req.query.empleados).split(',').map(Number).filter(Number.isInteger),
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

async function solicitar(req, res) {
    const b = req.body;
    const resultado = await cambioTurnoService.solicitar({
        solicitanteUsersCompanyId: req.user.users_company_id,
        tipo: b.tipo,
        motivo: b.motivo,
        empleadoId: b.empleado_id,
        empleado2Id: b.empleado2_id,
        fecha: b.fecha,
        desde: b.desde,
        hasta: b.hasta,
        plantillaId: b.plantilla_id,
        valores: { horaEntrada: b.hora_entrada, horaSalida: b.hora_salida, minutosAlmuerzo: b.minutos_almuerzo },
        esDescanso: b.es_descanso === true,
        solicitadoPor: autorDe(req)
    });
    res.status(201).json(resultado);
}

async function misSolicitudes(req, res) {
    res.json(await cambioTurnoService.misSolicitudes({ usersCompanyId: req.user.users_company_id }));
}

async function bandeja(req, res) {
    res.json(await cambioTurnoService.bandeja({ directorUsersCompanyId: req.user.users_company_id, estado: req.query.estado }));
}

async function aprobar(req, res) {
    const resultado = await cambioTurnoService.aprobar({
        directorUsersCompanyId: req.user.users_company_id,
        id: Number(req.params.id),
        comentario: req.body.comentario,
        resueltoPor: autorDe(req)
    });
    res.json(resultado);
}

async function rechazar(req, res) {
    const resultado = await cambioTurnoService.rechazar({
        directorUsersCompanyId: req.user.users_company_id,
        id: Number(req.params.id),
        motivoRechazo: req.body.motivo_rechazo,
        resueltoPor: autorDe(req)
    });
    res.json(resultado);
}

async function todas(req, res) {
    res.json(await cambioTurnoService.todas({ estado: req.query.estado, desde: req.query.desde, hasta: req.query.hasta }));
}

module.exports = { permisos, empleados, plantillas, horarios, solicitar, misSolicitudes, bandeja, aprobar, rechazar, todas };
