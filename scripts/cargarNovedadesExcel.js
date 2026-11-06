/**
 * Cargue masivo de novedades de RRHH desde el Excel de Gestión Humana, con su documento del
 * expediente (claude/modulo recursoshumanos.md §50, migración 098).
 *
 *   node scripts/cargarNovedadesExcel.js --excel "<archivo.xlsx>" [--reporte <salida.csv>] [--aplicar]
 *
 * Por defecto SOLO SIMULA: dice cuántas novedades crearía, con cuántos documentos y qué filas no
 * entran y por qué. Con --aplicar escribe, todo en una transacción (si algo falla no queda nada).
 *
 * Por cada fila:
 *   - empleado por cédula (users_company.numero_identificacion) y su contrato más reciente;
 *   - tipo de novedad por la abreviatura (INC según origen, accidente y días; utils/novedadesExcel.js);
 *   - fecha de recibido = la fecha de reporte del Excel (no trae otra; es cuando la recibió Gestión Humana);
 *   - responsable = el Coordinador del Excel, si su nombre corresponde a una sola ficha;
 *   - se salta si el empleado ya tiene una novedad del mismo tipo con la misma fecha inicial (las
 *     cargadas a mano o una corrida anterior): el script se puede repetir sin duplicar;
 *   - documento: los archivos de 6.NOVEDADES del expediente del empleado (empleado_archivo) cuya
 *     primera fecha del nombre es la fecha inicial, en la carpeta del tipo. Se enlazan con
 *     empleado_archivo.novedad_rrhh_id; el archivo no se copia ni se mueve.
 *
 * --reporte: CSV con el resultado fila por fila (lleva cédulas: guardarlo fuera del repo).
 */

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const db = require('../config/db');
const { leerFila, elegirDocumentos } = require('../utils/novedadesExcel');
const { indexarFichas, claveSinOrden } = require('../utils/expedientes');

const OBSERVACION = 'Cargue masivo desde el Excel de novedades de Gestión Humana';

function leerArgs(argv) {
    const args = { excel: null, reporte: null, aplicar: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--aplicar') args.aplicar = true;
        else if (['--excel', '--reporte'].includes(argv[i])) args[argv[i].slice(2)] = argv[++i];
        else throw new Error(`Argumento desconocido: ${argv[i]}`);
    }
    if (!args.excel) throw new Error('Uso: --excel <archivo.xlsx> [--reporte <salida.csv>] [--aplicar]');
    return args;
}

