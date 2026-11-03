const { Pool, types } = require('pg');
require('dotenv').config({ quiet: true });

// Conexión de SOLO LECTURA a la base del molinete (ZKBioSecurity, PostgreSQL 9.2), para la
// asistencia del staff (asistencia.md §54). Sin MOLINETE_PG_HOST en el .env la integración está
// apagada: `pool` queda en null y nada intenta conectarse.
//
// Las fechas del molinete son `timestamp without time zone` en hora de Bogotá. pg las convertiría
// con la zona del proceso Node (UTC en producción): se piden como texto y las convierte
// utils/fechaBogota.textoBogotaAInstante.
types.setTypeParser(1114, (texto) => texto); // timestamp without time zone

const configurado = Boolean(process.env.MOLINETE_PG_HOST);

const pool = configurado
    ? new Pool({
        host: process.env.MOLINETE_PG_HOST,
        port: Number(process.env.MOLINETE_PG_PORT || 5432),
        database: process.env.MOLINETE_PG_DATABASE,
        user: process.env.MOLINETE_PG_USER,
        password: process.env.MOLINETE_PG_PASSWORD,
        max: 2,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 60000,
        statement_timeout: 20000
    })
    : null;

// Un error de una conexión ociosa (p. ej. el servidor del molinete se reinició) no debe tumbar
// el backend: la siguiente pasada vuelve a conectar.
pool?.on('error', (error) => console.error('[molinete] Error en la conexión ociosa:', error.message));

module.exports = { pool, configurado };
