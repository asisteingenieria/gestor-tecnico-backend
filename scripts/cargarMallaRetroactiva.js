/**
 * Carga retroactiva de la malla de horarios (asistencia.md §76): guarda los horarios de días que ya pasaron del equipo
 * directo de un jefe y recalcula esos días: llegada puntual o tarde a quien se logueó y ausencia a quien tenía turno y
 * no se logueó. La pantalla de los jefes no acepta días pasados (§55); esto es una corrección puntual.
 *
 * Simular (no escribe nada; corre todo en una transacción y la deshace):
 *   node scripts/cargarMallaRetroactiva.js --archivo="/root/cargues/malla.xlsx" --jefe=<cédula del jefe> --desde=2026-11-21 --hasta=2026-11-22
 * Aplicar:
 *   ... --aplicar
 * Reporte por persona y día (CSV, lleva cédulas: borrarlo después):
 *   ... --reporte=/root/cargues/reporte_malla_retroactiva.csv
 *
 * El archivo es el de la malla (§55) o la plantilla (§75): Cedula, Fecha, Entrada, Salida, Almuerzo, Novedad.
 * Solo se toman los días del rango, del equipo directo del jefe, activos y desde su ingreso.
 */
const fs = require('fs');
const db = require('../config/db');
const empleadoRepo = require('../repositories/asistencia/empleadoRepository');
const horarioService = require('../services/asistencia/horarioService');

const arg = (nombre) => {
    const a = process.argv.find((x) => x.startsWith(`--${nombre}=`));
    return a ? a.slice(nombre.length + 3).replace(/^"|"$/g, '') : null;
};
const ETIQUETAS = {
    puntual: 'Puntuales', tarde: 'Llegaron tarde', ausente: 'No se loguearon (ausentes)', descanso: 'Descanso',
    trabajo_en_descanso: 'Trabajaron en su descanso', sin_jornada: 'Sin jornada (revisar)'
};
const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

(async () => {
    const archivo = arg('archivo');
    const cedulaJefe = arg('jefe');
    const desde = arg('desde');
    const hasta = arg('hasta');
    const reporte = arg('reporte');
    const aplicar = process.argv.includes('--aplicar');
    try {
        if (!archivo || !cedulaJefe) throw new Error('Indique --archivo y --jefe (cédula del jefe)');
        const ids = await empleadoRepo.findPorNumeroIdentificacion(cedulaJefe.trim());
        if (ids.length !== 1) throw new Error(`La cédula ${cedulaJefe} tiene ${ids.length} fichas en RRHH; debe tener una`);

        const r = await horarioService.cargarMallaRetroactiva({
            directorUsersCompanyId: ids[0], buffer: fs.readFileSync(archivo), desde, hasta, aplicar
        });

        console.log(`\n${aplicar ? 'APLICADO' : 'SIMULACIÓN (no se guardó nada)'} — hoja "${r.hoja}", del ${desde} al ${hasta}`);
        console.log(`Horarios a cargar: ${r.plan.a_aplicar} de ${r.plan.personas} personas (ya iguales: ${r.plan.igual}, errores en el archivo: ${r.plan.errores})`);
        console.log('\nResultado por día:');
        for (const [clave, etiqueta] of Object.entries(ETIQUETAS)) {
            if (r.resultado[clave]) console.log(`  ${etiqueta}: ${r.resultado[clave]}`);
        }
        if (r.omitidos.length) {
            console.log(`\nOmitidos (${r.omitidos.length} personas):`);
            r.omitidos.forEach((o) => console.log(`  ${o.nombre ?? ''} ${o.cedula} — ${o.estado} (${o.dias} días)`));
        }
        if (r.errores.length) {
            console.log(`\nFilas con error (${r.errores.length}):`);
            r.errores.slice(0, 20).forEach((e) => console.log(`  fila ${e.fila} ${e.cedula ?? ''} ${e.fecha ?? ''}: ${e.motivo}`));
        }
        const tarde = r.detalle.filter((d) => d.resultado === 'tarde').sort((a, b) => b.minutos_tarde - a.minutos_tarde);
        if (tarde.length) {
            console.log('\nLlegadas tarde (más tarde primero):');
            tarde.slice(0, 30).forEach((d) => console.log(`  ${d.fecha} ${d.nombre} — turno ${d.horario}, ${d.minutos_tarde} min tarde`));
            if (tarde.length > 30) console.log(`  … y ${tarde.length - 30} más (ver --reporte)`);
        }
        if (reporte) {
            const filas = [['Cedula', 'Nombre', 'Fecha', 'Horario', 'Antes', 'Resultado', 'Minutos tarde']]
                .concat(r.detalle.map((d) => [d.cedula, d.nombre, d.fecha, d.horario, d.antes, ETIQUETAS[d.resultado], d.minutos_tarde]));
            fs.writeFileSync(reporte, `﻿${filas.map((f) => f.map(csv).join(';')).join('\r\n')}`);
            console.log(`\nReporte: ${reporte} (lleva cédulas: bórrelo después de revisarlo)`);
        }
        if (!aplicar) console.log('\nPara guardar, repita el comando con --aplicar.');
        await db.end();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        await db.end().catch(() => {});
        process.exit(1);
    }
})();
