/**
 * Reconstruye los totales cacheados de `jornada` a partir de `jornada_evento` para un rango
 * de fechas (o todas si no se pasan argumentos). Repara un total corrupto sin pérdida de
 * información — ver asistencia.md §5.1.
 *
 *   node scripts/recalcularJornadas.js
 *   node scripts/recalcularJornadas.js --desde=2026-09-01 --hasta=2026-09-30
 */
const db = require('../config/db');
const jornadaRepo = require('../repositories/asistencia/jornadaRepository');
const { calcularEstadoConDatos, construirTotales } = require('../services/asistencia/jornadaCalculo');

function leerArgumento(nombre) {
    const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
    return arg ? arg.split('=')[1] : null;
}

function comoFecha(valor) {
    return valor instanceof Date ? valor.toISOString().slice(0, 10) : valor;
}

async function jornadasARecalcular(desde, hasta) {
    const condiciones = [];
    const parametros = [];
    if (desde) { condiciones.push('fecha >= ?'); parametros.push(desde); }
    if (hasta) { condiciones.push('fecha <= ?'); parametros.push(hasta); }
    const where = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';

    const [filas] = await db.query(`SELECT idjornada, users_company_id, fecha FROM jornada ${where}`, parametros);
    return filas;
}

(async () => {
    try {
        const desde = leerArgumento('desde');
        const hasta = leerArgumento('hasta');
        const jornadas = await jornadasARecalcular(desde, hasta);

        console.log(`Recalculando ${jornadas.length} jornada(s)...`);
        const ahora = new Date();

        for (const jornada of jornadas) {
            const fecha = comoFecha(jornada.fecha);
            const { estadoCalculado, eventos } = await calcularEstadoConDatos(jornada.users_company_id, fecha, jornada.idjornada, ahora);
            await jornadaRepo.actualizarTotales(jornada.idjornada, construirTotales(estadoCalculado, eventos), db);
        }

        console.log('Listo.');
        process.exit(0);
    } catch (error) {
        console.error('Error recalculando jornadas:', error.message);
        process.exit(1);
    }
})();
