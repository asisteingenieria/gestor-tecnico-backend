const db = require('../../config/db');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const { fechaLaboral, rangoDelMes } = require('../../utils/fechaBogota');
const { NoAutorizadoError, NoEncontradoError, ValidacionError } = require('../../errors/AppError');
const { resumenDeJornadas, totalesEquipo } = require('../../domain/asistencia/resumenMensual');
const { calcularEstadoConDatos, calcularEstadosDelDia, construirTotales } = require('./jornadaCalculo');
const cierreService = require('./cierreService');
const asislockVista = require('./asislockVista');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

async function assertEmpleadoACargo(directorUsersCompanyId, empleadoId, conn) {
    const aCargo = await equipoRepo.esSubordinado(directorUsersCompanyId, empleadoId, conn);
    if (!aCargo) throw new NoAutorizadoError('El empleado no está a su cargo');
}

// Para consultar basta con que la persona cuelgue de él en cualquier nivel (el director ve a la gente
// de sus jefes, §51). Para escribir —horarios, horas extra, correcciones— sigue siendo assertEmpleadoACargo.
async function assertEmpleadoEnArbol(directorUsersCompanyId, empleadoId) {
    if (!(await equipoRepo.esDelArbol(directorUsersCompanyId, empleadoId))) throw new NoAutorizadoError('El empleado no está a su cargo');
}

// La gente del árbol con la forma que esperan las pantallas de equipo. `jefe_area` = quién la gestiona,
// solo para la que no es directa (en la directa es él mismo).
async function empleadosDelArbol(directorUsersCompanyId) {
    const empleados = await equipoRepo.listaEmpleadosDelArbol(directorUsersCompanyId);
    return empleados.map((e) => ({
        ...e,
        nombre: e.nombre_propio,
        cedula: e.numero_identificacion,
        jefe_area: e.directo ? null : e.jefe
    }));
}

// Jefe de equipo = ficha que es jefe de área de algún contrato activo. Se calcula en cada
// consulta (no se guarda) para que siga a RRHH cuando cambia la jerarquía.
async function esJefeDeEquipo(usersCompanyId) {
    if (!usersCompanyId) return false;
    return equipoRepo.tieneEmpleadosACargo(usersCompanyId);
}

async function cargoDe(usersCompanyId) {
    if (!usersCompanyId) return null;
    return equipoRepo.cargoDe(usersCompanyId);
}

// "Equipo hoy": toda la gente que cuelga de él. `directo` dice a quién gestiona él mismo (a esos les
// asigna horarios y les pide horas extra).
async function equipo(directorUsersCompanyId) {
    requireUsersCompanyId(directorUsersCompanyId);
    return estadoEnVivo(await empleadosDelArbol(directorUsersCompanyId));
}

// Estado de hoy de una lista de personas, con su turno del día (§46-§47). Lo usan "Equipo hoy" del
// jefe y "Asistencia en vivo" de financiera. Sin chequeo de permisos: quien llama ya armó la lista
// con lo que puede ver. Todo en lote: financiera puede pedir cientos de personas a la vez.
async function estadoEnVivo(empleados) {
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);
    const ids = empleados.map((e) => e.users_company_id);
    const [asislockPorEmpleado, estados] = await Promise.all([
        asislockVista.resumenesDelDia(ids, fecha),
        calcularEstadosDelDia(ids, fecha, ahora)
    ]);

    return empleados.map((empleado) => {
        const { estadoCalculado, horario } = estados.get(empleado.users_company_id);
        return {
            users_company_id: empleado.users_company_id,
            nombre: empleado.nombre,
            cedula: empleado.cedula,
            cargo: empleado.cargo,
            campania: empleado.campania,
            centro_costo_id: empleado.centro_costo_id,
            centro_costo: empleado.centro_costo,
            jefe_area: empleado.jefe_area ?? null,
            directo: empleado.directo ?? null,
            turno: horario ? {
                plantilla: horario.plantilla,
                hora_entrada: horario.hora_entrada,
                hora_salida: horario.hora_salida,
                es_descanso: !!horario.es_descanso
            } : null,
            estado: estadoCalculado.estado,
            minutos_trabajados: estadoCalculado.minutosTrabajados,
            pausa_activa: estadoCalculado.pausaActiva,
            desconexion_activa: estadoCalculado.desconexionActiva,
            alertas: estadoCalculado.alertas,
            asislock: asislockPorEmpleado[empleado.users_company_id] ?? null
        };
    });
}

