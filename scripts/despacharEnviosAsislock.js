// Despacha los avisos pendientes hacia AsisLock (outbox asislock_envio_saliente, asistencia.md §31):
// altas, bajas y reactivaciones de usuarios de la pantalla gris. Pensado para cron cada minuto:
//   * * * * * cd /root/gestor-tecnico-backend && node scripts/despacharEnviosAsislock.js >> logs/asislock-envios.log 2>&1
// Sin ASISLOCK_CALLBACK_URL / ASISLOCK_CALLBACK_API_KEY no envía nada: los avisos esperan.

require('dotenv').config({ quiet: true });
const db = require('../config/db');
const { despacharPendientes } = require('../services/asistencia/asislockDespachoService');

(async () => {
    const inicio = new Date().toISOString();
    try {
        const { configurado, procesados } = await despacharPendientes();
        if (!configurado) {
            console.log(`[${inicio}] Canal hacia AsisLock sin configurar: no se envió nada`);
        }
        for (const p of procesados) {
            console.log(`[${inicio}] aviso ${p.id} (${p.evento} ${p.usuario}) → ${p.estado}${p.error ? ` · ${p.error}` : ''}`);
        }
        process.exitCode = 0;
    } catch (error) {
        console.error(`[${inicio}] Error despachando avisos a AsisLock:`, error.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
