const { pool } = require('../../config/molinete');

// Lectura de la base del molinete (ZKBioSecurity, PostgreSQL 9.2). Solo SELECT: el usuario de la
// conexión es de solo consulta. Las fechas salen como texto en hora de Bogotá (sin zona); el
// servicio las convierte con utils/fechaBogota. Ver asistencia.md §54.

/**
 * Marcaciones válidas (event_no = 0: paso autorizado) de las áreas indicadas, registradas en el
 * molinete después de `desde`. Se recorre por create_time, que tiene índice y es cuándo el
 * servidor del molinete recibió la marcación: un equipo que estuvo desconectado y entrega tarde
 * aparece igual en la siguiente pasada.
 * @param {string} desde          'YYYY-MM-DD HH:MM:SS.mmm' en hora de Bogotá
 * @param {string[]} departamentos dept_name en mayúsculas
 */
async function findDesde(desde, departamentos, limite, cliente = pool) {
    const { rows } = await cliente.query(
        `SELECT unique_key,
                pin,
                last_name AS cedula,
                dept_name AS departamento,
                reader_name AS lector,
                to_char(event_time, 'YYYY-MM-DD HH24:MI:SS') AS event_time,
                to_char(create_time, 'YYYY-MM-DD HH24:MI:SS.MS') AS create_time
           FROM acc_transaction
          WHERE create_time > $1::timestamp
            AND event_no = 0
            AND upper(trim(dept_name)) = ANY($2::text[])
          ORDER BY create_time, event_time
          LIMIT $3`,
        [desde, departamentos, limite]
    );
    return rows;
}

/** Versión y hora del servidor del molinete (verificación de la conexión). */
async function probar(cliente = pool) {
    const { rows } = await cliente.query(
        `SELECT version() AS version,
                current_setting('TimeZone') AS zona,
                to_char(now(), 'YYYY-MM-DD HH24:MI:SS') AS ahora,
                (SELECT to_char(max(create_time), 'YYYY-MM-DD HH24:MI:SS') FROM acc_transaction) AS ultima_marcacion`
    );
    return rows[0];
}

module.exports = { findDesde, probar };
