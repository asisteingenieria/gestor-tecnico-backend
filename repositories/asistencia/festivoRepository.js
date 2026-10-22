const db = require('../../config/db');

// Festivos nacionales de Colombia (migración 074). Los domingos NO están aquí: el servicio los
// deduce del día de la semana. Las fechas se devuelven como 'YYYY-MM-DD' para comparar sin líos de
// zona ni de tipo Date.

async function sonFestivos(fechas, conn = db) {
    const lista = (fechas || []).filter(Boolean);
    if (lista.length === 0) return new Set();
    const [filas] = await conn.query(
        `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha
         FROM festivo_colombia
         WHERE fecha IN (${lista.map(() => '?').join(',')})`,
        lista
    );
    return new Set(filas.map((f) => f.fecha));
}

module.exports = { sonFestivos };
