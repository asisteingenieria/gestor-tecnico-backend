const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const resumenMensualRepo = require('../../repositories/asistencia/resumenMensualRepository');
const equipoService = require('./equipoService');
const { totalesEquipo } = require('../../domain/asistencia/resumenMensual');
const { rangoDelMes } = require('../../utils/fechaBogota');
const { NoEncontradoError, ValidacionError } = require('../../errors/AppError');

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

// Resumen mensual para financiera (asistencia.md §35): comparativo por campaña de toda la
// organización y, si se elige una campaña, su detalle (empleados + grilla día a día, como el jefe).
async function resumenMensual({ periodo, campaniaId = null }) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo || '')) {
        throw new ValidacionError('El periodo debe tener el formato AAAA-MM');
    }
    const { desde, hasta } = rangoDelMes(periodo);

    // Todos los empleados activos con jornadas en el mes (una consulta), para el comparativo.
    const todos = await resumenMensualRepo.agregadosPorEmpleado({ campaniaId: null, desde, hasta });

    const porCampaniaMapa = new Map();
    for (const e of todos) {
        const clave = e.idcampania ?? 'sin_campania';
        if (!porCampaniaMapa.has(clave)) {
            porCampaniaMapa.set(clave, { idcampania: e.idcampania ?? null, campania: e.campania || 'Sin campaña', filas: [] });
        }
        porCampaniaMapa.get(clave).filas.push(e);
    }
    const por_campania = [...porCampaniaMapa.values()]
        .map((g) => ({ idcampania: g.idcampania, campania: g.campania, totales: totalesEquipo(g.filas) }))
        .sort((a, b) => String(a.campania).localeCompare(String(b.campania)));

    // Detalle de una campaña: sus empleados con la grilla día a día.
    let campania = null;
    if (campaniaId != null) {
        const empleadosCampania = todos.filter((e) => String(e.idcampania) === String(campaniaId));
        const dias = await resumenMensualRepo.jornadasDiaPorCampania({ campaniaId, desde, hasta });
        const porEmpleado = new Map();
        for (const d of dias) {
            if (!porEmpleado.has(d.users_company_id)) porEmpleado.set(d.users_company_id, []);
            porEmpleado.get(d.users_company_id).push({ fecha: d.fecha, estado: d.estado, minutos_tarde: d.minutos_tarde, minutos_trabajados: d.minutos_trabajados, minutos_extra: d.minutos_extra });
        }
        const empleadosConDias = empleadosCampania.map((e) => ({ ...e, dias: porEmpleado.get(e.users_company_id) || [] }));
        campania = {
            idcampania: Number(campaniaId),
            nombre: empleadosCampania[0]?.campania || por_campania.find((c) => String(c.idcampania) === String(campaniaId))?.campania || null,
            empleados: empleadosConDias,
            totales: totalesEquipo(empleadosCampania)
        };
    }

    return { periodo, desde, hasta, por_campania, totales: totalesEquipo(todos), campania };
}

module.exports = { campanias, empleados, jornadasDe, trazabilidadDe, resumenMensual };
