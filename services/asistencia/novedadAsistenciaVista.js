const solicitudRepo = require('../../repositories/asistencia/solicitudCambioTurnoRepository');

// Novedades de asistencia (cambio de turno, intercambio y libre, §86) de un empleado en un día, en cualquier
// estado, con su traza: quién la pidió y cuándo se envió, a quién le llegó y quién la resolvió y cuándo. Va en la
// trazabilidad del día, junto a AsisLock y el molinete. Sin chequeo de permisos: quien llama ya validó que puede
// ver al empleado.
const iso = (valor) => (valor instanceof Date ? valor.toISOString() : valor ?? null);

async function delDia(empleadoId, fecha) {
    const filas = await solicitudRepo.findPorEmpleadoYFecha(empleadoId, fecha);
    return filas.map((s) => ({
        id: s.idsolicitud_cambio_turno,
        tipo: s.tipo,
        estado: s.estado,
        motivo: s.motivo,
        motivo_rechazo: s.motivo_rechazo,
        comentario: s.comentario,
        solicitante: s.solicitante,
        aprobador: s.aprobador,
        resuelto_por: s.resuelto_por,
        creado_en: iso(s.creado_en),
        resuelta_en: iso(s.resuelta_en),
        hora_entrada: s.hora_entrada,
        hora_salida: s.hora_salida,
        es_descanso: Boolean(s.es_descanso),
        anterior_hora_entrada: s.anterior_hora_entrada,
        anterior_hora_salida: s.anterior_hora_salida,
        anterior_es_descanso: s.anterior_es_descanso === null ? null : Boolean(s.anterior_es_descanso)
    }));
}

module.exports = { delDia };
