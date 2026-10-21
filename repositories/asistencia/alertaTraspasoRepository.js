const db = require('../../config/db');

// Alertas de traspasos (migración 070) que le llegan a un empleado como destinatario: la
// evaluación del encargo (al director de área) y el retorno del trabajo en casa (al jefe
// inmediato). Las crea el módulo de RRHH (models/Traspaso.js); aquí solo se leen y se marcan.
// Visibles desde `fecha_alerta` hasta que se resuelven; las de retorno, hasta la fecha de retorno.
async function findVisiblesPara(usersCompanyId, hoy, conn = db) {
    const [filas] = await conn.query(
        `SELECT a.idalerta_traspaso, a.tipo, a.fecha_alerta, a.mensaje, a.leida_en
         FROM alerta_traspaso a
         JOIN traspaso t ON t.idtraspaso = a.traspaso_id
         WHERE a.destinatario_users_company_id = ?
           AND a.resuelta_en IS NULL
           AND a.fecha_alerta <= ?
           AND (a.tipo <> 'retorno_trabajo_casa' OR t.fecha_fin_trabajo_casa >= ?)
         ORDER BY a.leida_en IS NOT NULL, a.fecha_alerta DESC, a.idalerta_traspaso DESC`,
        [usersCompanyId, hoy, hoy]
    );
    return filas;
}

// Solo la marca si es del destinatario; devuelve si existía.
async function marcarLeida(idalerta, usersCompanyId, conn = db) {
    const [resultado] = await conn.query(
        `UPDATE alerta_traspaso SET leida_en = COALESCE(leida_en, NOW())
         WHERE idalerta_traspaso = ? AND destinatario_users_company_id = ?`,
        [idalerta, usersCompanyId]
    );
    return resultado.affectedRows > 0;
}

module.exports = { findVisiblesPara, marcarLeida };
