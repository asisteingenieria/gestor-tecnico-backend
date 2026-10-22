const db = require('../../config/db');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const festivoRepo = require('../../repositories/asistencia/festivoRepository');
const ventanaNocturnaRepo = require('../../repositories/asistencia/ventanaNocturnaRepository');
const equipoService = require('./equipoService');
const { clasificarHoraExtra, totalMinutos, claseDominante } = require('../../domain/asistencia/clasificarHoraExtra');
const { CLASES } = require('../../domain/asistencia/reporteHorasExtra');
const { sumarDias, normalizarFecha } = require('../../utils/fechaBogota');
const { NoEncontradoError, ConflictoJornadaError, ValidacionError } = require('../../errors/AppError');

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

// Normaliza y valida los tramos que manda el jefe al aprobar (ajuste manual): una fila por clase
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

async function solicitar({ usersCompanyId, fecha, horaInicio, horaFin, motivo, solicitadoPor }) {
    requireUsersCompanyId(usersCompanyId);
    const fechaStr = normalizarFecha(fecha);
    const tramos = await calcularTramos(usersCompanyId, fechaStr, horaInicio, horaFin);
    const minutosEstimados = totalMinutos(tramos);
    if (minutosEstimados <= 0) throw new ValidacionError('La franja de horas extra no suma tiempo');

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const idhoraExtra = await horaExtraRepo.insertarSolicitud(
            { usersCompanyId, fecha: fechaStr, horaInicio, horaFin, minutosEstimados, clase: claseDominante(tramos), motivo, solicitadoPor },
            conn
        );
        await horaExtraRepo.insertarTramos(idhoraExtra, tramos, conn);
        await conn.commit();
        return { success: true, idhora_extra: idhoraExtra, minutos_estimados: minutosEstimados, tramos };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

// El agente puede ver antes de enviar cómo quedaría clasificada su franja (sin guardar nada).
async function previsualizar({ usersCompanyId, fecha, horaInicio, horaFin }) {
    requireUsersCompanyId(usersCompanyId);
    const tramos = await calcularTramos(usersCompanyId, normalizarFecha(fecha), horaInicio, horaFin);
    return { tramos, minutos: totalMinutos(tramos) };
}

async function misHorasExtra({ usersCompanyId, estado }) {
    requireUsersCompanyId(usersCompanyId);
    const filas = await horaExtraRepo.findPorEmpleado(usersCompanyId, { estado });
    return adjuntarTramos(filas);
}

async function bandeja({ directorUsersCompanyId, estado }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const empleados = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    const filas = await horaExtraRepo.findPorEquipo(empleados.map((e) => e.users_company_id), { estado });
    return adjuntarTramos(filas);
}

// Aprobar: el jefe confirma la clasificación o la ajusta (manda `tramos`). Los minutos aprobados son
// la suma de los tramos efectivos. Si no manda tramos, se quedan los que calculó el servidor.
async function aprobar({ directorUsersCompanyId, idhoraExtra, tramos, comentario, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await horaExtraRepo.findById(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, solicitud.users_company_id);
    if (solicitud.estado !== 'pendiente') {
        throw new ConflictoJornadaError(`La solicitud de hora extra ya está ${solicitud.estado === 'pendiente' ? 'resuelta' : solicitud.estado}`);
    }

    const ajuste = normalizarTramos(tramos);
    const efectivos = ajuste.length > 0 ? ajuste : await horaExtraRepo.findTramos(idhoraExtra);
    const minutosAprobados = totalMinutos(efectivos);
    if (minutosAprobados <= 0) throw new ValidacionError('La hora extra aprobada no suma tiempo');

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
        await conn.commit();
        return { success: true };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

async function rechazar({ directorUsersCompanyId, idhoraExtra, comentario, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const solicitud = await horaExtraRepo.findById(idhoraExtra);
    if (!solicitud) throw new NoEncontradoError('Solicitud de hora extra no encontrada');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, solicitud.users_company_id);
    if (solicitud.estado !== 'pendiente') {
        throw new ConflictoJornadaError(`La solicitud de hora extra ya está ${solicitud.estado === 'pendiente' ? 'resuelta' : solicitud.estado}`);
    }

    const resuelta = await horaExtraRepo.resolver(idhoraExtra, { estado: 'rechazada', minutosAprobados: null, comentario, aprobadoPor });
    if (!resuelta) throw new ConflictoJornadaError('La solicitud de hora extra ya está resuelta');
    return { success: true };
}

// Asignar: el jefe crea una hora extra ya aprobada. Aquí sí elige la clase y los minutos a mano
// (es una asignación directa), y se guarda como un tramo único.
async function asignar({ directorUsersCompanyId, empleados, fecha, minutos, clase, motivo, aprobadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    for (const empleadoId of empleados) {
        await equipoService.assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
    }
    const fechaStr = normalizarFecha(fecha);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const ids = [];
        for (const empleadoId of empleados) {
            const id = await horaExtraRepo.insertarAsignada({ usersCompanyId: empleadoId, fecha: fechaStr, minutos, clase, motivo, aprobadoPor }, conn);
            await horaExtraRepo.insertarTramos(id, [{ clase, minutos }], conn);
            ids.push(id);
        }
        await conn.commit();
        return { success: true, ids };
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

module.exports = { solicitar, previsualizar, misHorasExtra, bandeja, aprobar, rechazar, asignar };
