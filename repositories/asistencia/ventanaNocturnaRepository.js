const db = require('../../config/db');

// Ventana del recargo nocturno con vigencia (migración 074). Se toma la vigencia más reciente cuya
// fecha de inicio es anterior o igual a la fecha consultada, para que un mes viejo se recalcule con
// el umbral que regía entonces (la reforma lo corrió a las 7:00 p.m.). Devuelve 'HH:MM'.

async function vigenteEn(fecha, conn = db) {
    const [filas] = await conn.query(
        `SELECT DATE_FORMAT(hora_inicio, '%H:%i') AS inicio, DATE_FORMAT(hora_fin, '%H:%i') AS fin
         FROM ventana_nocturna
         WHERE vigente_desde <= ?
         ORDER BY vigente_desde DESC
         LIMIT 1`,
        [fecha]
    );
    return filas[0] ?? null;
}

module.exports = { vigenteEn };
