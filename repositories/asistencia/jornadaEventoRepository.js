const db = require('../../config/db');

// `ocurridoEn` solo lo usan el cierre automático (origen='sistema'), para registrar el
// instante programado de salida en vez de "ahora", y la integración con AsisLock
// (origen='asislock'), que reporta la hora real del login/logout biométrico (§18). Ningún
// endpoint de usuario lo expone: el empleado o el director nunca envían una hora (ver regla
// de zona horaria en asistencia.md §2.1). Todo lo demás sigue usando NOW(3) del servidor de
// base de datos, nunca el reloj de Node.
// `registradoPor` = { userId, cuentaId } (controllers/asistencia/autor.js), o null si lo
// registra el sistema o AsisLock.
async function insertar({ jornadaId, tipo, origen = 'empleado', registradoPor = null, nota = null, ip = null, userAgent = null, ocurridoEn = null }, conn = db) {
    const columnaFecha = ocurridoEn ? '?' : 'NOW(3)';
    const valores = [jornadaId, tipo];
    if (ocurridoEn) valores.push(ocurridoEn);
    valores.push(origen, registradoPor?.userId ?? null, registradoPor?.cuentaId ?? null, nota, ip, userAgent);

    const [resultado] = await conn.query(
        `INSERT INTO jornada_evento (jornada_id, tipo, ocurrido_en, origen, registrado_por_user_id, registrado_por_cuenta_id, nota, ip, user_agent)
         VALUES (?, ?, ${columnaFecha}, ?, ?, ?, ?, ?, ?)`,
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
