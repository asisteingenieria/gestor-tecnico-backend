const db = require('../../config/db');
const reporteRepo = require('../../repositories/asistencia/reporteHorasExtraRepository');
const periodoRepo = require('../../repositories/asistencia/periodoHorasExtraRepository');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const parametroRepo = require('../../repositories/asistencia/parametroRepository');
const { reporteHorasExtra: reglas } = require('../../domain/asistencia');
const { fechaLaboral, sumarDias, rangoDelMes } = require('../../utils/fechaBogota');
const { NoEncontradoError, ConflictoJornadaError, ValidacionError } = require('../../errors/AppError');

// Reporte mensual de horas extras: el jefe de área lo arma con las horas extra aprobadas de su
// equipo, las reparte en las 5 clases del formato V.3 y lo envía; financiera lo aprueba o lo
// devuelve (asistencia.md §32).

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

function assertPeriodo(periodo) {
    if (!reglas.esPeriodo(periodo)) throw new ValidacionError('periodo debe tener la forma AAAA-MM');
}

const vistaReporte = (r) => (r ? {
    idreporte_horas_extra: r.idreporte_horas_extra,
    estado: r.estado,
    enviado_en: r.enviado_en,
    veces_enviado: r.veces_enviado,
    revisado_en: r.revisado_en,
    observacion_financiera: r.observacion_financiera
} : null);

const fueraDePlazo = (reporte, fechaLimite) =>
    reglas.fueraDePlazo(reporte?.enviado_en ? fechaLaboral(new Date(reporte.enviado_en)) : null, fechaLimite);

function totales(filas) {
    const t = Object.fromEntries(reglas.CLASES.map((c) => [c, 0]));
    for (const f of filas) for (const c of reglas.CLASES) t[c] = Math.round((t[c] + (Number(f[c]) || 0)) * 100) / 100;
    return { ...t, total: reglas.totalHoras(t), empleados: filas.length };
}

/** Equipo del jefe y sus horas extra aprobadas en el mes. */
async function contextoDelJefe(jefeUsersCompanyId, periodo, conn = db) {
    const equipo = await equipoRepo.datosParaReporte(jefeUsersCompanyId, conn);
    const { desde, hasta } = rangoDelMes(periodo);
    const minutosAprobadosPor = await horaExtraRepo.minutosAprobadosPorEmpleado(equipo.map((e) => e.users_company_id), desde, hasta, conn);
    return { equipo, minutosAprobadosPor };
}

/**
 * Filas para mostrar mientras el reporte se puede editar: lo guardado, más quien tenga horas
 * aprobadas en el mes y no esté todavía, con los datos actuales de la ficha.
 */
function filasEditables(equipo, minutosAprobadosPor, detalleGuardado) {
    const guardadoPor = Object.fromEntries(detalleGuardado.map((d) => [d.users_company_id, d]));
    return equipo
        .filter((e) => guardadoPor[e.users_company_id] || (minutosAprobadosPor[e.users_company_id] ?? 0) > 0)
        .map((e) => {
            const g = guardadoPor[e.users_company_id];
            return {
                ...e,
                minutos_aprobados: minutosAprobadosPor[e.users_company_id] ?? 0,
                ...Object.fromEntries(reglas.CLASES.map((c) => [c, g ? g[c] : 0])),
                aclaraciones: g?.aclaraciones ?? null
            };
        });
}

async function miReporte({ jefeUsersCompanyId, periodo }) {
    requireUsersCompanyId(jefeUsersCompanyId);
    assertPeriodo(periodo);

    const [reporte, periodoInfo, { equipo, minutosAprobadosPor }] = await Promise.all([
        reporteRepo.findPorJefeYPeriodo(jefeUsersCompanyId, periodo),
        periodoRepo.obtener(periodo),
        contextoDelJefe(jefeUsersCompanyId, periodo)
    ]);
    const detalle = reporte ? await reporteRepo.findDetalle(reporte.idreporte_horas_extra) : [];
    const editable = reglas.puedeEditarse(reporte?.estado);
    const filas = editable ? filasEditables(equipo, minutosAprobadosPor, detalle) : detalle;

    return {
        periodo,
        fecha_limite: periodoInfo?.fecha_limite ?? null,
        reporte: vistaReporte(reporte),
        fuera_de_plazo: fueraDePlazo(reporte, periodoInfo?.fecha_limite),
        editable,
        filas,
        totales: totales(filas),
        // Para agregar a alguien del equipo sin horas aprobadas (p. ej. solo recargo nocturno).
        equipo: equipo.map((e) => ({ users_company_id: e.users_company_id, nombre: e.nombre, documento: e.documento }))
    };
}

