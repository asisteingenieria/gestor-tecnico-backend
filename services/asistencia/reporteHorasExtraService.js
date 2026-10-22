const reporteRepo = require('../../repositories/asistencia/reporteHorasExtraRepository');
const reglas = require('../../domain/asistencia').reporteHorasExtra;
const { rangoDelMes } = require('../../utils/fechaBogota');
const { ValidacionError } = require('../../errors/AppError');

// Reporte mensual de horas extras (asistencia.md §32). Se calcula en vivo con las horas aprobadas
// del mes: no hay envío ni aprobación. El jefe ve su equipo; financiera ve a todos (o por campaña)
// y, además, el costo en dinero por campaña y totales.

function assertPeriodo(periodo) {
    if (!reglas.esPeriodo(periodo)) throw new ValidacionError('El periodo debe tener el formato AAAA-MM');
}

/** Reporte del equipo de un jefe de área, en horas (sin dinero). */
async function miReporte({ jefeUsersCompanyId, periodo }) {
    assertPeriodo(periodo);
    const { desde, hasta } = rangoDelMes(periodo);
    const crudas = await reporteRepo.reporteDelMes({ jefeId: jefeUsersCompanyId, desde, hasta });
    const filas = crudas.map((c) => reglas.filaReporte(datosEmpleado(c), c.minutos));
    return { periodo, filas, totales: reglas.totalesDe(filas) };
}

/**
 * Reporte para financiera: el mismo que ve el jefe pero de todos los empleados (o de una campaña),
 * con el valor en dinero de cada hora extra, agrupado por campaña y con totales.
 */
async function reporteFinanciera({ periodo, campaniaId = null }) {
    assertPeriodo(periodo);
    const { desde, hasta } = rangoDelMes(periodo);
    const crudas = await reporteRepo.reporteDelMes({ campaniaId, desde, hasta });
    const filas = crudas.map((c) => reglas.filaReporte(datosEmpleado(c), c.minutos, { conDinero: true }));
    return {
        periodo,
        filas,
        por_campania: agruparPorCampania(filas),
        totales: reglas.totalesDe(filas)
    };
}

const datosEmpleado = (c) => ({
    users_company_id: c.users_company_id,
    documento: c.documento,
    nombre: c.nombre,
    idcampania: c.idcampania,
    campania: c.campania,
    centro_costo: c.centro_costo,
    cargo: c.cargo,
    salario: c.salario,
    aclaraciones: c.aclaraciones
});

// Agrupa las filas (ya con dinero) por campaña, con los totales de cada una.
function agruparPorCampania(filas) {
    const mapa = new Map();
    for (const f of filas) {
        const clave = f.idcampania ?? 'sin_campania';
        if (!mapa.has(clave)) mapa.set(clave, { idcampania: f.idcampania ?? null, campania: f.campania || 'Sin campaña', filas: [] });
        mapa.get(clave).filas.push(f);
    }
    return [...mapa.values()].map((g) => ({
        idcampania: g.idcampania,
        campania: g.campania,
        totales: reglas.totalesDe(g.filas)
    }));
}

module.exports = { miReporte, reporteFinanciera };
