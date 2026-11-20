/**
 * Carga el saldo inicial del pasivo vacacional desde el Excel de Gestión Humana (claude/modulo recursoshumanos.md §58).
 *
 *   node scripts/cargarPasivoVacacional.js --excel "<ruta>/pasivo vacacional.xlsx" [--reporte <csv>] [--aplicar]
 *
 * - Simula por defecto; con --aplicar escribe en una transacción (tabla vacaciones_saldo, migración 106).
 * - Cruza por cédula con la ficha (los PPT del Excel pueden venir sin el prefijo 600, §55).
 * - Guarda por empleado: fecha de corte (FECHA ACTUAL), días disfrutados, días programados (referencia) y días
 *   compensados al corte. Los compensados posteriores salen de las novedades de Vacaciones (migración 107, §59).
 * - Verifica que el sistema dé lo mismo que el Excel en la fecha de corte: fecha de ingreso, días trabajados,
 *   acumulados y pasivo. Una fila que no coincide no se carga.
 * - Idempotente: volver a correrlo actualiza el corte con lo del Excel. No pisa un saldo que financiera ajustó desde
 *   la pantalla (origen 'financiera', migración 108, §58.2), salvo con --forzar.
 * - --reporte deja un CSV fila por fila (lleva cédulas: guardarlo fuera del repo).
 */
require('dotenv').config();
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../config/db');
const P = require('../utils/pasivoVacacional');

const args = process.argv.slice(2);
const valor = (nombre) => { const i = args.indexOf(nombre); return i === -1 ? null : args[i + 1]; };
const rutaExcel = valor('--excel');
const rutaReporte = valor('--reporte');
const aplicar = args.includes('--aplicar');
const forzar = args.includes('--forzar');

if (!rutaExcel) {
    console.error('Uso: node scripts/cargarPasivoVacacional.js --excel <archivo.xlsx> [--reporte <csv>] [--aplicar]');
    process.exit(1);
}

const casi = (a, b) => Math.abs(Number(a) - Number(b)) < 0.006;

