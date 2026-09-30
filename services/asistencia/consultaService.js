const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const parametroRepo = require('../../repositories/asistencia/parametroRepository');
const { calcularJornada } = require('../../domain/asistencia');
const { fechaLaboral } = require('../../utils/fechaBogota');
const { NoEncontradoError } = require('../../errors/AppError');
const cierreService = require('./cierreService');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

function rangoSemanaActual() {
    const hoy = fechaLaboral(new Date());
    const fecha = new Date(`${hoy}T00:00:00Z`);
    const diaSemana = fecha.getUTCDay(); // 0 = domingo
    const offsetLunes = diaSemana === 0 ? 6 : diaSemana - 1;
    const lunes = new Date(fecha);
    lunes.setUTCDate(fecha.getUTCDate() - offsetLunes);
    const domingo = new Date(lunes);
    domingo.setUTCDate(lunes.getUTCDate() + 6);
    return { desde: lunes.toISOString().slice(0, 10), hasta: domingo.toISOString().slice(0, 10) };
}

async function estadoDeHoy(usersCompanyId) {
    requireUsersCompanyId(usersCompanyId);
    const ahora = new Date();
    const fecha = fechaLaboral(ahora);

    const jornada = await jornadaRepo.findPorFecha(usersCompanyId, fecha);
    const eventos = jornada ? await eventoRepo.findByJornada(jornada.idjornada) : [];
    const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha);
    const horasExtraAprobadas = await horaExtraRepo.findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha);
    const parametros = await parametroRepo.obtener();

    const estado = calcularJornada(eventos, horario, ahora, horasExtraAprobadas, parametros);
    const entrada = eventos.find((e) => e.tipo === 'entrada');

    return {
        jornada_id: jornada?.idjornada ?? null,
        fecha,
        estado: estado.estado,
        servidor_ahora: ahora.toISOString(),
        horario: horario ? {
            hora_entrada: horario.hora_entrada,
            hora_salida: horario.hora_salida,
            hora_almuerzo_inicio: horario.hora_almuerzo_inicio,
            minutos_almuerzo: horario.minutos_almuerzo
        } : null,
        hora_entrada_real: entrada ? entrada.ocurrido_en.toISOString() : null,
        minutos_tarde: estado.minutosTarde,
        minutos_trabajados: estado.minutosTrabajados,
        minutos_pausa_bano: estado.minutosPausaBano,
        minutos_pausa_almuerzo: estado.minutosPausaAlmuerzo,
        pausa_activa: estado.pausaActiva,
        minutos_extra: estado.minutosExtra,
        puede_marcar_salida: estado.puedeMarcarSalida,
        segundos_para_habilitar_salida: estado.segundosParaHabilitarSalida,
        alertas: estado.alertas
    };
}

async function miHorario({ usersCompanyId, desde, hasta }) {
    requireUsersCompanyId(usersCompanyId);
    const rango = desde && hasta ? { desde, hasta } : rangoSemanaActual();
    return horarioRepo.findRango(usersCompanyId, rango.desde, rango.hasta);
}

async function trazabilidad({ usersCompanyId, fecha }) {
    requireUsersCompanyId(usersCompanyId);
    await cierreService.normalizarSiEsPasada(usersCompanyId, fecha, new Date());

    const jornada = await jornadaRepo.findPorFecha(usersCompanyId, fecha);
    if (!jornada) throw new NoEncontradoError('No hay jornada registrada para esa fecha');

    const eventos = await eventoRepo.findByJornada(jornada.idjornada);
    const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha);
    const horasExtraAprobadas = await horaExtraRepo.findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha);
    const parametros = await parametroRepo.obtener();

    const estado = calcularJornada(eventos, horario, new Date(), horasExtraAprobadas, parametros);

    return {
        fecha,
        jornada: { ...jornada, ...estado },
        eventos: eventos.map((e) => ({
            tipo: e.tipo,
            ocurrido_en: e.ocurrido_en.toISOString(),
            origen: e.origen,
            nota: e.nota
        }))
    };
}

async function misJornadas({ usersCompanyId, desde, hasta }) {
    requireUsersCompanyId(usersCompanyId);
    const rango = desde && hasta ? { desde, hasta } : rangoSemanaActual();
    await cierreService.normalizarRangoSiEsPasado(usersCompanyId, rango.desde, rango.hasta, new Date());
    return jornadaRepo.findRango(usersCompanyId, rango.desde, rango.hasta);
}

async function misEstadisticas({ usersCompanyId, desde, hasta }) {
    requireUsersCompanyId(usersCompanyId);
    await cierreService.normalizarRangoSiEsPasado(usersCompanyId, desde, hasta, new Date());

    const jornadas = await jornadaRepo.findRango(usersCompanyId, desde, hasta);

    const diasTrabajados = jornadas.filter((j) => j.estado !== 'pendiente' && j.estado !== 'ausente').length;
    const ausencias = jornadas.filter((j) => j.estado === 'ausente').length;
    const diasPuntuales = jornadas.filter((j) => j.minutos_tarde === 0 && j.estado !== 'pendiente' && j.estado !== 'ausente').length;

    return {
        desde,
        hasta,
        dias_trabajados: diasTrabajados,
        ausencias,
        dias_puntuales: diasPuntuales,
        porcentaje_puntualidad: diasTrabajados > 0 ? Math.round((diasPuntuales / diasTrabajados) * 100) : null,
        minutos_tarde_acumulados: jornadas.reduce((acc, j) => acc + j.minutos_tarde, 0),
        minutos_trabajados_acumulados: jornadas.reduce((acc, j) => acc + j.minutos_trabajados, 0),
        minutos_extra_acumulados: jornadas.reduce((acc, j) => acc + j.minutos_extra, 0)
    };
}

module.exports = { estadoDeHoy, miHorario, trazabilidad, misJornadas, misEstadisticas };
