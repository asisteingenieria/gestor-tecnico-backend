const db = require('../../config/db');

// `ocurridoEn` solo lo usa el cierre automático (origen='sistema'), para registrar el
// instante programado de salida en vez de "ahora". Ningún endpoint HTTP lo expone: el
// cliente nunca envía una hora (ver regla de zona horaria en asistencia.md §2.1). Todo lo
// demás sigue usando NOW(3) del servidor de base de datos, nunca el reloj de Node.
async function insertar({ jornadaId, tipo, origen = 'empleado', registradoPorUserId = null, nota = null, ip = null, userAgent = null, ocurridoEn = null }, conn = db) {
    const columnaFecha = ocurridoEn ? '?' : 'NOW(3)';
    const valores = [jornadaId, tipo];
    if (ocurridoEn) valores.push(ocurridoEn);
    valores.push(origen, registradoPorUserId, nota, ip, userAgent);

    const [resultado] = await conn.query(
        `INSERT INTO jornada_evento (jornada_id, tipo, ocurrido_en, origen, registrado_por_user_id, nota, ip, user_agent)
         VALUES (?, ?, ${columnaFecha}, ?, ?, ?, ?, ?)`,
        valores
    );
    return resultado.insertId;
}

async function findByJornada(jornadaId, conn = db) {
    const [filas] = await conn.query(
        'SELECT * FROM jornada_evento WHERE jornada_id = ? ORDER BY ocurrido_en ASC',
        [jornadaId]
    );
    return filas;
}

module.exports = { insertar, findByJornada };
