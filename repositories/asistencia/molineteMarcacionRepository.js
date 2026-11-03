const db = require('../../config/db');

// Copia en el Gestor de las marcaciones del molinete (migración 091, asistencia.md §54).

/** create_time (UTC) de la última marcación copiada: desde ahí sigue la siguiente lectura. */
async function ultimoRegistradoEnOrigen(conn = db) {
    const [filas] = await conn.query('SELECT MAX(registrado_en_origen) AS ultimo FROM molinete_marcacion');
    return filas[0]?.ultimo ?? null;
}

/** ¿Ya se procesó esta marcación? Bloquea la fila para que dos pasadas no la procesen a la vez. */
async function existeParaActualizar(uniqueKey, conn = db) {
    const [filas] = await conn.query(
        'SELECT idmolinete_marcacion FROM molinete_marcacion WHERE unique_key = ? FOR UPDATE',
        [uniqueKey]
    );
    return filas.length > 0;
}

async function guardar(m, conn = db) {
    await conn.query(
        `INSERT INTO molinete_marcacion
            (unique_key, pin, cedula, departamento, lector, sentido, ocurrido_en, registrado_en_origen,
             users_company_id, jornada_id, resultado, accion, motivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            m.uniqueKey, m.pin, m.cedula, m.departamento, m.lector, m.sentido, m.ocurridoEn, m.registradoEnOrigen,
            m.usersCompanyId, m.jornadaId, m.resultado, m.accion, m.motivo
        ]
    );
}

/**
 * Marcaciones de uno o varios empleados en un día de Bogotá, [desde, hasta) en UTC.
 * Incluye las rechazadas para la auditoría; quien las use decide si las filtra.
 */
async function findDelDia(usersCompanyIds, desde, hasta, conn = db) {
    if (usersCompanyIds.length === 0) return [];
    // La trazabilidad y el cierre del día de TODOS pasan por aquí: si el backend se despliega antes
    // que la migración 091, sin la tabla se responde vacío en vez de romperlos.
    const [filas] = await conn.query(
        `SELECT users_company_id, ocurrido_en, sentido, lector, resultado, accion, motivo
           FROM molinete_marcacion
          WHERE users_company_id IN (?)
            AND ocurrido_en >= ? AND ocurrido_en < ?
          ORDER BY ocurrido_en, idmolinete_marcacion`,
        [usersCompanyIds, desde, hasta]
    ).catch((error) => {
        if (error.code === 'ER_NO_SUCH_TABLE') return [[]];
        throw error;
    });
    return filas;
}

module.exports = { ultimoRegistradoEnOrigen, existeParaActualizar, guardar, findDelDia };
