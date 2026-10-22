const db = require('../../config/db');

// Usuarios de la pantalla gris de AsisLock (migración 071, asistencia.md §31). Las horas de
// bloqueo e ingreso se calculan en la BD con UTC_TIMESTAMP().

const NOMBRE = "TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido))";
const ESTADO_CONTRATO = `(SELECT ec.nombre
                            FROM contrato c
                            JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
                           WHERE c.users_company_id = uc.id
                           ORDER BY c.idcontrato DESC LIMIT 1)`;

async function findPorUsuario(usuario, conn = db) {
    const [rows] = await conn.query(
        `SELECT u.*, ${NOMBRE} AS nombre, ${ESTADO_CONTRATO} AS estado_contrato
           FROM usuario_pantalla_gris u
           JOIN users_company uc ON uc.id = u.users_company_id
          WHERE u.usuario = ?`,
        [usuario]
    );
    return rows[0] ?? null;
}

async function findPorFicha(usersCompanyId, conn = db) {
    const [rows] = await conn.query(
        `SELECT u.idusuario_pantalla_gris, u.usuario, u.users_company_id, ${NOMBRE} AS nombre
           FROM usuario_pantalla_gris u
           JOIN users_company uc ON uc.id = u.users_company_id
          WHERE u.users_company_id = ?`,
        [usersCompanyId]
    );
    return rows[0] ?? null;
}

/** Si la ficha ya tiene usuario o la cédula ya es el usuario de otra ficha. */
async function findConflicto(usersCompanyId, usuario, conn = db) {
    const [rows] = await conn.query(
        `SELECT IF(users_company_id = ?, 'ya_tiene_usuario', 'usuario_ocupado') AS motivo
           FROM usuario_pantalla_gris
          WHERE users_company_id = ? OR usuario = ?
          ORDER BY users_company_id = ? DESC
          LIMIT 1`,
        [usersCompanyId, usersCompanyId, usuario, usersCompanyId]
    );
    return rows[0]?.motivo ?? null;
}

async function insertar({ usersCompanyId, usuario, hash }, conn = db) {
    // La clave por defecto es la cédula y NO se obliga a cambiarla (debe_cambiar_password = 0):
    // así el agente no queda bloqueado si la olvida. Puede cambiarla por su cuenta si quiere.
    const [r] = await conn.query(
        'INSERT INTO usuario_pantalla_gris (users_company_id, usuario, password, debe_cambiar_password) VALUES (?, ?, ?, 0)',
        [usersCompanyId, usuario, hash]
    );
    return r.insertId;
}

// Suma un intento fallido; al llegar al máximo bloquea y reinicia el contador. El orden de
// las asignaciones importa: bloqueado_hasta se evalúa con el contador anterior.
async function registrarFallo(id, { maxIntentosFallidos, minutosBloqueo }, conn = db) {
    await conn.query(
        `UPDATE usuario_pantalla_gris
            SET bloqueado_hasta = IF(intentos_fallidos + 1 >= ?, UTC_TIMESTAMP() + INTERVAL ? MINUTE, bloqueado_hasta),
                intentos_fallidos = IF(intentos_fallidos + 1 >= ?, 0, intentos_fallidos + 1)
          WHERE idusuario_pantalla_gris = ?`,
        [maxIntentosFallidos, minutosBloqueo, maxIntentosFallidos, id]
    );
}

async function reiniciarFallos(id, { ingreso }, conn = db) {
    await conn.query(
        `UPDATE usuario_pantalla_gris
            SET intentos_fallidos = 0, bloqueado_hasta = NULL,
                ultimo_ingreso = IF(?, UTC_TIMESTAMP(), ultimo_ingreso)
          WHERE idusuario_pantalla_gris = ?`,
        [ingreso ? 1 : 0, id]
    );
}

async function cambiarPassword(id, hash, conn = db) {
    await conn.query(
        `UPDATE usuario_pantalla_gris
            SET password = ?, debe_cambiar_password = 0, intentos_fallidos = 0, bloqueado_hasta = NULL
          WHERE idusuario_pantalla_gris = ?`,
        [hash, id]
    );
}

/** Todos los usuarios con su estado, para la sincronización completa de AsisLock. */
async function listar(conn = db) {
    const [rows] = await conn.query(
        `SELECT u.usuario, u.users_company_id, ${NOMBRE} AS nombre, ${ESTADO_CONTRATO} AS estado_contrato,
                u.debe_cambiar_password, u.creado_en, u.actualizado_en
           FROM usuario_pantalla_gris u
           JOIN users_company uc ON uc.id = u.users_company_id
          ORDER BY u.idusuario_pantalla_gris`
    );
    return rows;
}

/** Fichas sin usuario de pantalla gris, con su estado de contrato (backfill). */
async function findFichasSinUsuario(conn = db) {
    const [rows] = await conn.query(
        `SELECT uc.id AS users_company_id, TRIM(uc.numero_identificacion) AS cedula, ${NOMBRE} AS nombre,
                ${ESTADO_CONTRATO} AS estado_contrato
           FROM users_company uc
           LEFT JOIN usuario_pantalla_gris u ON u.users_company_id = uc.id
          WHERE u.idusuario_pantalla_gris IS NULL
          ORDER BY uc.id`
    );
    return rows;
}

async function borrarPorFicha(usersCompanyId, conn = db) {
    await conn.query('DELETE FROM usuario_pantalla_gris WHERE users_company_id = ?', [usersCompanyId]);
}

module.exports = {
    findPorUsuario,
    findPorFicha,
    findConflicto,
    insertar,
    registrarFallo,
    reiniciarFallos,
    cambiarPassword,
    listar,
    findFichasSinUsuario,
    borrarPorFicha
};
