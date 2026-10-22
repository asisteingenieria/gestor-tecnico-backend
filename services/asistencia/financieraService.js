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
    const periodoAnterior = mesAnterior(periodo);
    const rangoPrev = rangoDelMes(periodoAnterior);

    // Todas las campañas con empleados activos (aunque no tengan jornadas ese mes) + sus agregados.
    const [campaniasActivas, todos, todosPrev] = await Promise.all([
        empleadoRepo.findCampaniasConEmpleados(),
        resumenMensualRepo.agregadosPorEmpleado({ campaniaId: null, desde, hasta }),
        resumenMensualRepo.agregadosPorEmpleado({ campaniaId: null, desde: rangoPrev.desde, hasta: rangoPrev.hasta })
    ]);

    const agruparPorCampania = (filas) => {
        const mapa = new Map();
        for (const e of filas) {
            const clave = e.idcampania ?? 'sin_campania';
            if (!mapa.has(clave)) mapa.set(clave, []);
            mapa.get(clave).push(e);
        }
        return mapa;
    };
    const aggMapa = agruparPorCampania(todos);
    const prevMapa = agruparPorCampania(todosPrev);

    // Base: todas las campañas con dotación activa; se les pega el agregado del mes (0 si no hubo).
    const por_campania = campaniasActivas.map((cam) => {
        const clave = cam.idcampania ?? 'sin_campania';
        const totales = totalesEquipo(aggMapa.get(clave) || []);
        totales.empleados = cam.empleados; // dotación activa real, no solo quienes marcaron
        let anterior = null;
        if (prevMapa.has(clave)) { anterior = totalesEquipo(prevMapa.get(clave)); anterior.empleados = cam.empleados; }
        return { idcampania: cam.idcampania, campania: cam.nombre, totales, anterior };
    }).sort((a, b) => String(a.campania).localeCompare(String(b.campania)));

    const totales = totalesEquipo(todos);
    totales.empleados = campaniasActivas.reduce((acc, c) => acc + c.empleados, 0);

    // Detalle de una campaña: TODOS sus empleados activos (los que no marcaron van con ceros) + grilla.
    let campania = null;
    if (campaniaId != null) {
        const [roster, dias] = await Promise.all([
            empleadoRepo.findActivosPorCampania(campaniaId),
            resumenMensualRepo.jornadasDiaPorCampania({ campaniaId, desde, hasta })
        ]);
        const aggPorEmp = new Map((aggMapa.get(Number(campaniaId)) || aggMapa.get(String(campaniaId)) || []).map((e) => [e.users_company_id, e]));
        const diasPorEmp = new Map();
        for (const d of dias) {
            if (!diasPorEmp.has(d.users_company_id)) diasPorEmp.set(d.users_company_id, []);
            diasPorEmp.get(d.users_company_id).push({ fecha: d.fecha, estado: d.estado, minutos_tarde: d.minutos_tarde, minutos_trabajados: d.minutos_trabajados, minutos_extra: d.minutos_extra });
        }
        const empleadosCampania = roster.map((r) => {
            const agg = aggPorEmp.get(r.users_company_id) || resumenCero();
            return {
                ...agg,
                users_company_id: r.users_company_id,
                nombre: r.nombre,
                documento: r.cedula,
                cargo: r.cargo,
                dias: diasPorEmp.get(r.users_company_id) || []
            };
        });
        const totalesCampania = totalesEquipo(empleadosCampania);
        totalesCampania.empleados = empleadosCampania.length;
        campania = {
            idcampania: Number(campaniaId),
            nombre: roster[0]?.campania || por_campania.find((c) => String(c.idcampania) === String(campaniaId))?.campania || null,
            empleados: empleadosCampania,
            totales: totalesCampania
        };
    }

    return { periodo, periodo_anterior: periodoAnterior, desde, hasta, por_campania, totales, campania };
}

// Totales en cero para un empleado activo que no marcó ninguna jornada en el mes.
function resumenCero() {
    return {
        dias_trabajados: 0, dias_puntuales: 0, dias_tarde: 0, ausencias: 0,
        minutos_trabajados: 0, minutos_tarde: 0, minutos_extra: 0, minutos_bano: 0,
        minutos_break: 0, minutos_almuerzo: 0, minutos_capacitacion: 0, minutos_salida_anticipada: 0,
        porcentaje_puntualidad: null
    };
}

// Mes anterior de un periodo 'AAAA-MM'.
function mesAnterior(periodo) {
    const [a, m] = periodo.split('-').map(Number);
    return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

module.exports = { campanias, empleados, jornadasDe, trazabilidadDe, resumenMensual };