const csv = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
    const args = leerArgs(process.argv.slice(2));
    const libro = XLSX.readFile(args.excel);
    const filasExcel = XLSX.utils.sheet_to_json(libro.Sheets[libro.SheetNames[0]], { defval: null });
    // Fila 1 = encabezados; la primera de datos es la 2, como la ve RRHH en Excel.
    const filas = filasExcel.map((raw, i) => ({ ...leerFila(raw, i + 2), coordinador: raw.Coordinador }));

    // --- Catálogos y datos de esta base (los ids de producción no son los de local) ---
    const [tipos] = await db.query('SELECT idtipo_novedad AS id, nombre FROM tipo_novedad');
    const tipoPorNombre = new Map(tipos.map(t => [t.nombre.toLowerCase(), t.id]));

    const [fichas] = await db.query(`
        SELECT uc.id, uc.numero_identificacion AS cedula, uc.primer_nombre, uc.segundo_nombre,
               uc.primer_apellido, uc.segundo_apellido,
               (SELECT MAX(c.idcontrato) FROM contrato c WHERE c.users_company_id = uc.id) AS contrato_id
        FROM users_company uc`);
    const indices = indexarFichas(fichas);
    const porCedula = new Map(fichas.map(f => [String(f.cedula).replace(/\D/g, ''), f]));

    const [existentes] = await db.query(`
        SELECT c.users_company_id AS uc, nr.tipo_novedad_idtipo_novedad AS tipo, DATE_FORMAT(nr.fecha_inicial, '%Y-%m-%d') AS fi
        FROM novedad_rrhh nr JOIN contrato c ON c.idcontrato = nr.contrato_idcontrato`);
    const yaCargadas = new Set(existentes.map(e => `${e.uc}|${e.tipo}|${e.fi}`));

    const [archivos] = await db.query(`
        SELECT idempleado_archivo AS id, users_company_id AS uc, subcarpeta, nombre
        FROM empleado_archivo WHERE categoria = 'novedades' AND novedad_rrhh_id IS NULL`);
    const archivosDe = new Map();
    for (const a of archivos) archivosDe.set(a.uc, [...(archivosDe.get(a.uc) || []), a]);

    // --- Plan fila por fila ---
    const usados = new Set();
    const vistas = new Set();
    const plan = [];
    for (const f of filas) {
        const r = { ...f, estado: null, motivo: '', ficha: null, documentos: [], descartados: [] };
        plan.push(r);
        if (f.errores.length) { r.estado = 'error'; r.motivo = f.errores.join('; '); continue; }

        const ficha = porCedula.get(f.cedula);
        if (!ficha) { r.estado = 'sin_ficha'; r.motivo = 'la cédula no tiene ficha en esta base'; continue; }
        if (!ficha.contrato_id) { r.estado = 'sin_contrato'; r.motivo = 'la ficha no tiene contrato'; continue; }
        r.ficha = ficha;

        r.tipoId = tipoPorNombre.get(f.tipoNombre.toLowerCase());
        if (!r.tipoId) { r.estado = 'error'; r.motivo = `el tipo "${f.tipoNombre}" no está en tipo_novedad`; continue; }

        const llave = `${ficha.id}|${r.tipoId}|${f.fechaInicial}`;
        if (yaCargadas.has(llave)) { r.estado = 'ya_existe'; r.motivo = 'ya hay una novedad del mismo tipo con esa fecha inicial'; continue; }
        if (vistas.has(llave)) { r.estado = 'repetida'; r.motivo = 'fila repetida en el Excel (mismo empleado, tipo y fecha inicial)'; continue; }
        vistas.add(llave);

        const coord = f.coordinador ? indices.sinOrden.get(claveSinOrden(String(f.coordinador))) : null;
        r.responsableId = coord && coord.length === 1 ? coord[0].id : null;

        const { elegidos, descartados } = elegirDocumentos(f, archivosDe.get(ficha.id) || [], usados);
        elegidos.forEach(a => usados.add(a.id));
        r.documentos = elegidos;
        r.descartados = descartados;
        r.estado = 'nueva';
    }

    // --- Resumen ---
    const contar = (pred) => plan.filter(pred).length;
    const nuevas = plan.filter(r => r.estado === 'nueva');
    console.log(`\nExcel: ${filas.length} filas · ${args.aplicar ? 'APLICANDO' : 'SIMULACIÓN (nada se escribe; usar --aplicar)'}\n`);
    console.log(`  Novedades a crear ............ ${nuevas.length}`);
    console.log(`    con documento del expediente ${contar(r => r.estado === 'nueva' && r.documentos.length)} (${nuevas.reduce((s, r) => s + r.documentos.length, 0)} archivos)`);
    console.log(`    sin documento .............. ${contar(r => r.estado === 'nueva' && !r.documentos.length)}`);
    console.log(`    con responsable (coordinador) ${contar(r => r.estado === 'nueva' && r.responsableId)}`);
    for (const [estado, texto] of [['ya_existe', 'Ya cargadas (se saltan)'], ['repetida', 'Repetidas en el Excel'],
        ['sin_ficha', 'Cédula sin ficha'], ['sin_contrato', 'Ficha sin contrato'], ['error', 'Con error']]) {
        const n = contar(r => r.estado === estado);
        if (n) console.log(`  ${texto.padEnd(29, '.')} ${n}`);
    }

    const porTipo = {};
    for (const r of nuevas) {
        const t = (porTipo[r.tipoNombre] ||= { total: 0, doc: 0 });
        t.total++; if (r.documentos.length) t.doc++;
    }
    console.log('\n  Por tipo (a crear / con documento):');
    for (const [t, v] of Object.entries(porTipo).sort((a, b) => b[1].total - a[1].total)) {
        console.log(`    ${String(v.total).padStart(4)} / ${String(v.doc).padStart(4)}  ${t}`);
    }
    const otraCarpeta = nuevas.filter(r => !r.documentos.length && r.descartados.length);
    if (otraCarpeta.length) {
        console.log(`\n  ${otraCarpeta.length} sin documento tienen un archivo con la misma fecha en la carpeta de OTRO tipo (no se enlaza; ver el reporte).`);
    }
    for (const r of plan.filter(x => x.estado === 'error')) console.log(`  Fila ${r.fila}: ${r.motivo}`);

    if (args.reporte) {
        const lineas = [['fila', 'cedula', 'novedad', 'tipo', 'fecha_inicial', 'estado', 'motivo', 'documentos', 'misma_fecha_otra_carpeta'].join(',')];
        for (const r of plan) {
            lineas.push([r.fila, r.cedula, r.abreviatura, r.tipoNombre, r.fechaInicial, r.estado, r.motivo,
                r.documentos.map(a => `${a.subcarpeta || ''}/${a.nombre}`).join(' | '),
                r.descartados.map(a => `${a.subcarpeta || ''}/${a.nombre}`).join(' | ')].map(csv).join(','));
        }
        fs.writeFileSync(path.resolve(args.reporte), '﻿' + lineas.join('\n'), 'utf8');
        console.log(`\n  Reporte fila por fila: ${path.resolve(args.reporte)}`);
    }

    if (!args.aplicar) return;

    // --- Escritura, todo o nada ---
    const conn = await db.getConnection();
    let creadas = 0; let enlazados = 0;
    try {
        await conn.beginTransaction();
        for (const r of nuevas) {
            const [res] = await conn.query(
                `INSERT INTO novedad_rrhh (accidente_transito, fecha_inicial, fecha_final, fecha_retorno, total_dias,
                    origen_incapacidad, observaciones, fecha_reporte, fecha_recibido, tipo_novedad_idtipo_novedad, contrato_idcontrato, responsable_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [r.accidenteTransito ? 1 : 0, r.fechaInicial, r.fechaFinal, r.fechaRetorno, r.totalDias,
                    r.origen, `${OBSERVACION} (fila ${r.fila}).`, r.fechaReporte, r.fechaReporte, r.tipoId, r.ficha.contrato_id, r.responsableId]
            );
            creadas++;
            if (r.documentos.length) {
                const [up] = await conn.query(
                    'UPDATE empleado_archivo SET novedad_rrhh_id = ? WHERE idempleado_archivo IN (?) AND novedad_rrhh_id IS NULL',
                    [res.insertId, r.documentos.map(a => a.id)]
                );
                enlazados += up.affectedRows;
            }
        }
        await conn.commit();
        console.log(`\n  Listo: ${creadas} novedades creadas y ${enlazados} documentos enlazados.`);
    } catch (error) {
        await conn.rollback();
        console.error('\n  Falló; no se escribió nada (rollback):', error.message);
        process.exitCode = 1;
    } finally {
        conn.release();
    }
}

main()
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => process.exit());
