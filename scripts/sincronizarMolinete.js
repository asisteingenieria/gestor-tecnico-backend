// Molinete → asistencia del staff (asistencia.md §54), a mano.
//
//   node scripts/sincronizarMolinete.js --verificar   prueba la conexión (versión, zona, última marcación)
//   node scripts/sincronizarMolinete.js               una pasada de lectura y sale
//
// En operación normal no hace falta: el backend lee el molinete solo cada pocos segundos si
// MOLINETE_PG_HOST está en el .env. Sirve para probar la conexión antes de activarla y para
// recuperar a mano lo pendiente con el backend apagado.
require('dotenv').config({ quiet: true });
const db = require('../config/db');
const { pool } = require('../config/molinete');
const molineteService = require('../services/asistencia/molineteService');

async function main() {
    if (!molineteService.configurado) {
        console.log('Falta MOLINETE_PG_HOST (y MOLINETE_PG_PORT, _DATABASE, _USER, _PASSWORD) en el .env.');
        process.exitCode = 1;
        return;
    }
    if (process.argv.includes('--verificar')) {
        console.log(await molineteService.verificar());
        return;
    }
    const { leidas, resultados } = await molineteService.sincronizar();
    console.log(`Marcaciones leídas: ${leidas}`, resultados);
}

main()
    .catch((error) => {
        console.error('Error:', error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool?.end();
        await db.end();
    });
