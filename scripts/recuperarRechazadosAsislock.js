/**
 * Recupera los logins/logouts de AsisLock que Gestor rechazó como `empleado_no_encontrado` y que hoy
 * sí encuentran su ficha — p. ej. los PPT que AsisLock tiene sin el prefijo 600 (asistencia.md §69).
 * Vuelve a procesar cada aviso con su hora original (sin el límite de 72 h) y cierra los días pasados.
 * Es idempotente: un aviso ya recuperado deja de estar rechazado y no se vuelve a tomar.
 *
 * Sin --aplicar solo muestra qué haría:
 *   node scripts/recuperarRechazadosAsislock.js --cedulas=6776237
 *   node scripts/recuperarRechazadosAsislock.js --cedulas=6776237,1402568 --aplicar
 * Opcional: --desde=2026-11-01 --hasta=2026-11-17 (fecha Bogotá, ambos incluidos).
 */
const { reprocesarRechazados } = require('../services/asistencia/asislockService');
const { combinarFechaHora, sumarDias } = require('../utils/fechaBogota');

function leerArgumento(nombre) {
    const arg = process.argv.find((a) => a.startsWith(`--${nombre}=`));
    return arg ? arg.split('=')[1] : null;
}

const fechaValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const horaBogota = (instante) => new Date(instante).toLocaleString('es-CO', { timeZone: 'America/Bogota', hour12: false });

async function main() {
    const cedulas = (leerArgumento('cedulas') || '').split(',').map((c) => c.trim()).filter(Boolean);
    const desde = leerArgumento('desde');
    const hasta = leerArgumento('hasta');
    const aplicar = process.argv.includes('--aplicar');

    if (cedulas.length === 0) throw new Error('Falta --cedulas=6776237[,1402568] (la cédula tal como la manda AsisLock)');
    if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta))) throw new Error('--desde/--hasta van como AAAA-MM-DD');

    const { total, resultados, diasCerrados } = await reprocesarRechazados({
        cedulas,
        desde: desde ? combinarFechaHora(desde, '00:00:00') : null,
        hasta: hasta ? combinarFechaHora(sumarDias(hasta, 1), '00:00:00') : null,
        aplicar
    });

    console.log(`${aplicar ? 'APLICANDO' : 'SIMULACIÓN (agrega --aplicar para guardar)'} · ${total} aviso(s) rechazado(s) de ${cedulas.join(', ')}`);
    for (const r of resultados) {
        console.log(`  #${r.id} ${r.usuario} ${r.evento.padEnd(6)} ${horaBogota(r.ocurrido_en)} (día ${r.fecha}) → ficha ${r.users_company_id ?? '-'} · ${r.resultado}${r.accion ? ` (${r.accion})` : ''}${r.motivo ? ` [${r.motivo}]` : ''}`);
    }

    const conteo = resultados.reduce((acc, r) => ({ ...acc, [r.resultado]: (acc[r.resultado] || 0) + 1 }), {});
    console.log('Resumen:', conteo);
    if (diasCerrados.length > 0) {
        console.log('Días pasados normalizados:');
        for (const d of diasCerrados) console.log(`  ficha ${d.users_company_id} · ${d.fecha} → ${d.estado}`);
    }
}

// Sale con process.exit, como los demás scripts de asistencia. No se usa db.end(): cada evento
// registrado lanza el aviso en vivo (notificarCambioJornada) sin esperarlo, y sus consultas chocaban
// con el pool ya cerrado. Fuera del servidor ese aviso no tiene a quién llegar.
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('Error:', error.message);
        process.exit(1);
    });
