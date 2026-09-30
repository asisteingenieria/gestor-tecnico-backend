const horarioService = require('../../services/asistencia/horarioService');

function datosPlantillaDe(req) {
    return {
        nombre: req.body.nombre,
        horaEntrada: req.body.hora_entrada,
        horaSalida: req.body.hora_salida,
        minutosAlmuerzo: req.body.minutos_almuerzo,
        horaAlmuerzoInicio: req.body.hora_almuerzo_inicio,
        toleranciaEntradaMin: req.body.tolerancia_entrada_min
    };
}

async function listarPlantillas(req, res) {
    res.json(await horarioService.listarPlantillas());
}

async function crearPlantilla(req, res) {
    const resultado = await horarioService.crearPlantilla({ ...datosPlantillaDe(req), creadoPorUserId: req.user.id });
    res.status(201).json(resultado);
}

async function actualizarPlantilla(req, res) {
    const resultado = await horarioService.actualizarPlantilla(Number(req.params.id), datosPlantillaDe(req));
    res.json(resultado);
}

async function eliminarPlantilla(req, res) {
    const resultado = await horarioService.eliminarPlantilla(Number(req.params.id));
    res.json(resultado);
}

async function consultarHorarios(req, res) {
    const resultado = await horarioService.consultarHorarios({
        directorUsersCompanyId: req.user.users_company_id,
        empleadoId: req.query.empleadoId ? Number(req.query.empleadoId) : null,
        desde: req.query.desde,
        hasta: req.query.hasta
    });
    res.json(resultado);
}

async function asignarMasivo(req, res) {
    const resultado = await horarioService.asignarMasivo({
        directorUsersCompanyId: req.user.users_company_id,
        empleados: req.body.empleados,
        desde: req.body.desde,
        hasta: req.body.hasta,
        diasSemana: req.body.dias_semana,
        plantillaId: req.body.plantilla_id,
        valores: req.body.plantilla_id ? null : {
            horaEntrada: req.body.hora_entrada,
            horaSalida: req.body.hora_salida,
            minutosAlmuerzo: req.body.minutos_almuerzo,
            horaAlmuerzoInicio: req.body.hora_almuerzo_inicio,
            toleranciaEntradaMin: req.body.tolerancia_entrada_min
        },
        creadoPorUserId: req.user.id
    });
    res.status(201).json(resultado);
}

async function actualizarAsignacion(req, res) {
    const resultado = await horarioService.actualizarAsignacion({
        directorUsersCompanyId: req.user.users_company_id,
        idhorarioAsignado: Number(req.params.id),
        campos: {
            horaEntrada: req.body.hora_entrada,
            horaSalida: req.body.hora_salida,
            minutosAlmuerzo: req.body.minutos_almuerzo,
            horaAlmuerzoInicio: req.body.hora_almuerzo_inicio,
            toleranciaEntradaMin: req.body.tolerancia_entrada_min,
            esDescanso: req.body.es_descanso,
            notas: req.body.notas
        }
    });
    res.json(resultado);
}

async function eliminarAsignacion(req, res) {
    const resultado = await horarioService.eliminarAsignacion({
        directorUsersCompanyId: req.user.users_company_id,
        idhorarioAsignado: Number(req.params.id)
    });
    res.json(resultado);
}

module.exports = {
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla,
    consultarHorarios,
    asignarMasivo,
    actualizarAsignacion,
    eliminarAsignacion
};
