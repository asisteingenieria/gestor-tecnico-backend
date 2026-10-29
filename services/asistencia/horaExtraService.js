const db = require('../../config/db');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const festivoRepo = require('../../repositories/asistencia/festivoRepository');
const ventanaNocturnaRepo = require('../../repositories/asistencia/ventanaNocturnaRepository');
const notificacionRepo = require('../../repositories/asistencia/notificacionAsistenciaRepository');
const notificacionAsistenciaService = require('./notificacionAsistenciaService');
const { clasificarHoraExtra, totalMinutos, claseDominante } = require('../../domain/asistencia/clasificarHoraExtra');
const { CLASES } = require('../../domain/asistencia/reporteHorasExtra');
const { assertAprobador, mensajesHoraExtra } = require('../../domain/asistencia/aprobacionJerarquica');
const { sumarDias, normalizarFecha } = require('../../utils/fechaBogota');
const { NoAutorizadoError, NoEncontradoError, ConflictoJornadaError, ValidacionError } = require('../../errors/AppError');

// Horas extra (asistencia.md §32, flujo de §51): el jefe de operaciones las solicita por su personal
// —el empleado ya no las pide— y las aprueba su director, quien gestiona la asistencia del jefe. Las
// del flujo anterior (sin aprobador) las sigue resolviendo quien gestiona al empleado.

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

// Festivo del negocio: festivo nacional (tabla) o domingo (día de la semana, en UTC para no derivar).
function esDomingo(fecha) {
    return new Date(`${fecha}T00:00:00Z`).getUTCDay() === 0;
}

// Clasifica la franja solicitada en tramos, resolviendo antes el turno, los festivos y la ventana
// nocturna vigente. Puro cálculo del dominio con los datos ya leídos de la BD.
async function calcularTramos(usersCompanyId, fecha, horaInicio, horaFin, conn = db) {
    const siguiente = sumarDias(fecha, 1);
    const [turno, festivos, ventanaNocturna] = await Promise.all([
        horarioAsignadoRepo.findByEmpleadoYFecha(usersCompanyId, fecha, conn),
        festivoRepo.sonFestivos([fecha, siguiente], conn),
        ventanaNocturnaRepo.vigenteEn(fecha, conn)
    ]);
    if (!ventanaNocturna) throw new ValidacionError('No hay una ventana nocturna configurada para esa fecha');
    return clasificarHoraExtra({
        inicio: horaInicio,
        fin: horaFin,
        turno: turno ? { entrada: turno.hora_entrada, salida: turno.hora_salida, esDescanso: !!turno.es_descanso } : null,
        dia0EsFestivo: festivos.has(fecha) || esDomingo(fecha),
        dia1EsFestivo: festivos.has(siguiente) || esDomingo(siguiente),
        ventanaNocturna
    });
}

// Normaliza y valida los tramos que manda el director al aprobar (ajuste manual): una fila por clase
// válida, con minutos enteros positivos; si repite una clase, se suman.
function normalizarTramos(tramos) {
    const porClase = new Map();
    for (const t of tramos || []) {
        const minutos = Math.round(Number(t.minutos) || 0);
        if (!CLASES.includes(t.clase) || minutos <= 0) continue;
        porClase.set(t.clase, (porClase.get(t.clase) || 0) + minutos);
    }
    return CLASES.filter((c) => porClase.has(c)).map((c) => ({ clase: c, minutos: porClase.get(c) }));
}

// Adjunta a cada hora extra sus tramos (clasificación), en una sola consulta.
async function adjuntarTramos(filas) {
    const ids = filas.map((f) => f.idhora_extra);
    const tramos = await horaExtraRepo.findTramosPorHorasExtra(ids);
    const porId = new Map();
    for (const t of tramos) {
        if (!porId.has(t.idhora_extra)) porId.set(t.idhora_extra, []);
        porId.get(t.idhora_extra).push({ clase: t.clase, minutos: t.minutos });
    }
    return filas.map((f) => ({ ...f, tramos: porId.get(f.idhora_extra) || [] }));
}