/** Guarda (y si `enviar`, envía) el reporte del jefe en una sola transacción. */
async function guardar({ jefeUsersCompanyId, periodo, filas, autor, enviar }) {
    requireUsersCompanyId(jefeUsersCompanyId);
    assertPeriodo(periodo);
    if (!Array.isArray(filas)) throw new ValidacionError('filas debe ser una lista');

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        let reporte = await reporteRepo.findPorJefeYPeriodoParaActualizar(jefeUsersCompanyId, periodo, conn);
        if (reporte && !reglas.puedeEditarse(reporte.estado)) {
            throw new ConflictoJornadaError(`El reporte de ${periodo} ya está ${reporte.estado} y no se puede modificar`);
        }

        const { equipo, minutosAprobadosPor } = await contextoDelJefe(jefeUsersCompanyId, periodo, conn);
        const datosPor = Object.fromEntries(equipo.map((e) => [e.users_company_id, e]));
        const normalizadas = reglas.normalizarFilas(filas, minutosAprobadosPor);
        const errores = reglas.erroresDelReporte(
            normalizadas,
            { equipo: new Set(Object.keys(datosPor).map(Number)), minutosAprobadosPor, nombrePor: Object.fromEntries(equipo.map((e) => [e.users_company_id, e.nombre])) },
            { exigirCuadre: enviar }
        );
        if (errores.length > 0) {
            throw new ValidacionError(enviar ? 'El reporte no se puede enviar' : 'El reporte tiene datos inválidos', errores);
        }

        // Cada fila guarda los datos del empleado como están hoy: el reporte enviado no cambia
        // si después cambia la ficha.
        const conDatos = normalizadas.map((f) => ({
            ...f,
            documento: datosPor[f.users_company_id].documento,
            nombre: datosPor[f.users_company_id].nombre,
            campania: datosPor[f.users_company_id].campania,
            centro_costo: datosPor[f.users_company_id].centro_costo,
            cargo: datosPor[f.users_company_id].cargo,
            minutos_aprobados: minutosAprobadosPor[f.users_company_id] ?? 0
        }));

        const id = reporte?.idreporte_horas_extra ?? await reporteRepo.crear({ periodo, jefeUsersCompanyId }, conn);
        await reporteRepo.reemplazarDetalle(id, conDatos, conn);
        if (enviar) await reporteRepo.marcarEnviado(id, autor, conn);

        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
    return miReporte({ jefeUsersCompanyId, periodo });
}

// --- Financiera -----------------------------------------------------------------------------

/** Todos los jefes de área con el estado de su reporte del mes, y los totales. */
async function resumenDelPeriodo({ periodo }) {
    assertPeriodo(periodo);
    const [periodoInfo, reportes, jefes] = await Promise.all([
        periodoRepo.obtener(periodo),
        reporteRepo.listarDelPeriodo(periodo),
        reporteRepo.findJefesDeArea()
    ]);
    const fechaLimite = periodoInfo?.fecha_limite ?? null;
    const reportePor = Object.fromEntries(reportes.map((r) => [r.jefe_users_company_id, r]));

    // Un reporte de alguien que ya no es jefe también se muestra.
    const ids = [...new Set([...jefes.map((j) => j.jefe_users_company_id), ...reportes.map((r) => r.jefe_users_company_id)])];
    const jefePor = Object.fromEntries(jefes.map((j) => [j.jefe_users_company_id, j]));

    const filas = ids.map((id) => {
        const r = reportePor[id];
        const j = jefePor[id];
        return {
            jefe_users_company_id: id,
            jefe_nombre: r?.jefe_nombre ?? j.jefe_nombre,
            jefe_documento: r?.jefe_documento ?? j.jefe_documento,
            personas_a_cargo: j?.personas_a_cargo ?? 0,
            idreporte_horas_extra: r?.idreporte_horas_extra ?? null,
            // Un borrador todavía no le llegó a financiera.
            estado: r?.estado ?? 'sin_reporte',
            enviado_en: r?.enviado_en ?? null,
            veces_enviado: r?.veces_enviado ?? 0,
            revisado_en: r?.revisado_en ?? null,
            observacion_financiera: r?.observacion_financiera ?? null,
            fuera_de_plazo: fueraDePlazo(r, fechaLimite),
            empleados: r?.empleados ?? 0,
            ...Object.fromEntries(reglas.CLASES.map((c) => [c, r?.[c] ?? 0])),
            total: r ? reglas.totalHoras(r) : 0
        };
    }).sort((a, b) => a.jefe_nombre.localeCompare(b.jefe_nombre, 'es'));

    const conteo = (estados) => filas.filter((f) => estados.includes(f.estado)).length;
    const recibidos = filas.filter((f) => ['enviado', 'aprobado'].includes(f.estado));
    return {
        periodo,
        fecha_limite: fechaLimite,
        hoy: fechaLaboral(new Date()),
        resumen: {
            jefes: filas.length,
            sin_enviar: conteo(['sin_reporte', 'borrador']),
            por_revisar: conteo(['enviado']),
            aprobados: conteo(['aprobado']),
            devueltos: conteo(['devuelto'])
        },
        // Totales de lo que ya le llegó a financiera (enviado o aprobado).
        totales: totales(recibidos.map((f) => f)),
        jefes: filas
    };
}

