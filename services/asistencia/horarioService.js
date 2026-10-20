const horarioPlantillaRepo = require('../../repositories/asistencia/horarioPlantillaRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const equipoService = require('./equipoService');
const { NoEncontradoError, ReglaAsistenciaError } = require('../../errors/AppError');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

// Cada jefe ve y usa solo sus plantillas (dueño = su ficha, migración 066, asistencia.md §25).
// La de otro jefe responde 404, igual que una que no existe, para no revelar las ajenas.
async function plantillaPropia(id, directorUsersCompanyId) {
    const plantilla = await horarioPlantillaRepo.findById(id);
    if (!plantilla || !plantilla.activo || plantilla.dueno_users_company_id !== directorUsersCompanyId) {
        throw new NoEncontradoError('Plantilla no encontrada');
    }
    return plantilla;
}

async function listarPlantillas({ directorUsersCompanyId }) {
    requireUsersCompanyId(directorUsersCompanyId);
    return horarioPlantillaRepo.findPorDueno(directorUsersCompanyId);
}

async function crearPlantilla({ directorUsersCompanyId, ...datos }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const id = await horarioPlantillaRepo.crear({ ...datos, duenoUsersCompanyId: directorUsersCompanyId });
    return { success: true, idhorario_plantilla: id };
}

async function actualizarPlantilla({ directorUsersCompanyId, id, campos }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await plantillaPropia(id, directorUsersCompanyId);
    await horarioPlantillaRepo.actualizar(id, campos);
    return { success: true };
}

async function eliminarPlantilla({ directorUsersCompanyId, id }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await plantillaPropia(id, directorUsersCompanyId);
    await horarioPlantillaRepo.desactivar(id);
    return { success: true };
}

// Fechas del rango [desde, hasta] que caen en los días de la semana pedidos (1=lunes..7=domingo).
function generarFechas(desde, hasta, diasSemana) {
    const fechas = [];
    const cursor = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    while (cursor <= fin) {
        const diaIso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
        if (!diasSemana || diasSemana.length === 0 || diasSemana.includes(diaIso)) {
            fechas.push(cursor.toISOString().slice(0, 10));
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return fechas;
}

async function asignarMasivo({ directorUsersCompanyId, empleados, desde, hasta, diasSemana, plantillaId, valores, creadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    for (const empleadoId of empleados) {
        await equipoService.assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
    }

    let datosHorario = valores;
    if (plantillaId) {
        const plantilla = await plantillaPropia(plantillaId, directorUsersCompanyId);
        datosHorario = {
            horaEntrada: plantilla.hora_entrada,
            horaSalida: plantilla.hora_salida,
            minutosAlmuerzo: plantilla.minutos_almuerzo,
            horaAlmuerzoInicio: plantilla.hora_almuerzo_inicio,
            toleranciaEntradaMin: plantilla.tolerancia_entrada_min
        };
    }
    if (!datosHorario || !datosHorario.horaEntrada || !datosHorario.horaSalida) {
        throw new ReglaAsistenciaError('Debe indicar plantilla_id o los valores de horario (hora_entrada, hora_salida)');
    }

    const fechas = generarFechas(desde, hasta, diasSemana);
    let creados = 0;
    for (const empleadoId of empleados) {
        for (const fecha of fechas) {
            await horarioAsignadoRepo.insertar({
                usersCompanyId: empleadoId,
                fecha,
                horarioPlantillaId: plantillaId ?? null,
                horaEntrada: datosHorario.horaEntrada,
                horaSalida: datosHorario.horaSalida,
                minutosAlmuerzo: datosHorario.minutosAlmuerzo,
                horaAlmuerzoInicio: datosHorario.horaAlmuerzoInicio,
                toleranciaEntradaMin: datosHorario.toleranciaEntradaMin,
                esDescanso: false,
                creadoPor,
                notas: null
            });
            creados += 1;
        }
    }
    return { success: true, horarios_creados: creados };
}

async function consultarHorarios({ directorUsersCompanyId, empleadoId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
    if (empleadoId) {
        await equipoService.assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
        return horarioAsignadoRepo.findRango(empleadoId, desde, hasta);
    }
    const empleados = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    const listas = await Promise.all(empleados.map((e) => horarioAsignadoRepo.findRango(e.users_company_id, desde, hasta)));
    return listas.flat();
}

async function actualizarAsignacion({ directorUsersCompanyId, idhorarioAsignado, campos }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const asignacion = await horarioAsignadoRepo.findById(idhorarioAsignado);
    if (!asignacion) throw new NoEncontradoError('Horario asignado no encontrado');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, asignacion.users_company_id);
    await horarioAsignadoRepo.actualizar(idhorarioAsignado, campos);
    return { success: true };
}

async function eliminarAsignacion({ directorUsersCompanyId, idhorarioAsignado }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const asignacion = await horarioAsignadoRepo.findById(idhorarioAsignado);
    if (!asignacion) throw new NoEncontradoError('Horario asignado no encontrado');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, asignacion.users_company_id);
    await horarioAsignadoRepo.eliminar(idhorarioAsignado);
    return { success: true };
}

module.exports = {
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla,
    asignarMasivo,
    consultarHorarios,
    actualizarAsignacion,
    eliminarAsignacion
};
