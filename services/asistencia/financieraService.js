const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const equipoService = require('./equipoService');
const { NoEncontradoError } = require('../../errors/AppError');

// Asistencia vista por financiera (asistencia.md §32): la trazabilidad de cualquier empleado
// activo, buscándolo por campaña. Solo lectura; el permiso lo da el rol (isFinanciera).

async function campanias() {
    return empleadoRepo.findCampaniasConEmpleados();
}

async function empleados({ campaniaId }) {
    return empleadoRepo.findActivosPorCampania(campaniaId ?? null);
}

async function empleadoActivo(empleadoId) {
    const empleado = await empleadoRepo.findActivo(empleadoId);
    if (!empleado) throw new NoEncontradoError('El empleado no existe o no tiene un contrato activo');
    return empleado;
}

async function jornadasDe({ empleadoId, desde, hasta }) {
    await empleadoActivo(empleadoId);
    return equipoService.jornadasDeEmpleado(empleadoId, desde, hasta);
}

/** La misma trazabilidad que ve el jefe, más el empleado y su horario del día. */
async function trazabilidadDe({ empleadoId, fecha }) {
    const empleado = await empleadoActivo(empleadoId);
    const [horario] = await horarioAsignadoRepo.findRango(empleadoId, fecha, fecha);
    let trazabilidad = null;
    try {
        trazabilidad = await equipoService.trazabilidadDeEmpleado(empleadoId, fecha);
    } catch (error) {
        // Sin jornada ese día: se muestra el empleado y su horario igual.
        if (!(error instanceof NoEncontradoError)) throw error;
    }
    return { empleado, horario: horario ?? null, ...(trazabilidad ?? { fecha, jornada: null, asislock: null, eventos: [] }) };
}

module.exports = { campanias, empleados, jornadasDe, trazabilidadDe };
