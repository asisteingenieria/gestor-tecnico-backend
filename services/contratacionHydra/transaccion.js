const db = require('../../config/db');

// Corre `fn(conn)` dentro de una transacción: commit si termina, rollback si lanza.
async function enTransaccion(fn) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const resultado = await fn(conn);
        await conn.commit();
        return resultado;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = { enTransaccion };