async function detalle({ idreporte }) {
    const reporte = await reporteRepo.findById(idreporte);
    // Un borrador es del jefe: financiera solo ve lo enviado.
    if (!reporte || reporte.estado === 'borrador') throw new NoEncontradoError('Reporte no encontrado');
    const filas = await reporteRepo.findDetalle(idreporte);
    const fechaLimite = reporte.fecha_limite instanceof Date ? reporte.fecha_limite.toISOString().slice(0, 10) : reporte.fecha_limite;
    return {
        ...vistaReporte(reporte),
        periodo: reporte.periodo,
        jefe_users_company_id: reporte.jefe_users_company_id,
        jefe_nombre: reporte.jefe_nombre,
        jefe_documento: reporte.jefe_documento,
        fecha_limite: fechaLimite ?? null,
        fuera_de_plazo: fueraDePlazo(reporte, fechaLimite),
        filas,
        totales: totales(filas)
    };
}

async function revisar({ idreporte, estado, observacion, revisadoPorUserId }) {
    const reporte = await reporteRepo.findById(idreporte);
    if (!reporte || reporte.estado === 'borrador') throw new NoEncontradoError('Reporte no encontrado');
    if (!reglas.puedeRevisarse(reporte.estado) || !(await reporteRepo.revisar(idreporte, { estado, observacion, revisadoPorUserId }))) {
        throw new ConflictoJornadaError(`El reporte ya está ${reporte.estado === 'enviado' ? 'revisado' : reporte.estado}`);
    }
    return detalle({ idreporte });
}

const aprobar = ({ idreporte, revisadoPorUserId }) => revisar({ idreporte, estado: 'aprobado', observacion: null, revisadoPorUserId });

function devolver({ idreporte, observacion, revisadoPorUserId }) {
    const texto = typeof observacion === 'string' ? observacion.trim() : '';
    if (!texto) throw new ValidacionError('Escribe qué debe corregir el jefe');
    if (texto.length > 500) throw new ValidacionError('La observación admite hasta 500 caracteres');
    return revisar({ idreporte, estado: 'devuelto', observacion: texto, revisadoPorUserId });
}

async function fijarFechaLimite({ periodo, fechaLimite, userId }) {
    assertPeriodo(periodo);
    // La fecha límite cae en el mes reportado o después, nunca antes de que empiece.
    if (fechaLimite < rangoDelMes(periodo).desde) {
        throw new ValidacionError(`La fecha límite de ${periodo} no puede ser anterior al ${rangoDelMes(periodo).desde}`);
    }
    await periodoRepo.guardar(periodo, fechaLimite, userId);
    return { success: true, periodo, fecha_limite: fechaLimite };
}

// --- Campana del jefe -----------------------------------------------------------------------

const DIAS_RECORDATORIO_VENCIDO = 31; // un plazo vencido se sigue recordando hasta un mes después

const alertaCampana = (periodo, fecha, mensaje) => ({
    idalerta_traspaso: `reporte-horas-extra-${periodo}`,
    tipo: 'reporte_horas_extra',
    fecha_alerta: fecha,
    mensaje,
    leida_en: null,
    enlace: `/operaciones/reporte-horas-extra?periodo=${periodo}`
});

/**
 * Recordatorios para la campana del jefe: los reportes que financiera le devolvió, y los meses
 * cuya fecha límite está cerca o pasó hace menos de un mes sin que haya enviado el reporte.
 */
async function recordatoriosPara(usersCompanyId, hoy) {
    if (!usersCompanyId || !(await equipoRepo.tieneEmpleadosACargo(usersCompanyId))) return [];
    const { dias_aviso_reporte_horas_extra: diasAviso = 3 } = await parametroRepo.obtener();

    const devueltos = await reporteRepo.findDevueltosDeJefe(usersCompanyId);
    const periodos = await periodoRepo.findConLimiteEntre(sumarDias(hoy, -DIAS_RECORDATORIO_VENCIDO), sumarDias(hoy, diasAviso));
    const estados = await reporteRepo.findEstadosDeJefe(usersCompanyId, periodos.map((p) => p.periodo));

    const porVencer = periodos
        .filter((p) => estados[p.periodo]?.estado !== 'devuelto'
            && reglas.debeRecordar({ estado: estados[p.periodo]?.estado, hoy, desdeAviso: sumarDias(p.fecha_limite, -diasAviso) }))
        .map((p) => alertaCampana(
            p.periodo,
            p.fecha_limite,
            `${hoy > p.fecha_limite ? 'Se venció' : 'Vence'} el ${p.fecha_limite} el plazo para enviar a financiera el reporte de horas extras de ${p.periodo}`
        ));

    return [
        ...devueltos.map((r) => alertaCampana(
            r.periodo,
            r.revisado_en,
            `Financiera devolvió tu reporte de horas extras de ${r.periodo}: ${r.observacion_financiera}`
        )),
        ...porVencer
    ];
}

module.exports = {
    miReporte,
    guardarBorrador: (datos) => guardar({ ...datos, enviar: false }),
    enviar: (datos) => guardar({ ...datos, enviar: true }),
    resumenDelPeriodo,
    detalle,
    aprobar,
    devolver,
    fijarFechaLimite,
    recordatoriosPara
};
