const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const equipoService = require('./equipoService');
const { NoEncontradoError, ConflictoJornadaError } = require('../../errors/AppError');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

async function solicitar({ usersCompanyId, fecha, minutosEstimados, clase, motivo, solicitadoPor }) {
    requireUsersCompanyId(usersCompanyId);
    const idhoraExtra = await horaExtraRepo.insertarSolicitud({ usersCompanyId, fecha, minutosEstimados, clase, motivo, solicitadoPor });
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

async function aprobar({ directorUsersCompanyId, idhoraExtra, minutosAprobados, clase, comentario, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await horaExtraRepo.findById(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, solicitud.users_company_id);

    await resolverPendiente(solicitud, { estado: 'aprobada', minutosAprobados, clase, comentario, aprobadoPor });
    return { success: true };
}

// Solo una solicitud pendiente se resuelve, y una sola vez. El `AND estado = 'pendiente'` del
// UPDATE cubre además a dos directores (o dos pestañas) resolviendo la misma a la vez.
async function resolverPendiente(solicitud, decision) {
    const conflicto = () => new ConflictoJornadaError(`La solicitud de hora extra ya está ${solicitud.estado === 'pendiente' ? 'resuelta' : solicitud.estado}`);
    if (solicitud.estado !== 'pendiente') throw conflicto();
    const resuelta = await horaExtraRepo.resolver(solicitud.idhora_extra, decision);
    if (!resuelta) throw conflicto();
}

async function rechazar({ directorUsersCompanyId, idhoraExtra, comentario, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await horaExtraRepo.findById(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, solicitud.users_company_id);

    await resolverPendiente(solicitud, { estado: 'rechazada', minutosAprobados: null, comentario, aprobadoPor });
    return { success: true };
}

async function asignar({ directorUsersCompanyId, empleados, fecha, minutos, clase, motivo, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    for (const empleadoId of empleados) {
        await equipoService.assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
    }
    const ids = await Promise.all(empleados.map((empleadoId) =>
        horaExtraRepo.insertarAsignada({ usersCompanyId: empleadoId, fecha, minutos, clase, motivo, aprobadoPor })
    ));
    return { success: true, ids };
}

module.exports = { solicitar, misHorasExtra, bandeja, aprobar, rechazar, asignar };
