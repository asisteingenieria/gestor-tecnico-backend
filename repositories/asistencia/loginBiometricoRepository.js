const db = require('../../config/db');

// Copia de las sesiones de AsisLock (migración 064): una fila por sesión, identificada por
// `llave` (id de AsisLock o cédula + fecha + hora_login). Lo que Gestor hizo con cada
// login/logout vive en asislock_registro.

// Inserta la fila o la actualiza con lo último recibido. hora_logout no se borra: un
// reenvío atrasado de la fila (aún sin logout) no deshace un logout ya recibido. Tampoco
// conectado_biometrico: AsisLock solo lo conoce al login y en el logout lo manda null.
async function guardar(r, conn = db) {
    await conn.query(
        `INSERT INTO login_biometrico
            (llave, asislock_id, usuario, fecha, hora_login, hora_logout, estado_conexion,
             ip_local, ip_publica, aplicativo, conectado_biometrico)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            usuario = VALUES(usuario), fecha = VALUES(fecha),
            hora_login = COALESCE(VALUES(hora_login), hora_login),
            hora_logout = COALESCE(VALUES(hora_logout), hora_logout),
            estado_conexion = VALUES(estado_conexion), ip_local = VALUES(ip_local),
            ip_publica = VALUES(ip_publica), aplicativo = VALUES(aplicativo),
            conectado_biometrico = COALESCE(VALUES(conectado_biometrico), conectado_biometrico)`,
        [
            r.llave, r.asislockId, r.usuario, r.fecha, r.horaLogin, r.horaLogout, r.estadoConexion,
            r.ipLocal, r.ipPublica, r.aplicativo, r.conectadoBiometrico
        ]
    );
}

// Para un logout sin id ni hora_login. Requiere una conexión activa (bloquea las filas).
// Si ya hay una sesión de esa cédula y fecha cerrada a esa misma hora, es un reenvío.
async function existeLogout(usuario, fecha, horaLogout, conn) {
    const [filas] = await conn.query(
        `SELECT idlogin_biometrico FROM login_biometrico
          WHERE usuario = ? AND fecha = ? AND hora_logout = ? LIMIT 1 FOR UPDATE`,
        [usuario, fecha, horaLogout]
    );
    return filas.length > 0;
}

// La sesión abierta (con login y sin logout) de esa cédula y fecha que cierra un logout sin
// id, o null. Solo sesiones sin id: las que traen id las cierra su propio sistema. Prefiere
// la más reciente que empezó antes del logout; si ninguna, la más reciente (logout pasada la
// medianoche).
async function findSesionAbiertaParaActualizar(usuario, fecha, horaLogout, conn) {
    const [filas] = await conn.query(
        `SELECT idlogin_biometrico FROM login_biometrico
          WHERE usuario = ? AND fecha = ? AND asislock_id IS NULL
            AND hora_login IS NOT NULL AND hora_logout IS NULL
          ORDER BY hora_login <= ? DESC, hora_login DESC LIMIT 1 FOR UPDATE`,
        [usuario, fecha, horaLogout]
    );
    return filas[0] ?? null;
}

async function cerrarSesion(idloginBiometrico, r, conn = db) {
    await conn.query(
        `UPDATE login_biometrico
            SET hora_logout = ?, estado_conexion = ?,
                ip_local = COALESCE(?, ip_local), ip_publica = COALESCE(?, ip_publica),
                aplicativo = COALESCE(?, aplicativo),
                conectado_biometrico = COALESCE(?, conectado_biometrico)
          WHERE idlogin_biometrico = ?`,
        [r.horaLogout, r.estadoConexion, r.ipLocal, r.ipPublica, r.aplicativo, r.conectadoBiometrico, idloginBiometrico]
    );
}

module.exports = { guardar, existeLogout, findSesionAbiertaParaActualizar, cerrarSesion };
