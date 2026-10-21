const db = require('../../config/db');

// Bitácora de avisos de AsisLock (migración 062). La pareja (llave, evento) es única: es la
// llave de idempotencia de la integración. `llave` es el id de AsisLock o, si no vino,
// cédula + fecha + hora del evento (migración 064).

// Requiere una conexión activa: bloquea la fila para que dos reenvíos simultáneos del mismo
// registro no lo procesen dos veces.
async function findParaActualizar(llave, evento, conn) {
    const [filas] = await conn.query(
        'SELECT * FROM asislock_registro WHERE llave = ? AND evento = ? FOR UPDATE',
        [llave, evento]
    );
    return filas[0] ?? null;
}

// Inserta o, si el aviso ya existía (solo se reprocesan los rechazados), lo sobrescribe.
async function guardar(r, conn = db) {
    await conn.query(
        `INSERT INTO asislock_registro
            (llave, asislock_id, evento, usuario, fecha_reportada, hora_reportada, ocurrido_en,
             users_company_id, jornada_id, resultado, accion, motivo,
             estado_conexion, ip_local, ip_publica, aplicativo, conectado_biometrico)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            usuario = VALUES(usuario), fecha_reportada = VALUES(fecha_reportada),
            hora_reportada = VALUES(hora_reportada), ocurrido_en = VALUES(ocurrido_en),
            users_company_id = VALUES(users_company_id), jornada_id = VALUES(jornada_id),
            resultado = VALUES(resultado), accion = VALUES(accion), motivo = VALUES(motivo),
            estado_conexion = VALUES(estado_conexion), ip_local = VALUES(ip_local),
            ip_publica = VALUES(ip_publica), aplicativo = VALUES(aplicativo),
            conectado_biometrico = VALUES(conectado_biometrico)`,
        [
            r.llave, r.asislockId, r.evento, r.usuario, r.fechaReportada, r.horaReportada, r.ocurridoEn,
            r.usersCompanyId, r.jornadaId, r.resultado, r.accion, r.motivo,
            r.estadoConexion, r.ipLocal, r.ipPublica, r.aplicativo, r.conectadoBiometrico
        ]
    );
}

// Avisos de AsisLock de un día laboral para una o varias fichas: los asociados a la jornada de
// ese día (incluye un logout pasada la medianoche) y los que no tienen jornada pero se
// reportaron con esa fecha (p. ej. un logout ignorado por `sin_entrada`).
async function findDelDia(usersCompanyIds, fecha, conn = db) {
    if (usersCompanyIds.length === 0) return [];
    const [filas] = await conn.query(
        `SELECT ar.users_company_id, ar.evento, ar.ocurrido_en, ar.resultado, ar.accion, ar.motivo,
                ar.estado_conexion, ar.ip_local, ar.ip_publica, ar.aplicativo, ar.conectado_biometrico
         FROM asislock_registro ar
         LEFT JOIN jornada j ON j.idjornada = ar.jornada_id
         WHERE ar.users_company_id IN (?)
           AND (j.fecha = ? OR (ar.jornada_id IS NULL AND ar.fecha_reportada = ?))
         ORDER BY ar.ocurrido_en, ar.idasislock_registro`,
        [usersCompanyIds, fecha, fecha]
    );
    return filas;
}

module.exports = { findParaActualizar, guardar, findDelDia };
