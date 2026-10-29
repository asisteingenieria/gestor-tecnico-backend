const db = require('../../config/db');

// Campana del portal (migración 084): avisos de asistencia por ficha (jefe, coordinador, empleado) o
// por usuario de `users` (financiera, que puede no tener ficha).
const VISIBLES = 50;

async function insertarVarias(notificaciones, conn = db) {
    if (notificaciones.length === 0) return;
    await conn.query(
        `INSERT INTO notificacion_asistencia
            (destinatario_users_company_id, destinatario_user_id, tipo, solicitud_cambio_turno_id, mensaje)
         VALUES ?`,
        [notificaciones.map((n) => [n.usersCompanyId ?? null, n.userId ?? null, n.tipo, n.solicitudCambioTurnoId ?? null, n.mensaje])]
    );
}

// Condición "es mía": dirigida a mi ficha o a mi usuario. Una cuenta de empleado no tiene users.id.
function destinatario({ usersCompanyId, userId }) {
    const partes = [];
    const parametros = [];
    if (usersCompanyId) { partes.push('destinatario_users_company_id = ?'); parametros.push(usersCompanyId); }
    if (userId) { partes.push('destinatario_user_id = ?'); parametros.push(userId); }
    return { sql: partes.length > 0 ? `(${partes.join(' OR ')})` : 'FALSE', parametros };
}

// Las sin leer primero y luego las más recientes.
async function findPara(sesion, conn = db) {
    const { sql, parametros } = destinatario(sesion);
    const [filas] = await conn.query(
        `SELECT idnotificacion_asistencia, tipo, solicitud_cambio_turno_id, mensaje, leida_en, creada_en
         FROM notificacion_asistencia
         WHERE ${sql}
         ORDER BY leida_en IS NOT NULL, creada_en DESC
         LIMIT ${VISIBLES}`,
        parametros
    );
    return filas;
}

// Solo la marca si es del destinatario; devuelve si existía.
async function marcarLeida(id, sesion, conn = db) {
    const { sql, parametros } = destinatario(sesion);
    const [resultado] = await conn.query(
        `UPDATE notificacion_asistencia SET leida_en = COALESCE(leida_en, NOW())
         WHERE idnotificacion_asistencia = ? AND ${sql}`,
        [id, ...parametros]
    );
    return resultado.affectedRows > 0;
}

async function marcarTodasLeidas(sesion, conn = db) {
    const { sql, parametros } = destinatario(sesion);
    await conn.query(`UPDATE notificacion_asistencia SET leida_en = NOW() WHERE leida_en IS NULL AND ${sql}`, parametros);
}

// Usuarios activos de financiera (la administradora de RRHH y asistencia, CLAUDE.md "Roles").
async function usuariosFinanciera(conn = db) {
    const [filas] = await conn.query("SELECT id FROM users WHERE role = 'financiera' AND activo = 1");
    return filas.map((f) => f.id);
}

module.exports = { insertarVarias, findPara, marcarLeida, marcarTodasLeidas, usuariosFinanciera };
