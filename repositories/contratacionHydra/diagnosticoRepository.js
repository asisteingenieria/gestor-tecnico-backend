const db = require('../../config/db');

// Consultas de solo lectura para verificar un servidor antes de activar la conexión con
// Hydra (scripts/verificarConexionHydra.js, conexionhydra.md §14). No escriben nada.

const TABLAS = ['hydra_lote', 'hydra_candidato', 'hydra_candidato_verificacion',
    'hydra_mapeo_catalogo', 'hydra_envio_saliente', 'hydra_peticion_entrante'];

async function versionMysql(conn = db) {
    const [[fila]] = await conn.query('SELECT VERSION() AS version');
    return fila.version;
}

async function tablasPresentes(conn = db) {
    const [rows] = await conn.query(
        `SELECT TABLE_NAME AS nombre FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
        [TABLAS]
    );
    const presentes = new Set(rows.map((r) => r.nombre));
    return TABLAS.map((nombre) => ({ nombre, existe: presentes.has(nombre) }));
}

async function resumenOutbox(conn = db) {
    const [rows] = await conn.query(
        'SELECT estado, COUNT(*) AS total FROM hydra_envio_saliente GROUP BY estado'
    );
    return rows;
}

module.exports = { versionMysql, tablasPresentes, resumenOutbox };
