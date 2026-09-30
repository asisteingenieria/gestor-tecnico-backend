const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const equipoService = require('./equipoService');
const { NoEncontradoError } = require('../../errors/AppError');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

async function solicitar({ usersCompanyId, fecha, minutosEstimados, motivo, solicitadoPorUserId }) {
    requireUsersCompanyId(usersCompanyId);
    const idhoraExtra = await horaExtraRepo.insertarSolicitud({ usersCompanyId, fecha, minutosEstimados, motivo, solicitadoPorUserId });
    return { success: true, idhora_extra: idhoraExtra };
}

async function misHorasExtra({ usersCompanyId, estado }) {
    requireUsersCompanyId(usersCompanyId);
    return horaExtraRepo.findPorEmpleado(usersCompanyId, { estado });
}

async function bandeja({ directorUsersCompanyId, estado }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const empleados = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    return horaExtraRepo.findPorEquipo(empleados.map((e) => e.users_company_id), { estado });
}

async function aprobar({ directorUsersCompanyId, idhoraExtra, minutosAprobados, comentario, aprobadoPorUserId }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await horaExtraRepo.findById(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, solicitud.users_company_id);

    await horaExtraRepo.resolver(idhoraExtra, { estado: 'aprobada', minutosAprobados, comentario, aprobadoPorUserId });
    return { success: true };
}

async function rechazar({ directorUsersCompanyId, idhoraExtra, comentario, aprobadoPorUserId }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await horaExtraRepo.findById(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, solicitud.users_company_id);

    await horaExtraRepo.resolver(idhoraExtra, { estado: 'rechazada', minutosAprobados: null, comentario, aprobadoPorUserId });
    return { success: true };
}

async function asignar({ directorUsersCompanyId, empleados, fecha, minutos, motivo, aprobadoPorUserId }) {
    requireUsersCompanyId(directorUsersCompanyId);
    for (const empleadoId of empleados) {
        await equipoService.assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
    }
    const ids = await Promise.all(empleados.map((empleadoId) =>
        horaExtraRepo.insertarAsignada({ usersCompanyId: empleadoId, fecha, minutos, motivo, aprobadoPorUserId })
    ));
    return { success: true, ids };
}

module.exports = { solicitar, misHorasExtra, bandeja, aprobar, rechazar, asignar };
