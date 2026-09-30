const db = require('../../config/db');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const { calcularEstadoConDatos, construirTotales } = require('./jornadaCalculo');
const { fechaLaboral, combinarFechaHora } = require('../../utils/fechaBogota');

const ESTADOS_ABIERTOS = ['en_curso', 'en_pausa'];

const TOTALES_AUSENTE = {
    estado: 'ausente',
    horaEntradaReal: null,
    horaSalidaReal: null,
    minutosTarde: 0,
    minutosTrabajados: 0,
    minutosPausaBano: 0,
    minutosPausaAlmuerzo: 0,
    minutosExtra: 0,
    minutosSalidaAnticipada: 0,
    desviacionAlmuerzoMin: 0
};

// Cierra una jornada abierta con una salida de origen='sistema' en la hora programada, o
// crea una jornada 'ausente' si el empleado tenía horario ese día y nunca marcó entrada.
// No filtra por fecha: quien llama decide cuándo es apropiado invocarla — ver
// normalizarSiEsPasada (cierre perezoso) y scripts/cerrarJornadasDelDia.js (cierre nocturno).
async function normalizarJornada(usersCompanyId, fecha, ahora, conn = db) {
    const jornada = await jornadaRepo.findPorFecha(usersCompanyId, fecha, conn);
    const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha, conn);

    if (!jornada) {
        if (!horario || horario.es_descanso) return null;
        try {
            const idjornada = await jornadaRepo.crear({ usersCompanyId, fecha, horarioAsignadoId: horario.idhorario_asignado }, conn);
            await jornadaRepo.actualizarTotales(idjornada, TOTALES_AUSENTE, conn);
            return { idjornada, estado: 'ausente' };
        } catch (err) {
            // Dos peticiones concurrentes (p. ej. mis-estadisticas y mis-jornadas pidiendo
            // rangos solapados a la vez) pueden intentar normalizar el mismo día; la que
            // pierde la carrera del INSERT no está en un error real, solo llega tarde.
            if (err.code === 'ER_DUP_ENTRY') {
                const existente = await jornadaRepo.findPorFecha(usersCompanyId, fecha, conn);
                return existente ? { idjornada: existente.idjornada, estado: existente.estado } : null;
            }
            throw err;
        }
    }

    if (!ESTADOS_ABIERTOS.includes(jornada.estado)) return null;

    const corte = horario ? combinarFechaHora(fecha, horario.hora_salida) : combinarFechaHora(fecha, '23:59:59');
    await eventoRepo.insertar({ jornadaId: jornada.idjornada, tipo: 'salida', origen: 'sistema', ocurridoEn: corte }, conn);

    const { estadoCalculado, eventos } = await calcularEstadoConDatos(usersCompanyId, fecha, jornada.idjornada, corte, conn);
    await jornadaRepo.actualizarTotales(jornada.idjornada, construirTotales(estadoCalculado, eventos), conn);
    await jornadaRepo.marcarCerradaAutomaticamente(jornada.idjornada, conn);

    return { idjornada: jornada.idjornada, estado: estadoCalculado.estado };
}

// Cierre perezoso (§10.1): solo actúa sobre fechas estrictamente anteriores a hoy. El día
// de hoy nunca se normaliza aquí, aunque ya haya pasado la hora de salida programada — eso
// es trabajo del cierre nocturno, no de una lectura.
async function normalizarSiEsPasada(usersCompanyId, fecha, ahora, conn = db) {
    if (fecha >= fechaLaboral(ahora)) return null;
    return normalizarJornada(usersCompanyId, fecha, ahora, conn);
}

async function normalizarRangoSiEsPasado(usersCompanyId, desde, hasta, ahora, conn = db) {
    const cursor = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    while (cursor <= fin) {
        const fecha = cursor.toISOString().slice(0, 10);
        await normalizarSiEsPasada(usersCompanyId, fecha, ahora, conn);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
}

module.exports = { normalizarJornada, normalizarSiEsPasada, normalizarRangoSiEsPasado };
