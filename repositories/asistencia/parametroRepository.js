const db = require('../../config/db');

// Se lee una vez por proceso y se cachea en memoria; invalidar() la limpia cuando se escribe.
let cache = null;

function parsear(valor, tipoDato) {
    switch (tipoDato) {
        case 'entero': return parseInt(valor, 10);
        case 'decimal': return parseFloat(valor);
        case 'booleano': return valor === '1' || valor === 'true';
        default: return valor;
    }
}

async function obtener(conn = db) {
    if (cache) return cache;
    const [filas] = await conn.query('SELECT clave, valor, tipo_dato FROM asistencia_parametro');
    cache = {};
    for (const fila of filas) cache[fila.clave] = parsear(fila.valor, fila.tipo_dato);
    return cache;
}

function invalidar() {
    cache = null;
}

module.exports = { obtener, invalidar };
