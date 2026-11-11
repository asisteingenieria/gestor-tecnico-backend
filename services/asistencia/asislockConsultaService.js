const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const { asislock, consultaAsislock } = require('../../domain/asistencia');
const { fechaLaboral } = require('../../utils/fechaBogota');
const { AppError, NoEncontradoError, ValidacionError } = require('../../errors/AppError');

// Consultas de AsisLock a Gestor por cédula (asistencia.md §58): el horario con su modalidad
// (presencial / virtual) y los estados del empleado que Gestor guardó. Solo lectura.

/** Cédula → ficha con contrato activo. 404 si no existe o no tiene contrato activo, 409 si es ambigua. */
async function resolverEmpleado(cedulaCruda) {
    const cedula = asislock.normalizarCedula(cedulaCruda);
    if (!cedula) throw new ValidacionError('La cédula es inválida');
    const ids = await empleadoRepo.findPorNumeroIdentificacion(cedula);
    if (ids.length === 0) throw new AppError('No hay un empleado con esa cédula', 404, 'EMPLEADO_NO_ENCONTRADO');
    if (ids.length > 1) throw new AppError('La cédula corresponde a más de una ficha', 409, 'CEDULA_AMBIGUA');
    const activo = await empleadoRepo.findActivo(ids[0]);
    if (!activo) throw new NoEncontradoError('El empleado no tiene un contrato activo');
    return { cedula, empleado: activo };
}

const datosEmpleado = (empleado) => ({
    nombre: empleado.nombre,
    campania: empleado.campania ?? null,
    centro_costo: empleado.centro_costo ?? null,
    cargo: empleado.cargo ?? null,
    modalidad_contrato: consultaAsislock.modalidadDeContrato(empleado.modalidad)
});

/** Horario de cada día de desde a hasta (por defecto, hoy), con su modalidad. */
async function horarioPorCedula({ cedula: cedulaCruda, desde, hasta, ahora = new Date() }) {
    const hoy = fechaLaboral(ahora);
    const inicio = desde ?? hoy;
    const fin = hasta ?? inicio;
    if (fin < inicio) throw new ValidacionError('hasta no puede ser anterior a desde');
    if (consultaAsislock.fechasDelRango(inicio, fin).length > consultaAsislock.MAX_DIAS_HORARIO) {
        throw new ValidacionError(`El rango no puede superar ${consultaAsislock.MAX_DIAS_HORARIO} días`);
    }

    const { cedula, empleado } = await resolverEmpleado(cedulaCruda);
    const horarios = await horarioRepo.findRango(empleado.users_company_id, inicio, fin);
    const datos = datosEmpleado(empleado);
    return {
        success: true,
        cedula,
        empleado: datos,
        desde: inicio,
        hasta: fin,
        dias: consultaAsislock.horarioParaAsislock({ desde: inicio, hasta: fin, horarios, modalidadContrato: datos.modalidad_contrato })
    };
}

/** Estado actual del empleado y la línea de estados del día (por defecto, hoy). */
async function estadoPorCedula({ cedula: cedulaCruda, fecha, ahora = new Date() }) {
    const dia = fecha ?? fechaLaboral(ahora);
    const { cedula, empleado } = await resolverEmpleado(cedulaCruda);
    const jornada = await jornadaRepo.findPorFecha(empleado.users_company_id, dia);
    const eventos = jornada ? await eventoRepo.findByJornada(jornada.idjornada) : [];
    return {
        success: true,
        cedula,
        fecha: dia,
        servidor_ahora: ahora.toISOString(),
        jornada_estado: jornada?.estado ?? null,
        ...consultaAsislock.estadosDelDia(eventos, jornada)
    };
}

module.exports = { horarioPorCedula, estadoPorCedula };
