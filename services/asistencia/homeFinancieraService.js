const indicadoresRepo = require('../../repositories/asistencia/indicadoresRrhhRepository');
const financieraService = require('./financieraService');
const reporteService = require('./reporteHorasExtraService');
const reglasReporte = require('../../domain/asistencia').reporteHorasExtra;
const home = require('../../domain/asistencia/homeFinanciera');
const costoNomina = require('../../domain/asistencia/costoNomina');
const { rangoDelMes, sumarMeses, periodosHasta, fechaLaboral } = require('../../utils/fechaBogota');
const { ValidacionError } = require('../../errors/AppError');

// Home de financiera/admin (asistencia.md §37): en una sola respuesta, los indicadores del mes de
// RRHH (nómina, dotación, novedades), asistencia y horas extra con su costo, la tendencia de los
// últimos meses y los hallazgos redactados. Reutiliza los cálculos de los reportes existentes.
// El costo de nómina (§38-§40) se reconstruye mes a mes desde las vigencias salariales: es en vivo y
// también histórico.

const MESES_TENDENCIA = 6;
const MESES_HISTORICO_NOMINA = 12;
const TOP_EMPLEADOS = 10;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (periodo) => `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`;

async function resumen({ periodo }) {
    if (!reglasReporte.esPeriodo(periodo)) throw new ValidacionError('El periodo debe tener el formato AAAA-MM');
    const periodoAnterior = sumarMeses(periodo, -1);
    const hoy = fechaLaboral(new Date());
    const mesEnCurso = hoy.slice(0, 7) === periodo;
    const periodos = periodosHasta(periodo, MESES_TENDENCIA);
    const rangoTendencia = { desde: rangoDelMes(periodos[0]).desde, hasta: rangoDelMes(periodo).hasta };
    const periodosNomina = periodosHasta(periodo, MESES_HISTORICO_NOMINA);
    const rangoNomina = { desde: rangoDelMes(periodosNomina[0]).desde, hasta: rangoDelMes(periodo).hasta };

    const [asistencia, asistenciaAnterior, reportes, nomina, ingresos, retiros, novedades, tramos, factores, salariosMinimos] = await Promise.all([
        financieraService.resumenMensual({ periodo }),
        financieraService.resumenMensual({ periodo: periodoAnterior }),
        Promise.all(periodos.map((p) => reporteService.reporteFinanciera({ periodo: p }))),
        indicadoresRepo.nominaPorCampania(),
        indicadoresRepo.ingresosPorMes(rangoTendencia),
        indicadoresRepo.retirosPorMes(rangoTendencia),
        indicadoresRepo.novedadesPorTipo(rangoDelMes(periodo)),
        indicadoresRepo.tramosSalariales(rangoNomina),
        indicadoresRepo.factoresCostoNomina(),
        indicadoresRepo.salariosMinimos()
    ]);

    const extraMes = reportes[reportes.length - 1];
    const extraAnterior = reportes[reportes.length - 2];
    const cantidadDe = (lista, p) => lista.find((x) => x.periodo === p)?.cantidad ?? 0;

    // Costo de nómina: el mes elegido (con su desglose por campaña) y el histórico mes a mes.
    const costoMes = costoNomina.costoDelMes(tramos, factores, periodo, { salariosMinimos });
    const historicoNomina = costoNomina.historico(tramos, factores, periodosNomina, hoy, { salariosMinimos });
    const costoAnterior = historicoNomina.find((m) => m.periodo === periodoAnterior) ?? null;
    const causadoHoy = mesEnCurso ? historicoNomina.find((m) => m.periodo === periodo)?.causado ?? null : null;

    const porCampania = home.unirPorCampania({ nomina, costos: costoMes.por_campania, asistencia: asistencia.por_campania, horasExtra: extraMes.por_campania });

    const activos = nomina.reduce((a, n) => a + n.empleados, 0);
    const sinSalario = nomina.reduce((a, n) => a + n.sin_salario, 0);
    const dinero = extraMes.totales.total_dinero ?? 0;
    const dineroAnterior = extraAnterior.totales.total_dinero ?? 0;

    const kpis = {
        nomina: {
            total: costoMes.total,
            salarios: costoMes.salarios,
            auxilio_transporte: costoMes.auxilio_transporte,
            empleados_con_auxilio: costoMes.empleados_con_auxilio,
            prestaciones: costoMes.prestaciones,
            aportes: costoMes.aportes,
            bonos: costoMes.bonos,
            detalle_prestaciones: costoMes.detalle_prestaciones,
            detalle_aportes: costoMes.detalle_aportes,
            causado_hoy: causadoHoy,
            total_anterior: costoAnterior?.total ?? null,
            variacion_pct: home.variacionPct(costoMes.total, costoAnterior?.total),
            empleados: costoMes.empleados,
            sin_salario: sinSalario,
            salario_promedio: costoMes.empleados > 0 ? Math.round(costoMes.salarios / costoMes.empleados) : null
        },
        horas_extra: {
            dinero,
            dinero_anterior: dineroAnterior,
            variacion_pct: home.variacionPct(dinero, dineroAnterior),
            horas: extraMes.totales.total_horas,
            empleados: extraMes.filas.filter((f) => f.total_horas > 0).length
        },
        dotacion: {
            activos,
            ingresos_mes: cantidadDe(ingresos, periodo),
            retiros_mes: cantidadDe(retiros, periodo)
        },
        asistencia: {
            puntualidad: asistencia.totales.porcentaje_puntualidad,
            puntualidad_anterior: asistenciaAnterior.totales.porcentaje_puntualidad,
            delta_pp: home.deltaPp(asistencia.totales.porcentaje_puntualidad, asistenciaAnterior.totales.porcentaje_puntualidad),
            ausencias: asistencia.totales.ausencias,
            ausencias_anterior: asistenciaAnterior.totales.ausencias,
            dias_trabajados: asistencia.totales.dias_trabajados
        },
        novedades: {
            total: novedades.reduce((a, n) => a + n.cantidad, 0),
            dias: novedades.reduce((a, n) => a + n.dias, 0)
        }
    };

    const tendencia = periodos.map((p, i) => ({
        periodo: p,
        dinero_extra: reportes[i].totales.total_dinero ?? 0,
        horas_extra: reportes[i].totales.total_horas,
        ingresos: cantidadDe(ingresos, p),
        retiros: cantidadDe(retiros, p)
    }));

    const horasPorClase = reglasReporte.CLASES.map((clase) => ({
        clase,
        horas: extraMes.totales[clase] ?? 0,
        dinero: Math.round(extraMes.filas.reduce((a, f) => a + (Number(f[`${clase}_dinero`]) || 0), 0))
    }));

    const topEmpleados = extraMes.filas
        .filter((f) => f.total_horas > 0)
        .sort((a, b) => b.total_dinero - a.total_dinero || b.total_horas - a.total_horas)
        .slice(0, TOP_EMPLEADOS)
        .map((f) => ({
            users_company_id: f.users_company_id, nombre: f.nombre, documento: f.documento,
            campania: f.campania, cargo: f.cargo, horas: f.total_horas, dinero: f.total_dinero
        }));

    return {
        periodo,
        periodo_anterior: periodoAnterior,
        meta_puntualidad: home.META_PUNTUALIDAD,
        kpis,
        mes_en_curso: mesEnCurso,
        hallazgos: home.hallazgos({ kpis, porCampania, nombreMesAnterior: nombreMes(periodoAnterior), mesEnCurso }),
        tendencia,
        por_campania: porCampania,
        horas_por_clase: horasPorClase,
        top_empleados: topEmpleados,
        costo_nomina: {
            historico: historicoNomina,
            factores,
            dias_mes_comercial: costoNomina.DIAS_MES_COMERCIAL
        },
        novedades_por_tipo: novedades
    };
}

module.exports = { resumen };
