const db = require('../../config/db');
const solicitudRepo = require('../../repositories/asistencia/solicitudCambioTurnoRepository');
const notificacionRepo = require('../../repositories/asistencia/notificacionAsistenciaRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const horarioPlantillaRepo = require('../../repositories/asistencia/horarioPlantillaRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const notificacionAsistenciaService = require('./notificacionAsistenciaService');
const { notificarCambioJornada } = require('./notificacionService');
const {
    MAX_DIAS_CAMBIO_TURNO, assertFechasSolicitables, horarioNuevo, diasCambioHorario, diasIntercambio, diasLibre, resumenSolicitud, mensajes
} = require('../../domain/asistencia/cambioTurno');
const { assertAprobador, aprobadorDeNovedad } = require('../../domain/asistencia/aprobacionJerarquica');
const { fechaLaboral, sumarDias, normalizarFecha } = require('../../utils/fechaBogota');
const {
    NoAutorizadoError, NoEncontradoError, ConflictoJornadaError, ReglaAsistenciaError, ValidacionError
} = require('../../errors/AppError');

// Solicitudes de cambio de turno (migración 084, asistencia.md §50; flujo de §51). El jefe de
// operaciones —quien gestiona la asistencia del empleado— pide el cambio de alguien de su equipo; le
// llega a SU jefe, el director, que lo aprueba —y el horario se reemplaza solo— o lo rechaza con un
// motivo. Cada paso deja una notificación en la campana: al director, al jefe, a los empleados
// afectados y a financiera.
//
// Novedades de asistencia (§86): el coordinador (jefe inmediato) también pide, por su gente directa, un cambio
// de turno o días libres (tipo 'libre'); le llegan a quien gestiona al empleado, el jefe de operaciones
// (`aprobadorDeNovedad`). La traza queda en la solicitud: `creado_en` (enviada) y `resuelta_en` (aprobada o
// rechazada), con quién pidió y quién resolvió.

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

// Solicita solo el coordinador: cargo de coordinador y jefe inmediato de alguien a quien no gestiona (§86). El jefe de operaciones aprueba
// y no pide; el agente no tiene gente. No hay roles: sale de RRHH (§23).
async function puedeSolicitar(usersCompanyId) {
    if (!usersCompanyId) return false;
    return equipoRepo.tieneSolicitables(usersCompanyId);
}

// `puede_aprobar`: tiene jefes a su cargo (el director); lo usa también la pantalla de horas extra (§51).
// `puede_aprobar_novedades` (§86): gestiona a alguien, así que le pueden llegar las novedades de sus coordinadores.
async function permisos({ usersCompanyId }) {
    if (!usersCompanyId) return { puede_solicitar: false, puede_aprobar: false, puede_aprobar_novedades: false };
    const [puedeSolicitarNovedad, gestiona, tieneJefes] = await Promise.all([
        equipoRepo.tieneSolicitables(usersCompanyId),
        equipoRepo.tieneEmpleadosACargo(usersCompanyId),
        equipoRepo.tieneJefesACargo(usersCompanyId)
    ]);
    return { puede_solicitar: puedeSolicitarNovedad, puede_aprobar: tieneJefes, puede_aprobar_novedades: gestiona || tieneJefes };
}

// Quién aprueba cada empleado que pide esta ficha (§86). `gestorPropio` = { gestor_id, gestor } de quien pide.
function conAprobador(solicitanteId, gestorPropio) {
    return (fila) => {
        const aprobadorId = aprobadorDeNovedad({
            solicitanteId, gestorDelEmpleadoId: fila.gestor_id, gestorDelSolicitanteId: gestorPropio?.gestor_id ?? null
        });
        const esElGestorDelEmpleado = Boolean(fila.gestor_id) && aprobadorId === fila.gestor_id && fila.gestor_id !== solicitanteId;
        return { aprobadorId, aprobador: esElGestorDelEmpleado ? fila.gestor : gestorPropio?.gestor ?? null };
    };
}

// La gente directa del coordinador. `gestor_id`/`gestor` es a quién le llega la solicitud de cada uno: el jefe de
// operaciones que gestiona al empleado.
async function empleadosSolicitables({ usersCompanyId }) {
    requireUsersCompanyId(usersCompanyId);
    const [empleados, gestorPropio] = await Promise.all([
        equipoRepo.solicitablesDe(usersCompanyId),
        equipoRepo.gestorConNombreDe(usersCompanyId)
    ]);
    const aprobadorDe = conAprobador(usersCompanyId, gestorPropio);
    return empleados.map((e) => {
        const { aprobadorId, aprobador } = aprobadorDe(e);
        const valido = aprobadorId && aprobadorId !== usersCompanyId;
        return {
            users_company_id: e.users_company_id,
            nombre: e.nombre_propio,
            cedula: e.numero_identificacion,
            cargo: e.cargo,
            campania: e.campania,
            centro_costo_id: e.centro_costo_id,
            centro_costo: e.centro_costo,
            gestor_id: valido ? aprobadorId : null,
            gestor: valido ? aprobador : null
        };
    });
}

// Plantillas que se le ofrecen: las suyas (dueño = su ficha, §25) y, si pide por un empleado, las de quien lo
// gestiona: el coordinador no tiene plantillas y usa las de su jefe de operaciones (§86).
async function plantillasPara({ solicitanteUsersCompanyId, empleadoId }) {
    requireUsersCompanyId(solicitanteUsersCompanyId);
    const duenos = new Set([solicitanteUsersCompanyId]);
    if (empleadoId) {
        const [fila] = await equipoRepo.solicitablesEntre(solicitanteUsersCompanyId, [Number(empleadoId)]);
        if (fila?.gestor_id) duenos.add(fila.gestor_id);
    }
    const listas = await Promise.all([...duenos].map((d) => horarioPlantillaRepo.findPorDueno(d)));
    return listas.flat();
}

// El turno actual de gente por la que puede pedir (vista previa antes de pedir).
async function horariosDe({ solicitanteUsersCompanyId, empleados, desde, hasta }) {
    requireUsersCompanyId(solicitanteUsersCompanyId);
    const propios = (await equipoRepo.solicitablesEntre(solicitanteUsersCompanyId, empleados)).map((f) => f.users_company_id);
    const filas = await horarioAsignadoRepo.findRangoPorEmpleados(propios, desde, hasta);
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

    if (new Set(ids).size !== ids.length) throw new ReglaAsistenciaError('Para intercambiar turnos elija dos empleados distintos');
    const filas = await equipoRepo.solicitablesEntre(solicitanteUsersCompanyId, ids);
    const propios = new Map(filas.map((f) => [f.users_company_id, f]));
    if (ids.some((id) => !propios.has(id))) throw new NoAutorizadoError('El empleado no está a su cargo');
    // Aprueba el jefe de operaciones del empleado o, si quien pide es ese jefe, su director (§86).
    const aprobadorDe = conAprobador(solicitanteUsersCompanyId, { gestor_id: await equipoRepo.jefeAreaDe(solicitanteUsersCompanyId) });
    const aprobadores = [...new Set(ids.map((id) => aprobadorDe(propios.get(id)).aprobadorId))];
    if (aprobadores.length > 1) throw new ReglaAsistenciaError('Los dos empleados deben tener el mismo jefe de operaciones para intercambiar turnos');
    const aprobador = aprobadores[0];
    assertAprobador(solicitanteUsersCompanyId, aprobador);

    const actuales = porEmpleadoYFecha(await horarioAsignadoRepo.findRangoPorEmpleados(ids, fechas[0], fechas[fechas.length - 1]));
    let dias;
    if (tipo === 'intercambio') {
        dias = diasIntercambio(ids[0], ids[1], fecha, actuales.get(`${ids[0]}|${fecha}`), actuales.get(`${ids[1]}|${fecha}`));
    } else if (tipo === 'libre') {
        dias = diasLibre(ids[0], fechas, new Map(fechas.map((f) => [f, actuales.get(`${ids[0]}|${f}`)])));
    } else {
        let plantilla = null;
        if (plantillaId && !esDescanso) {
            plantilla = await horarioPlantillaRepo.findById(plantillaId);
            // Solo plantillas de quien pide o del jefe de operaciones del empleado (§86); las de otro responden 404 (§25).
            const duenos = [solicitanteUsersCompanyId, propios.get(ids[0]).gestor_id];
            if (!plantilla || !plantilla.activo || !duenos.includes(plantilla.dueno_users_company_id)) throw new NoEncontradoError('Plantilla no encontrada');
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
        // Puede haber cambiado de jefe desde que se pidió: solo se aplica si quien lo pidió todavía puede pedir por
        // ellos (los gestiona o es su jefe inmediato, §86).
        const aCargo = new Set((await equipoRepo.solicitablesEntre(solicitud.solicitante_users_company_id, empleados, conn)).map((f) => f.users_company_id));
        if (empleados.some((e) => !aCargo.has(e))) throw new NoAutorizadoError('El empleado ya no está en el equipo de quien pidió el cambio');
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
            esLibre: solicitud.tipo === 'libre',
            creadoPor: resueltoPor,
            notas: solicitud.tipo === 'libre' ? `Libre #${id}` : `Cambio de turno #${id}`
        })), conn);
        const comentarioLimpio = String(comentario || '').trim() || null;
        await solicitudRepo.resolver(id, {
            estado: 'aprobada', comentario: comentarioLimpio, resueltoPorUsersCompanyId: directorUsersCompanyId, resueltoPor
        }, conn);

        const resumen = resumenSolicitud(solicitud.tipo, solicitud.dias);
        const base = { solicitudCambioTurnoId: id };
        notificaciones = [
            { ...base, usersCompanyId: solicitud.solicitante_users_company_id, tipo: 'cambio_turno_aprobado', mensaje: mensajes.aprobada(resumen, solicitud.aprobador) },
            ...empleados.map((e) => {
                const suyos = solicitud.dias.filter((d) => d.users_company_id === e);
                return {
                    ...base, usersCompanyId: e, tipo: 'turno_cambiado',
                    mensaje: solicitud.tipo === 'libre' ? mensajes.libreAprobado(suyos) : mensajes.turnoCambiado(suyos)
                };
            }),
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
