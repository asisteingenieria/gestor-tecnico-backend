// Despacha los avisos pendientes hacia Hydra (outbox hydra_envio_saliente).
// Pensado para cron cada minuto en el servidor, igual que cerrarJornadasDelDia.js:
//   * * * * * cd /root/gestor-tecnico-backend && node scripts/despacharEnviosHydra.js >> logs/hydra-envios.log 2>&1
// Sin HYDRA_CALLBACK_URL / _API_KEY / _HMAC_SECRET no envía nada: los avisos esperan.

require('dotenv').config({ quiet: true });
const db = require('../config/db');
const { despacharPendientes } = require('../services/contratacionHydra/despachoService');

(async () => {
    const inicio = new Date().toISOString();
    try {
        const { configurado, procesados } = await despacharPendientes();
        if (!configurado) {
            console.log(`[${inicio}] Canal hacia Hydra sin configurar: no se envió nada`);
        } else if (procesados.length > 0) {
            for (const p of procesados) {
                console.log(`[${inicio}] envío ${p.id} (${p.tipo}) → ${p.estado}${p.error ? ` · ${p.error}` : ''}`);
            }
        }
        process.exitCode = 0;
    } catch (error) {
        console.error(`[${inicio}] Error despachando envíos a Hydra:`, error.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