async function jornadasDe({ directorUsersCompanyId, empleadoId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await assertEmpleadoEnArbol(directorUsersCompanyId, empleadoId);
    return jornadasDeEmpleado(empleadoId, desde, hasta);
}

async function trazabilidadDe({ directorUsersCompanyId, empleadoId, fecha }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await assertEmpleadoEnArbol(directorUsersCompanyId, empleadoId);
    return trazabilidadDeEmpleado(empleadoId, fecha);
}

// Sin chequeo de permisos: quien llama ya validó que puede ver a este empleado (el jefe con
// assertEmpleadoEnArbol, financiera por su rol).
async function jornadasDeEmpleado(empleadoId, desde, hasta) {
    await cierreService.normalizarRangoSiEsPasado(empleadoId, desde, hasta, new Date());
    return jornadaRepo.findRango(empleadoId, desde, hasta);
}

async function trazabilidadDeEmpleado(empleadoId, fecha) {
    await cierreService.normalizarSiEsPasada(empleadoId, fecha, new Date());

    const jornada = await jornadaRepo.findPorFecha(empleadoId, fecha);
    if (!jornada) throw new NoEncontradoError('No hay jornada registrada para esa fecha');

    const eventos = await eventoRepo.findByJornada(jornada.idjornada);
    const { estadoCalculado } = await calcularEstadoConDatos(empleadoId, fecha, jornada.idjornada, new Date());

    return {
        fecha,
        jornada: { ...jornada, ...estadoCalculado },
        asislock: await asislockVista.delDia(empleadoId, fecha),
        eventos: eventos.map((e) => ({
            tipo: e.tipo,
            ocurrido_en: e.ocurrido_en.toISOString(),
            origen: e.origen,
            registrado_por_user_id: e.registrado_por_user_id,
            registrado_por_cuenta_id: e.registrado_por_cuenta_id ?? null,
            nota: e.nota
        }))
    };
}

async function estadisticasEquipo({ directorUsersCompanyId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const empleados = await equipoRepo.listaEmpleadosDelArbol(directorUsersCompanyId);

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

// Resumen mensual del equipo (asistencia.md §35): por empleado, los totales del mes y la grilla
// día a día, para que el jefe lleve la traza mes a mes. Normaliza los días pasados (cierre) para
// que las ausencias queden bien antes de agregar.
async function resumenMensualEquipo({ directorUsersCompanyId, periodo }) {
    requireUsersCompanyId(directorUsersCompanyId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo || '')) {
        throw new ValidacionError('El periodo debe tener el formato AAAA-MM');
    }
    const { desde, hasta } = rangoDelMes(periodo);
    const empleados = await equipoRepo.listaEmpleadosDelArbol(directorUsersCompanyId);
    const ahora = new Date();

    const filas = await Promise.all(empleados.map(async (empleado) => {
        await cierreService.normalizarRangoSiEsPasado(empleado.users_company_id, desde, hasta, ahora);
        const jornadas = await jornadaRepo.findRango(empleado.users_company_id, desde, hasta);
        return {
            users_company_id: empleado.users_company_id,
            nombre: empleado.nombre_propio,
            documento: empleado.numero_identificacion,
            cargo: empleado.cargo,
            jefe_area: empleado.directo ? null : empleado.jefe,
            ...resumenDeJornadas(jornadas)
        };
    }));
    filas.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

    return { periodo, desde, hasta, empleados: filas, totales: totalesEquipo(filas) };
}

async function registrarEventoManual({ directorUsersCompanyId, jornadaId, tipo, nota, registradoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const jornada = await jornadaRepo.findByIdParaActualizar(jornadaId, conn);
        if (!jornada) throw new NoEncontradoError('Jornada no encontrada');
        await assertEmpleadoACargo(directorUsersCompanyId, jornada.users_company_id, conn);

        await eventoRepo.insertar(
            { jornadaId: jornada.idjornada, tipo, origen: 'director', registradoPor, nota },
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
    estadoEnVivo,
    assertEmpleadoACargo,
    assertEmpleadoEnArbol,
    esJefeDeEquipo,
    cargoDe,
    equipo,
    jornadasDe,
    trazabilidadDe,
    jornadasDeEmpleado,
    trazabilidadDeEmpleado,
    estadisticasEquipo,
    resumenMensualEquipo,
    registrarEventoManual
};
