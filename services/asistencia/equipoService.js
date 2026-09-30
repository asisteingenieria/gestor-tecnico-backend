const db = require('../../config/db');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const { fechaLaboral } = require('../../utils/fechaBogota');
const { NoAutorizadoError, NoEncontradoError } = require('../../errors/AppError');
const { calcularEstadoConDatos, construirTotales } = require('./jornadaCalculo');
const cierreService = require('./cierreService');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

async function assertEmpleadoACargo(directorUsersCompanyId, empleadoId, conn) {
    const aCargo = await equipoRepo.esSubordinado(directorUsersCompanyId, empleadoId, conn);
    if (!aCargo) throw new NoAutorizadoError('El empleado no está a su cargo');
}

async function equipo(directorUsersCompanyId) {
    requireUsersCompanyId(directorUsersCompanyId);
    const empleados = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);

    return Promise.all(empleados.map(async (empleado) => {
        const jornada = await jornadaRepo.findPorFecha(empleado.users_company_id, fecha);
        const { estadoCalculado } = await calcularEstadoConDatos(empleado.users_company_id, fecha, jornada?.idjornada ?? null, ahora);
        return {
            users_company_id: empleado.users_company_id,
            nombre: empleado.nombre_propio,
            cedula: empleado.numero_identificacion,
            cargo: empleado.cargo,
            estado: estadoCalculado.estado,
            minutos_trabajados: estadoCalculado.minutosTrabajados,
            pausa_activa: estadoCalculado.pausaActiva,
            alertas: estadoCalculado.alertas
        };
    }));
}

async function jornadasDe({ directorUsersCompanyId, empleadoId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
    await cierreService.normalizarRangoSiEsPasado(empleadoId, desde, hasta, new Date());
    return jornadaRepo.findRango(empleadoId, desde, hasta);
}

async function trazabilidadDe({ directorUsersCompanyId, empleadoId, fecha }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
    await cierreService.normalizarSiEsPasada(empleadoId, fecha, new Date());

    const jornada = await jornadaRepo.findPorFecha(empleadoId, fecha);
    if (!jornada) throw new NoEncontradoError('No hay jornada registrada para esa fecha');

    const eventos = await eventoRepo.findByJornada(jornada.idjornada);
    const { estadoCalculado } = await calcularEstadoConDatos(empleadoId, fecha, jornada.idjornada, new Date());

    return {
        fecha,
        jornada: { ...jornada, ...estadoCalculado },
        eventos: eventos.map((e) => ({
            tipo: e.tipo,
            ocurrido_en: e.ocurrido_en.toISOString(),
            origen: e.origen,
            registrado_por_user_id: e.registrado_por_user_id,
            nota: e.nota
        }))
    };
}

async function estadisticasEquipo({ directorUsersCompanyId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const empleados = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);

    const porEmpleado = await Promise.all(empleados.map(async (empleado) => {
        await cierreService.normalizarRangoSiEsPasado(empleado.users_company_id, desde, hasta, new Date());
        const jornadas = await jornadaRepo.findRango(empleado.users_company_id, desde, hasta);
        const diasTrabajados = jornadas.filter((j) => j.estado !== 'pendiente' && j.estado !== 'ausente').length;
        const diasPuntuales = jornadas.filter((j) => j.minutos_tarde === 0 && j.estado !== 'pendiente').length;
        return {
            users_company_id: empleado.users_company_id,
            nombre: empleado.nombre_propio,
            dias_trabajados: diasTrabajados,
            ausencias: jornadas.filter((j) => j.estado === 'ausente').length,
            minutos_tarde_acumulados: jornadas.reduce((acc, j) => acc + j.minutos_tarde, 0),
            minutos_extra_acumulados: jornadas.reduce((acc, j) => acc + j.minutos_extra, 0),
            porcentaje_puntualidad: diasTrabajados > 0 ? Math.round((diasPuntuales / diasTrabajados) * 100) : null
        };
    }));

    return { desde, hasta, empleados: porEmpleado };
}

async function registrarEventoManual({ directorUsersCompanyId, jornadaId, tipo, nota, registradoPorUserId }) {
    requireUsersCompanyId(directorUsersCompanyId);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const jornada = await jornadaRepo.findByIdParaActualizar(jornadaId, conn);
        if (!jornada) throw new NoEncontradoError('Jornada no encontrada');
        await assertEmpleadoACargo(directorUsersCompanyId, jornada.users_company_id, conn);

        await eventoRepo.insertar(
            { jornadaId: jornada.idjornada, tipo, origen: 'director', registradoPorUserId, nota },
            conn
        );

        const fecha = jornada.fecha instanceof Date ? jornada.fecha.toISOString().slice(0, 10) : jornada.fecha;
        const { estadoCalculado, eventos } = await calcularEstadoConDatos(jornada.users_company_id, fecha, jornada.idjornada, new Date(), conn);
        await jornadaRepo.actualizarTotales(jornada.idjornada, construirTotales(estadoCalculado, eventos), conn);

        await conn.commit();
        return { success: true };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = {
    assertEmpleadoACargo,
    equipo,
    jornadasDe,
    trazabilidadDe,
    estadisticasEquipo,
    registrarEventoManual
};
