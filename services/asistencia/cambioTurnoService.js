const db = require('../../config/db');
const solicitudRepo = require('../../repositories/asistencia/solicitudCambioTurnoRepository');
const notificacionRepo = require('../../repositories/asistencia/notificacionAsistenciaRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const horarioPlantillaRepo = require('../../repositories/asistencia/horarioPlantillaRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const notificacionAsistenciaService = require('./notificacionAsistenciaService');
const { notificarCambioJornada } = require('./notificacionService');
const {
    MAX_DIAS_CAMBIO_TURNO, assertFechasSolicitables, horarioNuevo, diasCambioHorario, diasIntercambio, resumenSolicitud, mensajes
} = require('../../domain/asistencia/cambioTurno');
const { fechaLaboral, sumarDias, normalizarFecha } = require('../../utils/fechaBogota');
const {
    NoAutorizadoError, NoEncontradoError, ConflictoJornadaError, ReglaAsistenciaError, ValidacionError
} = require('../../errors/AppError');

// Solicitudes de cambio de turno (migración 084, asistencia.md §50). El coordinador (jefe inmediato de
// alguien) pide el cambio de cualquier empleado activo; le llega a quien gestiona la asistencia de ese
// empleado, que lo aprueba —y el horario se reemplaza solo— o lo rechaza con un motivo. Cada paso deja
// una notificación en la campana: al jefe, al coordinador, a los empleados afectados y a financiera.

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

// Coordinador = jefe inmediato de alguien. Un jefe de área también puede pedir (y luego aprobarse a sí
// mismo), para no dejarlo por fuera si en su equipo nadie le reporta directo.
async function puedeSolicitar(usersCompanyId) {
    if (!usersCompanyId) return false;
    return (await equipoRepo.esJefeInmediato(usersCompanyId)) || (await equipoRepo.tieneEmpleadosACargo(usersCompanyId));
}

async function permisos({ usersCompanyId }) {
    return {
        puede_solicitar: await puedeSolicitar(usersCompanyId),
        puede_aprobar: Boolean(usersCompanyId) && await equipoRepo.tieneEmpleadosACargo(usersCompanyId)
    };
}

async function empleadosSolicitables() {
    return equipoRepo.empleadosActivosConGestor();
}

// Las plantillas que se le ofrecen al coordinador son las del jefe que va a aprobar (dueño = su ficha).
async function plantillasPara({ empleadoId }) {
    const gestor = await equipoRepo.jefeAreaDe(empleadoId);
    if (!gestor) throw new ReglaAsistenciaError('El empleado no tiene un jefe que gestione su asistencia');
    return horarioPlantillaRepo.findPorDueno(gestor);
}

async function horariosDe({ empleados, desde, hasta }) {
    const filas = await horarioAsignadoRepo.findRangoPorEmpleados(empleados, desde, hasta);
    return filas.map((h) => ({ ...h, fecha: normalizarFecha(h.fecha) }));
}

// Se corta un día después del máximo: basta para que assertFechasSolicitables rechace el rango.
function fechasDelRango(desde, hasta) {
    const fechas = [];
    for (let f = desde; f <= hasta && fechas.length <= MAX_DIAS_CAMBIO_TURNO; f = sumarDias(f, 1)) fechas.push(f);
    return fechas;
}

function porEmpleadoYFecha(horarios) {
    const mapa = new Map();
    for (const h of horarios) mapa.set(`${h.users_company_id}|${normalizarFecha(h.fecha)}`, h);
    return mapa;
}

// Las solicitudes con sus días (una consulta para todos los días).
async function conDias(solicitudes, conn = db) {
    const dias = await solicitudRepo.findDias(solicitudes.map((s) => s.idsolicitud_cambio_turno), conn);
    const porSolicitud = new Map();
    for (const d of dias) {
        if (!porSolicitud.has(d.solicitud_id)) porSolicitud.set(d.solicitud_id, []);
        porSolicitud.get(d.solicitud_id).push(d);
    }
    return solicitudes.map((s) => ({ ...s, dias: porSolicitud.get(s.idsolicitud_cambio_turno) || [] }));
}

async function notificar(notificaciones, conn) {
    await notificacionRepo.insertarVarias(notificaciones, conn);
}

const paraFinanciera = (idsFinanciera, datos) => idsFinanciera.map((userId) => ({ userId, ...datos }));

async function solicitar({
    solicitanteUsersCompanyId, tipo, motivo, empleadoId, empleado2Id, fecha, desde, hasta, plantillaId, valores, esDescanso, solicitadoPor
}) {
    requireUsersCompanyId(solicitanteUsersCompanyId);
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio) throw new ValidacionError('El motivo es obligatorio');

    let ids;
    let fechas;
    if (tipo === 'intercambio') {
        if (!empleado2Id || !fecha) throw new ValidacionError('El intercambio necesita los dos empleados y la fecha');
        ids = [Number(empleadoId), Number(empleado2Id)];
        fechas = [fecha];
    } else {
        if (!desde) throw new ValidacionError('Indique la fecha (desde) del cambio');
        const fin = hasta || desde;
        if (fin < desde) throw new ValidacionError('La fecha final no puede ser anterior a la inicial');
        ids = [Number(empleadoId)];
        fechas = fechasDelRango(desde, fin);
    }
    assertFechasSolicitables(fechas, fechaLaboral(new Date()));

    const gestores = await equipoRepo.gestoresDe(ids);
    if (ids.some((id) => !gestores.has(id))) {
        throw new ReglaAsistenciaError('El empleado no tiene contrato activo o no tiene un jefe que gestione su asistencia');
    }
    const aprobador = gestores.get(ids[0]);
    if (ids.some((id) => gestores.get(id) !== aprobador)) {
        throw new ReglaAsistenciaError('Para intercambiar turnos, los dos empleados deben tener el mismo jefe');
    }

    const actuales = porEmpleadoYFecha(await horarioAsignadoRepo.findRangoPorEmpleados(ids, fechas[0], fechas[fechas.length - 1]));
    let dias;
    if (tipo === 'intercambio') {
        dias = diasIntercambio(ids[0], ids[1], fecha, actuales.get(`${ids[0]}|${fecha}`), actuales.get(`${ids[1]}|${fecha}`));
    } else {
        let plantilla = null;
        if (plantillaId && !esDescanso) {
            plantilla = await horarioPlantillaRepo.findById(plantillaId);
            // Solo plantillas del jefe que va a aprobar (las de otro responden 404, como en §25).
            if (!plantilla || !plantilla.activo || plantilla.dueno_users_company_id !== aprobador) throw new NoEncontradoError('Plantilla no encontrada');
        }
        const nuevo = horarioNuevo({ plantilla, valores, esDescanso });
        const delEmpleado = new Map(fechas.map((f) => [f, actuales.get(`${ids[0]}|${f}`)]));
        dias = diasCambioHorario(ids[0], fechas, nuevo, delEmpleado);
    }

    const choques = await solicitudRepo.findPendientesQueChocan(ids, fechas);
    if (choques.length > 0) {
        throw new ConflictoJornadaError(`Ya hay una solicitud pendiente (#${choques[0].idsolicitud_cambio_turno}) para ese empleado en esa fecha`);
    }

    const idsFinanciera = await notificacionRepo.usuariosFinanciera();
    const conn = await db.getConnection();
    let notificaciones;
    let id;
    try {
        await conn.beginTransaction();
        id = await solicitudRepo.insertar(
            { tipo, solicitanteUsersCompanyId, solicitadoPor, aprobadorUsersCompanyId: aprobador, motivo: motivoLimpio },
            conn
        );
        await solicitudRepo.insertarDias(id, dias, conn);
        const [solicitud] = await conDias([await solicitudRepo.findById(id, conn)], conn);
        const mensaje = mensajes.solicitada(solicitud.solicitante, resumenSolicitud(tipo, solicitud.dias));
        const datos = { tipo: 'cambio_turno_solicitado', solicitudCambioTurnoId: id, mensaje };
        notificaciones = [{ usersCompanyId: aprobador, ...datos }, ...paraFinanciera(idsFinanciera, datos)];
        await notificar(notificaciones, conn);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    notificacionAsistenciaService.avisarEnVivo(notificaciones);
    return { success: true, idsolicitud_cambio_turno: id };
}

async function misSolicitudes({ usersCompanyId }) {
    requireUsersCompanyId(usersCompanyId);
    return conDias(await solicitudRepo.findListado({ solicitanteUsersCompanyId: usersCompanyId }));
}

async function bandeja({ directorUsersCompanyId, estado }) {
    requireUsersCompanyId(directorUsersCompanyId);
    return conDias(await solicitudRepo.findListado({ aprobadorUsersCompanyId: directorUsersCompanyId, estado }));
}

// Financiera ve todas, sin aprobar (§50).
async function todas({ estado, desde, hasta }) {
    return conDias(await solicitudRepo.findListado({ estado, desde, hasta }));
}

// Bloquea la solicitud y comprueba que sea del jefe y siga pendiente. La de otro jefe responde 404.
async function solicitudParaResolver(id, directorUsersCompanyId, conn) {
    const bloqueada = await solicitudRepo.findByIdParaActualizar(id, conn);
    if (!bloqueada || bloqueada.aprobador_users_company_id !== directorUsersCompanyId) throw new NoEncontradoError('Solicitud no encontrada');
    if (bloqueada.estado !== 'pendiente') throw new ConflictoJornadaError(`La solicitud ya está ${bloqueada.estado}`);
    const [solicitud] = await conDias([await solicitudRepo.findById(id, conn)], conn);
    return solicitud;
}

async function aprobar({ directorUsersCompanyId, id, comentario, resueltoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const hoy = fechaLaboral(new Date());
    const idsFinanciera = await notificacionRepo.usuariosFinanciera();
    const conn = await db.getConnection();
    let notificaciones;
    let solicitud;
    try {
        await conn.beginTransaction();
        solicitud = await solicitudParaResolver(id, directorUsersCompanyId, conn);
        const empleados = [...new Set(solicitud.dias.map((d) => d.users_company_id))];
        // Puede haber cambiado de jefe desde que se pidió: el horario solo lo cambia quien lo gestiona hoy.
        const aCargo = new Set(await equipoRepo.subordinadosDe(directorUsersCompanyId, empleados, conn));
        if (empleados.some((e) => !aCargo.has(e))) throw new NoAutorizadoError('El empleado ya no está a su cargo');
        if (solicitud.dias.some((d) => d.fecha < hoy)) {
            throw new ReglaAsistenciaError('La solicitud incluye días que ya pasaron: recházala y que pidan una nueva');
        }

        await horarioAsignadoRepo.insertarVarios(solicitud.dias.map((d) => ({
            usersCompanyId: d.users_company_id,
            fecha: d.fecha,
            horarioPlantillaId: d.horario_plantilla_id,
            horaEntrada: d.hora_entrada,
            horaSalida: d.hora_salida,
            minutosAlmuerzo: d.minutos_almuerzo,
            horaAlmuerzoInicio: d.hora_almuerzo_inicio,
            toleranciaEntradaMin: d.tolerancia_entrada_min,
            esDescanso: Boolean(d.es_descanso),
            creadoPor: resueltoPor,
            notas: `Cambio de turno #${id}`
        })), conn);
        const comentarioLimpio = String(comentario || '').trim() || null;
        await solicitudRepo.resolver(id, {
            estado: 'aprobada', comentario: comentarioLimpio, resueltoPorUsersCompanyId: directorUsersCompanyId, resueltoPor
        }, conn);

        const resumen = resumenSolicitud(solicitud.tipo, solicitud.dias);
        const base = { solicitudCambioTurnoId: id };
        notificaciones = [
            { ...base, usersCompanyId: solicitud.solicitante_users_company_id, tipo: 'cambio_turno_aprobado', mensaje: mensajes.aprobada(resumen, solicitud.aprobador) },
            ...empleados.map((e) => ({
                ...base, usersCompanyId: e, tipo: 'turno_cambiado',
                mensaje: mensajes.turnoCambiado(solicitud.dias.filter((d) => d.users_company_id === e))
            })),
            ...paraFinanciera(idsFinanciera, { ...base, tipo: 'cambio_turno_aprobado', mensaje: mensajes.resueltaParaFinanciera(resumen, solicitud.aprobador, true) })
        ];
        await notificar(notificaciones, conn);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    notificacionAsistenciaService.avisarEnVivo(notificaciones);
    // El turno de hoy cambia el estado en vivo (tardanza, botón de salida): que las pantallas recarguen.
    const conTurnoHoy = new Set(solicitud.dias.filter((d) => d.fecha === hoy).map((d) => d.users_company_id));
    for (const empleado of conTurnoHoy) await notificarCambioJornada(empleado, 'cambio_turno');
    return { success: true };
}

async function rechazar({ directorUsersCompanyId, id, motivoRechazo, resueltoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const motivoLimpio = String(motivoRechazo || '').trim();
    if (!motivoLimpio) throw new ValidacionError('El motivo de rechazo es obligatorio');
    const idsFinanciera = await notificacionRepo.usuariosFinanciera();
    const conn = await db.getConnection();
    let notificaciones;
    try {
        await conn.beginTransaction();
        const solicitud = await solicitudParaResolver(id, directorUsersCompanyId, conn);
        await solicitudRepo.resolver(id, {
            estado: 'rechazada', motivoRechazo: motivoLimpio, resueltoPorUsersCompanyId: directorUsersCompanyId, resueltoPor
        }, conn);
        const resumen = resumenSolicitud(solicitud.tipo, solicitud.dias);
        const base = { solicitudCambioTurnoId: id, tipo: 'cambio_turno_rechazado' };
        notificaciones = [
            { ...base, usersCompanyId: solicitud.solicitante_users_company_id, mensaje: mensajes.rechazada(resumen, solicitud.aprobador, motivoLimpio) },
            ...paraFinanciera(idsFinanciera, { ...base, mensaje: mensajes.resueltaParaFinanciera(resumen, solicitud.aprobador, false) })
        ];
        await notificar(notificaciones, conn);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    notificacionAsistenciaService.avisarEnVivo(notificaciones);
    return { success: true };
}

module.exports = {
    puedeSolicitar, permisos, empleadosSolicitables, plantillasPara, horariosDe,
    solicitar, misSolicitudes, bandeja, todas, aprobar, rechazar
};