// Solo a la gente que el jefe gestiona directamente (una consulta para todos).
async function assertEquipoDirecto(jefeUsersCompanyId, empleados, conn = db) {
    const ids = [...new Set(empleados.map(Number))];
    if (ids.length === 0) throw new ValidacionError('Elija al menos un empleado');
    const aCargo = new Set(await equipoRepo.subordinadosDe(jefeUsersCompanyId, ids, conn));
    if (ids.some((id) => !aCargo.has(id))) throw new NoAutorizadoError('El empleado no está a su cargo');
    return ids;
}

// El jefe pide horas extra para uno o varios de su equipo, en la misma franja. Cada persona queda en
// su propia solicitud porque la clasificación depende de su turno de ese día.
async function solicitar({ jefeUsersCompanyId, empleados, fecha, horaInicio, horaFin, motivo, solicitadoPor }) {
    requireUsersCompanyId(jefeUsersCompanyId);
    const motivoLimpio = String(motivo || '').trim();
    if (!motivoLimpio) throw new ValidacionError('El motivo es obligatorio');
    const fechaStr = normalizarFecha(fecha);
    const ids = await assertEquipoDirecto(jefeUsersCompanyId, empleados);
    const aprobador = await equipoRepo.jefeAreaDe(jefeUsersCompanyId);
    assertAprobador(jefeUsersCompanyId, aprobador);

    const clasificadas = await Promise.all(ids.map(async (id) => ({ id, tramos: await calcularTramos(id, fechaStr, horaInicio, horaFin) })));
    if (clasificadas.some((c) => totalMinutos(c.tramos) <= 0)) throw new ValidacionError('La franja de horas extra no suma tiempo');

    const conn = await db.getConnection();
    const creadas = [];
    let notificaciones;
    try {
        await conn.beginTransaction();
        for (const { id, tramos } of clasificadas) {
            const idhoraExtra = await horaExtraRepo.insertarSolicitud({
                usersCompanyId: id, fecha: fechaStr, horaInicio, horaFin, minutosEstimados: totalMinutos(tramos), clase: claseDominante(tramos),
                motivo: motivoLimpio, solicitadoPor, solicitanteUsersCompanyId: jefeUsersCompanyId, aprobadorUsersCompanyId: aprobador
            }, conn);
            await horaExtraRepo.insertarTramos(idhoraExtra, tramos, conn);
            creadas.push(await horaExtraRepo.findDetalle(idhoraExtra, conn));
        }
        notificaciones = [{
            usersCompanyId: aprobador,
            tipo: 'hora_extra_solicitada',
            horaExtraId: creadas[0].idhora_extra,
            mensaje: mensajesHoraExtra.solicitada(creadas[0].solicitante, creadas.map((c) => c.empleado), fechaStr, horaInicio, horaFin)
        }];
        await notificacionRepo.insertarVarias(notificaciones, conn);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    notificacionAsistenciaService.avisarEnVivo(notificaciones);
    return { success: true, ids: creadas.map((c) => c.idhora_extra), aprobador: creadas[0].aprobador };
}

// El jefe ve antes de enviar cómo quedaría clasificada la franja para cada persona (sin guardar nada).
async function previsualizar({ jefeUsersCompanyId, empleados, fecha, horaInicio, horaFin }) {
    requireUsersCompanyId(jefeUsersCompanyId);
    const fechaStr = normalizarFecha(fecha);
    const ids = await assertEquipoDirecto(jefeUsersCompanyId, empleados);
    return Promise.all(ids.map(async (id) => {
        const tramos = await calcularTramos(id, fechaStr, horaInicio, horaFin);
        return { users_company_id: id, tramos, minutos: totalMinutos(tramos) };
    }));
}

// Las del empleado, solo para consultar: desde §51 no las pide él.
async function misHorasExtra({ usersCompanyId, estado }) {
    requireUsersCompanyId(usersCompanyId);
    const filas = await horaExtraRepo.findPorEmpleado(usersCompanyId, { estado });
    return adjuntarTramos(filas);
}

// Las que pidió este jefe, con su estado.
async function misSolicitudes({ jefeUsersCompanyId, estado }) {
    requireUsersCompanyId(jefeUsersCompanyId);
    return adjuntarTramos(await horaExtraRepo.findPorSolicitante(jefeUsersCompanyId, { estado }));
}

async function bandeja({ directorUsersCompanyId, estado }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const directos = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    const filas = await horaExtraRepo.findBandeja(directorUsersCompanyId, directos.map((e) => e.users_company_id), { estado });
    return adjuntarTramos(filas);
}

// ¿Le toca a este director? La de otro responde 404, como en §25. Las del flujo anterior (sin
// aprobador) son de quien gestiona hoy al empleado.
async function solicitudParaResolver(directorUsersCompanyId, idhoraExtra) {
    const solicitud = await horaExtraRepo.findDetalle(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    if (solicitud.aprobador_users_company_id) {
        if (solicitud.aprobador_users_company_id !== directorUsersCompanyId) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    } else if (!(await equipoRepo.esSubordinado(directorUsersCompanyId, solicitud.users_company_id))) {
        throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    }
    if (solicitud.estado !== 'pendiente') throw new ConflictoJornadaError(`La solicitud de hora extra ya está ${solicitud.estado}`);
    return solicitud;
}

// Avisos al resolver una del flujo nuevo: al jefe que la pidió y, si se aprobó, al empleado.
function avisosDeResolucion(solicitud, aprobada, motivo) {
    if (!solicitud.solicitante_users_company_id) return [];
    const fecha = normalizarFecha(solicitud.fecha);
    const base = { horaExtraId: solicitud.idhora_extra };
    const avisos = [{
        ...base,
        usersCompanyId: solicitud.solicitante_users_company_id,
        tipo: aprobada ? 'hora_extra_aprobada' : 'hora_extra_rechazada',
        mensaje: aprobada
            ? mensajesHoraExtra.aprobada(solicitud.empleado, fecha, solicitud.aprobador)
            : mensajesHoraExtra.rechazada(solicitud.empleado, fecha, solicitud.aprobador, motivo)
    }];
    if (aprobada && solicitud.hora_inicio && solicitud.hora_fin) {
        avisos.push({
            ...base, usersCompanyId: solicitud.users_company_id, tipo: 'hora_extra_aprobada',
            mensaje: mensajesHoraExtra.paraEmpleado(fecha, solicitud.hora_inicio, solicitud.hora_fin)
        });
    }
    return avisos;
}

// Aprobar: el director confirma la clasificación o la ajusta (manda `tramos`). Los minutos aprobados
// son la suma de los tramos efectivos. Si no manda tramos, se quedan los que calculó el servidor.
async function aprobar({ directorUsersCompanyId, idhoraExtra, tramos, comentario, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await solicitudParaResolver(directorUsersCompanyId, idhoraExtra);

    const ajuste = normalizarTramos(tramos);
    const efectivos = ajuste.length > 0 ? ajuste : await horaExtraRepo.findTramos(idhoraExtra);
    const minutosAprobados = totalMinutos(efectivos);
    if (minutosAprobados <= 0) throw new ValidacionError('La hora extra aprobada no suma tiempo');

    const notificaciones = avisosDeResolucion(solicitud, true);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const resuelta = await horaExtraRepo.resolver(
            idhoraExtra,
            { estado: 'aprobada', minutosAprobados, clase: claseDominante(efectivos), comentario, aprobadoPor },
            conn
        );
        if (!resuelta) throw new ConflictoJornadaError('La solicitud de hora extra ya está resuelta');
        if (ajuste.length > 0) await horaExtraRepo.reemplazarTramos(idhoraExtra, efectivos, conn);
        await notificacionRepo.insertarVarias(notificaciones, conn);
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

async function rechazar({ directorUsersCompanyId, idhoraExtra, comentario, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await solicitudParaResolver(directorUsersCompanyId, idhoraExtra);
    const motivo = String(comentario || '').trim() || null;

    const notificaciones = avisosDeResolucion(solicitud, false, motivo);
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const resuelta = await horaExtraRepo.resolver(idhoraExtra, { estado: 'rechazada', minutosAprobados: null, comentario: motivo, aprobadoPor }, conn);
        if (!resuelta) throw new ConflictoJornadaError('La solicitud de hora extra ya está resuelta');
        await notificacionRepo.insertarVarias(notificaciones, conn);
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

module.exports = { solicitar, previsualizar, misHorasExtra, misSolicitudes, bandeja, aprobar, rechazar };
