const db = require('../../config/db');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const {
    assertPuedeIniciarPausa,
    assertPuedeFinalizarPausa,
    assertPuedeMarcarSalida
} = require('../../domain/asistencia');
const { fechaLaboral } = require('../../utils/fechaBogota');
const { ConflictoJornadaError, NoEncontradoError } = require('../../errors/AppError');
const notificacionService = require('./notificacionService');
const consultaService = require('./consultaService');
const { calcularEstadoConDatos, construirTotales } = require('./jornadaCalculo');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

async function recalcularYGuardar(usersCompanyId, fecha, jornadaId, ahora, conn) {
    const { estadoCalculado, eventos } = await calcularEstadoConDatos(usersCompanyId, fecha, jornadaId, ahora, conn);
    await jornadaRepo.actualizarTotales(jornadaId, construirTotales(estadoCalculado, eventos), conn);
}

async function marcarEntrada({ usersCompanyId, contexto }) {
    requireUsersCompanyId(usersCompanyId);
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const existente = await jornadaRepo.findHoyParaActualizar(usersCompanyId, fecha, conn);
        if (existente) {
            await conn.commit();
            return consultaService.estadoDeHoy(usersCompanyId);
        }

        const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha, conn);
        const idjornada = await jornadaRepo.crear(
            { usersCompanyId, fecha, horarioAsignadoId: horario?.idhorario_asignado ?? null },
            conn
        );
        await eventoRepo.insertar(
            { jornadaId: idjornada, tipo: 'entrada', origen: 'empleado', registradoPorUserId: contexto.userId, ip: contexto.ip, userAgent: contexto.userAgent },
            conn
        );
        await recalcularYGuardar(usersCompanyId, fecha, idjornada, ahora, conn);

        await conn.commit();
        notificacionService.notificarDirector(usersCompanyId, 'entrada');
        return consultaService.estadoDeHoy(usersCompanyId);
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function iniciarPausa({ usersCompanyId, tipo, contexto }) {
    requireUsersCompanyId(usersCompanyId);
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, fecha, conn);
        if (!jornada) throw new ConflictoJornadaError('No hay una jornada iniciada');

        const { estadoCalculado } = await calcularEstadoConDatos(usersCompanyId, fecha, jornada.idjornada, ahora, conn);
        assertPuedeIniciarPausa(estadoCalculado, tipo);

        await eventoRepo.insertar(
            { jornadaId: jornada.idjornada, tipo: `inicio_${tipo}`, origen: 'empleado', registradoPorUserId: contexto.userId, ip: contexto.ip, userAgent: contexto.userAgent },
            conn
        );
        await recalcularYGuardar(usersCompanyId, fecha, jornada.idjornada, ahora, conn);

        await conn.commit();
        notificacionService.notificarDirector(usersCompanyId, `inicio_${tipo}`);
        return consultaService.estadoDeHoy(usersCompanyId);
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function finalizarPausa({ usersCompanyId, contexto }) {
    requireUsersCompanyId(usersCompanyId);
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, fecha, conn);
        if (!jornada) throw new ConflictoJornadaError('No hay una jornada iniciada');

        const { estadoCalculado } = await calcularEstadoConDatos(usersCompanyId, fecha, jornada.idjornada, ahora, conn);
        const tipoPausaActiva = estadoCalculado.pausaActiva?.tipo;
        assertPuedeFinalizarPausa(estadoCalculado, tipoPausaActiva);

        await eventoRepo.insertar(
            { jornadaId: jornada.idjornada, tipo: `fin_${tipoPausaActiva}`, origen: 'empleado', registradoPorUserId: contexto.userId, ip: contexto.ip, userAgent: contexto.userAgent },
            conn
        );
        await recalcularYGuardar(usersCompanyId, fecha, jornada.idjornada, ahora, conn);

        await conn.commit();
        notificacionService.notificarDirector(usersCompanyId, `fin_${tipoPausaActiva}`);
        return consultaService.estadoDeHoy(usersCompanyId);
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function marcarSalida({ usersCompanyId, contexto }) {
    requireUsersCompanyId(usersCompanyId);
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, fecha, conn);
        if (!jornada) throw new ConflictoJornadaError('No hay una jornada iniciada');

        const { estadoCalculado } = await calcularEstadoConDatos(usersCompanyId, fecha, jornada.idjornada, ahora, conn);
        assertPuedeMarcarSalida(estadoCalculado);

        await eventoRepo.insertar(
            { jornadaId: jornada.idjornada, tipo: 'salida', origen: 'empleado', registradoPorUserId: contexto.userId, ip: contexto.ip, userAgent: contexto.userAgent },
            conn
        );
        await recalcularYGuardar(usersCompanyId, fecha, jornada.idjornada, ahora, conn);

        await conn.commit();
        notificacionService.notificarDirector(usersCompanyId, 'salida');
        return consultaService.estadoDeHoy(usersCompanyId);
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = { marcarEntrada, iniciarPausa, finalizarPausa, marcarSalida };
