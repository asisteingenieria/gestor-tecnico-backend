const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const resumenMensualRepo = require('../../repositories/asistencia/resumenMensualRepository');
const equipoService = require('./equipoService');
const { totalesEquipo, resumenDeJornadas } = require('../../domain/asistencia/resumenMensual');
const { porEmpleado, novedadesPorFecha, ajustarAgregado } = require('../../domain/asistencia/novedadesAsistencia');
const { rangoDelMes, fechaLaboral } = require('../../utils/fechaBogota');
const { NoEncontradoError, ValidacionError } = require('../../errors/AppError');

// Asistencia vista por financiera (asistencia.md §32): la trazabilidad de cualquier empleado
// activo, buscándolo por campaña. Solo lectura; el permiso lo da el rol (isFinanciera).

async function campanias() {
    return empleadoRepo.findCampaniasConEmpleados();
}

async function empleados({ campaniaId }) {
    return empleadoRepo.findActivosPorCampania(campaniaId ?? null);
}

// Asistencia en vivo de toda la empresa, o de una campaña (§47): el mismo tablero que "Equipo hoy"
// del jefe, con campaña, centro de costo, jefe de área y turno de hoy de cada persona.
async function enVivo({ campaniaId }) {
    const empleadosActivos = await empleadoRepo.findActivosPorCampania(campaniaId ?? null);
    return equipoService.estadoEnVivo(empleadosActivos);
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
    return { empleado, horario: horario ?? null, ...(trazabilidad ?? { fecha, jornada: null, asislock: null, molinete: null, eventos: [] }) };
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
    const [campaniasActivas, aggMes, aggPrev] = await Promise.all([
        empleadoRepo.findCampaniasConEmpleados(),
        resumenMensualRepo.agregadosPorEmpleado({ campaniaId: null, desde, hasta }),
        resumenMensualRepo.agregadosPorEmpleado({ campaniaId: null, desde: rangoPrev.desde, hasta: rangoPrev.hasta })
    ]);
    // Novedades de RRHH (§71.1): un día cubierto en que no trabajó no es ausencia sino "día con novedad".
    const hoy = fechaLaboral(new Date());
    const [mes, prev] = await Promise.all([
        conNovedades(aggMes, desde, hasta, hoy),
        conNovedades(aggPrev, rangoPrev.desde, rangoPrev.hasta, hoy)
    ]);
    const todos = mes.agregados;
    const todosPrev = prev.agregados;

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
        const roster = await empleadoRepo.findActivosPorCampania(campaniaId);
        const [dias, horarios] = await Promise.all([
            resumenMensualRepo.jornadasDiaPorCampania({ campaniaId, desde, hasta }),
            horarioAsignadoRepo.findRangoPorEmpleados(roster.map((r) => r.users_company_id), desde, hasta)
        ]);
        const aggPorEmp = new Map((aggMapa.get(Number(campaniaId)) || aggMapa.get(String(campaniaId)) || []).map((e) => [e.users_company_id, e]));
        const diasPorEmp = new Map();
        for (const d of dias) {
            if (!diasPorEmp.has(d.users_company_id)) diasPorEmp.set(d.users_company_id, []);
            diasPorEmp.get(d.users_company_id).push({ fecha: d.fecha, estado: d.estado, minutos_tarde: d.minutos_tarde, minutos_trabajados: d.minutos_trabajados, minutos_extra: d.minutos_extra });
        }
        // Turnos del mes por empleado (§46): el día a día para el calendario y el último turno
        // (sin contar descansos) como su horario del mes.
        const turnosPorEmp = new Map();
        for (const h of horarios) {
            if (!turnosPorEmp.has(h.users_company_id)) turnosPorEmp.set(h.users_company_id, []);
            turnosPorEmp.get(h.users_company_id).push({
                fecha: h.fecha, plantilla: h.plantilla, hora_entrada: h.hora_entrada, hora_salida: h.hora_salida, es_descanso: !!h.es_descanso
            });
        }
        const hastaHoy = hasta < hoy ? hasta : hoy;
        const empleadosCampania = roster.map((r) => {
            const agg = aggPorEmp.get(r.users_company_id) || resumenCero();
            // Grilla con los días con novedad marcados (también los que no tienen jornada), como la del jefe.
            const novedadesMes = novedadesPorFecha(mes.novedadesDe.get(r.users_company_id), desde, hastaHoy);
            return {
                ...agg,
                users_company_id: r.users_company_id,
                nombre: r.nombre,
                documento: r.cedula,
                cargo: r.cargo,
                centro_costo: r.centro_costo,
                turno: ultimoTurno(turnosPorEmp.get(r.users_company_id) || []),
                turnos: turnosPorEmp.get(r.users_company_id) || [],
                dias: resumenDeJornadas(diasPorEmp.get(r.users_company_id) || [], novedadesMes).dias
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

// Corrige los agregados del periodo con las novedades de RRHH (§71.1): resta las ausencias cubiertas y suma
// `dias_novedad` (solo hasta hoy). Quien no marcó ninguna jornada pero tuvo novedad entra con ceros, para que
// cuente en su campaña. Devuelve también las novedades por empleado, para la grilla del detalle.
async function conNovedades(agregados, desde, hasta, hoy) {
    const hastaHoy = hasta < hoy ? hasta : hoy;
    const filas = desde <= hastaHoy ? await resumenMensualRepo.novedadesDeActivos({ desde, hasta: hastaHoy }) : [];
    const novedadesDe = porEmpleado(filas);
    if (novedadesDe.size === 0) {
        return { agregados: agregados.map((a) => ({ ...a, dias_novedad: 0 })), novedadesDe };
    }
    const estados = await resumenMensualRepo.estadosDia({ usersCompanyIds: [...novedadesDe.keys()], desde, hasta: hastaHoy });
    const estadosDe = new Map();
    for (const e of estados) {
        if (!estadosDe.has(e.users_company_id)) estadosDe.set(e.users_company_id, new Map());
        estadosDe.get(e.users_company_id).set(e.fecha, e.estado);
    }
    const ajustar = (agg) => {
        const lista = novedadesDe.get(agg.users_company_id);
        if (!lista) return { ...agg, dias_novedad: 0 };
        return ajustarAgregado(agg, estadosDe.get(agg.users_company_id) || new Map(), novedadesPorFecha(lista, desde, hastaHoy));
    };
    const resultado = agregados.map(ajustar);
    const conAgregado = new Set(agregados.map((a) => a.users_company_id));
    for (const [id, lista] of novedadesDe) {
        if (conAgregado.has(id)) continue;
        const f = lista[0];
        const fila = ajustar({
            ...resumenCero(), users_company_id: id, documento: f.documento, nombre: f.nombre,
            idcampania: f.idcampania, campania: f.campania, cargo: f.cargo
        });
        if (fila.dias_novedad > 0) resultado.push(fila);
    }
    return { agregados: resultado, novedadesDe };
}

// Último turno trabajable de la lista (vienen ordenados por fecha), o null si solo hay descansos.
function ultimoTurno(turnos) {
    const trabajables = turnos.filter((t) => !t.es_descanso);
    const ultimo = trabajables[trabajables.length - 1];
    return ultimo ? { plantilla: ultimo.plantilla, hora_entrada: ultimo.hora_entrada, hora_salida: ultimo.hora_salida } : null;
}

// Totales en cero para un empleado activo que no marcó ninguna jornada en el mes.
function resumenCero() {
    return {
        dias_trabajados: 0, dias_puntuales: 0, dias_tarde: 0, ausencias: 0, dias_novedad: 0,
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

module.exports = { campanias, empleados, enVivo, jornadasDe, trazabilidadDe, resumenMensual };
