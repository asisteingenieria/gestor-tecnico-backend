const db = require('../../config/db');

// Bitácora de avisos de AsisLock (migración 062). La pareja (asislock_id, evento) es única:
// es la llave de idempotencia de la integración.

// Requiere una conexión activa: bloquea la fila para que dos reenvíos simultáneos del mismo
// registro no lo procesen dos veces.
async function findParaActualizar(asislockId, evento, conn) {
    const [filas] = await conn.query(
        'SELECT * FROM asislock_registro WHERE asislock_id = ? AND evento = ? FOR UPDATE',
        [asislockId, evento]
    );
    return filas[0] ?? null;
}

// Inserta o, si el aviso ya existía (solo se reprocesan los rechazados), lo sobrescribe.
async function guardar(r, conn = db) {
    await conn.query(
        `INSERT INTO asislock_registro
            (asislock_id, evento, usuario, fecha_reportada, hora_reportada, ocurrido_en,
             users_company_id, jornada_id, resultado, accion, motivo,
             estado_conexion, ip_local, ip_publica, aplicativo, conectado_biometrico)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            usuario = VALUES(usuario), fecha_reportada = VALUES(fecha_reportada),
            hora_reportada = VALUES(hora_reportada), ocurrido_en = VALUES(ocurrido_en),
            users_company_id = VALUES(users_company_id), jornada_id = VALUES(jornada_id),
            resultado = VALUES(resultado), accion = VALUES(accion), motivo = VALUES(motivo),
            estado_conexion = VALUES(estado_conexion), ip_local = VALUES(ip_local),
            ip_publica = VALUES(ip_publica), aplicativo = VALUES(aplicativo),
            conectado_biometrico = VALUES(conectado_biometrico)`,
        [
            r.asislockId, r.evento, r.usuario, r.fechaReportada, r.horaReportada, r.ocurridoEn,
            r.usersCompanyId, r.jornadaId, r.resultado, r.accion, r.motivo,
            r.estadoConexion, r.ipLocal, r.ipPublica, r.aplicativo, r.conectadoBiometrico
        ]
    );
}

module.exports = { findParaActualizar, guardar };