async function main() {
    const libro = XLSX.readFile(rutaExcel);
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const { registros, error } = P.leerExcelCorte(XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '' }));
    if (error) throw new Error(error);

    const [fichas] = await db.query(
        `SELECT uc.id, uc.numero_identificacion AS cedula, ti.codigo AS tipo, c.fecha_ingreso,
                vs.idvacaciones_saldo AS saldo_id, vs.origen AS saldo_origen
         FROM users_company uc
         LEFT JOIN tipo_identificacion ti ON ti.idtipo_identificacion = uc.tipo_identificacion_idtipo_identificacion
         LEFT JOIN contrato c ON c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = uc.id)
         LEFT JOIN vacaciones_saldo vs ON vs.users_company_id = uc.id`
    );
    const porCedula = new Map();
    for (const f of fichas) {
        const ced = String(f.cedula).trim();
        if (!porCedula.has(ced)) porCedula.set(ced, []);
        porCedula.get(ced).push(f);
    }
    const buscar = (r) => {
        const exactas = porCedula.get(r.cedula) || [];
        if (exactas.length) return exactas;
        // PPT: RRHH lo guarda como 600 + 7 dígitos y el Excel puede traer solo los 7.
        return (porCedula.get(`600${r.cedula}`) || []).filter((f) => f.tipo === 'PPT');
    };

    const resultado = [];
    const cedulasVistas = new Set();
    for (const r of registros) {
        const fila = { fila: r.fila, cedula: r.cedula, nombre: r.nombre, estado: '', detalle: '' };
        resultado.push(fila);
        if (cedulasVistas.has(r.cedula)) { fila.estado = 'repetida'; fila.detalle = 'Cédula repetida en el Excel'; continue; }
        cedulasVistas.add(r.cedula);
        if (!r.fecha || !r.ingreso) { fila.estado = 'error'; fila.detalle = 'Sin fecha de ingreso o fecha actual'; continue; }
        const encontradas = buscar(r);
        if (encontradas.length === 0) { fila.estado = 'sin_ficha'; fila.detalle = 'No hay ficha con esa cédula'; continue; }
        if (encontradas.length > 1) { fila.estado = 'error'; fila.detalle = 'Más de una ficha con esa cédula'; continue; }
        const ficha = encontradas[0];
        const ingresoFicha = P.iso(ficha.fecha_ingreso);
        if (ingresoFicha !== r.ingreso) {
            fila.estado = 'ingreso_distinto';
            fila.detalle = `Ingreso en el Excel ${r.ingreso}, en la ficha ${ingresoFicha || 'vacío'}`;
            continue;
        }
        const calc = P.calcularEmpleado(
            { fecha_ingreso: ingresoFicha },
            { fecha_corte: r.fecha, dias_disfrutados_corte: r.disfrutados, dias_compensados: r.compensados },
            [], r.fecha
        );
        const diferencias = [];
        if (calc.dias_trabajados !== r.trabajados) diferencias.push(`trabajados ${calc.dias_trabajados} vs ${r.trabajados}`);
        if (!casi(calc.dias_acumulados, r.acumulados)) diferencias.push(`acumulados ${calc.dias_acumulados} vs ${r.acumulados}`);
        if (!casi(calc.pasivo_dias, r.pasivo)) diferencias.push(`pasivo ${calc.pasivo_dias} vs ${r.pasivo}`);
        if (diferencias.length) { fila.estado = 'no_coincide'; fila.detalle = diferencias.join('; '); continue; }

        if (ficha.saldo_origen === 'financiera' && !forzar) {
            fila.estado = 'ajustado_financiera';
            fila.detalle = 'Financiera ya ajustó este saldo en la pantalla; no se pisa (usar --forzar para reemplazarlo)';
            continue;
        }
        fila.estado = ficha.saldo_id ? 'actualizar' : 'crear';
        fila.ficha = ficha;
        fila.registro = r;
    }

    const cargables = resultado.filter((f) => f.estado === 'crear' || f.estado === 'actualizar');
    const cuenta = resultado.reduce((m, f) => { m[f.estado] = (m[f.estado] || 0) + 1; return m; }, {});
    console.log(`Excel: ${registros.length} filas. Fecha de corte: ${[...new Set(registros.map((r) => r.fecha))].join(', ')}`);
    console.log('Resultado:', cuenta);
    const totalPasivo = cargables.reduce((s, f) => s + f.registro.pasivo, 0);
    console.log(`Pasivo del Excel de las filas que se cargan: ${P.redondear(totalPasivo)} días`);
    for (const f of resultado.filter((x) => !['crear', 'actualizar'].includes(x.estado)).slice(0, 30)) {
        console.log(`  fila ${f.fila} ${f.estado}: ${f.detalle}`);
    }

    if (rutaReporte) {
        const csv = ['fila,cedula,nombre,estado,detalle',
            ...resultado.map((f) => [f.fila, f.cedula, `"${f.nombre.replace(/"/g, '""')}"`, f.estado, `"${(f.detalle || '').replace(/"/g, '""')}"`].join(','))];
        fs.writeFileSync(rutaReporte, csv.join('\n'));
        console.log(`Reporte: ${rutaReporte}`);
    }

    if (!aplicar) {
        console.log('\nSimulación: no se escribió nada. Repetir con --aplicar para cargar.');
        return;
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        for (const f of cargables) {
            const r = f.registro;
            await conn.query(
                `INSERT INTO vacaciones_saldo (users_company_id, fecha_corte, dias_disfrutados_corte, dias_programados_corte, dias_compensados)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE fecha_corte = VALUES(fecha_corte),
                    dias_disfrutados_corte = VALUES(dias_disfrutados_corte),
                    dias_programados_corte = VALUES(dias_programados_corte),
                    dias_compensados = VALUES(dias_compensados),
                    origen = 'excel', nota = NULL, ajustado_por_user_id = NULL, ajustado_en = NULL`,
                [f.ficha.id, r.fecha, P.redondear(r.disfrutados), P.redondear(r.programadas), P.redondear(r.compensados)]
            );
        }
        await conn.commit();
        console.log(`\nAplicado: ${cargables.length} saldos guardados.`);
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => db.end());
