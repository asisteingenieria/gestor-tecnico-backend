const db = require('../../config/db');

// Fichas de RRHH con ese número de identificación. Puede haber más de una si la misma cifra
// existe con dos tipos de documento distintos (CC y CE, p. ej.): quien llama decide qué hacer.
async function findPorNumeroIdentificacion(numero, conn = db) {
    const [filas] = await conn.query(
        'SELECT id FROM users_company WHERE numero_identificacion = ?',
        [numero]
    );
    return filas.map((f) => f.id);
}

module.exports = { findPorNumeroIdentificacion };
