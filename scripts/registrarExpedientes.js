/**
 * Paso 3 de la copia de expedientes (claude/modulo recursoshumanos.md §49): registra en la base los
 * archivos ya copiados a storage/expedientes/ y los asocia a la ficha de cada empleado.
 *
 *   node scripts/registrarExpedientes.js --manifiesto <manifiesto_final.json> [--raiz <carpeta>] [--aplicar]
 *
 * --raiz: la carpeta storage/expedientes/ (por defecto la del backend, o EXPEDIENTES_DIR). Debe ser la
 * misma que usa el backend, o la ficha no encontrará los archivos.
 * Por defecto SOLO SIMULA: dice cuántos archivos registraría, a qué fichas y cuáles no. Con --aplicar
 * escribe. Se puede repetir: lo ya registrado (misma ruta) no se duplica, así que volver a correrlo
 * después de crear la ficha de alguien asocia sus archivos.
 *
 * Asociación, en esta base (los ids y las fichas de producción no son los de local):
 *   1. por la cédula que trae el manifiesto, si existe aquí;
 *   2. si no, por el nombre de la carpeta, con la misma regla que prepararExpedientes.js
 *      (exacto, palabras en otro orden o nombre mal escrito si la ficha es claramente esa).
 * Sin ficha: el archivo queda en disco y no se registra (regla del usuario: se copia, no se asocia).
 * Un archivo del manifiesto que no está en disco se reporta y no se registra.
 *
 * Fija users_company.expediente_carpeta = "<año>/<NOMBRE>" del primer expediente de cada ficha que no
 * tenga carpeta, para que lo que se suba después desde la ficha caiga en la misma carpeta.
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const EmpleadoArchivo = require('../models/EmpleadoArchivo');
const { indexarFichas, asociarCarpeta } = require('../utils/expedientes');
const disco = require('../utils/expedienteDisco');

function leerArgs(argv) {
    const args = { manifiesto: null, raiz: null, aplicar: false };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--aplicar') args.aplicar = true;
        else if (['--manifiesto', '--raiz'].includes(argv[i])) args[argv[i].slice(2)] = argv[++i];
        else throw new Error(`Argumento desconocido: ${argv[i]}`);
    }
    if (!args.manifiesto) throw new Error('Uso: --manifiesto <manifiesto_final.json> [--raiz <carpeta>] [--aplicar]');
    return args;
}

/** Partes del destino "<año>/<NOMBRE>/<CATEGORÍA>/<sub...>/<archivo>". */
function partesDestino(destino) {
    const p = destino.split('/');
    return { carpeta: `${p[0]}/${p[1]}`, nombreCarpeta: p[1], subcarpeta: p.slice(3, -1).join('/') || null, nombre: p[p.length - 1] };
}

async function main() {
    const args = leerArgs(process.argv.slice(2));
    const raiz = path.resolve(args.raiz || disco.RAIZ);
    const { archivos } = JSON.parse(fs.readFileSync(args.manifiesto, 'utf8'));

    const [fichas] = await db.query(`
        SELECT id, numero_identificacion AS cedula, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
               expediente_carpeta
        FROM users_company`);
    const indices = indexarFichas(fichas);
    const [ya] = await db.query('SELECT ruta FROM empleado_archivo');
    const registradas = new Set(ya.map(r => r.ruta));

    // Una asociación por carpeta de empleado (todos sus archivos van juntos).
    const porCarpeta = new Map();
    const asociacionDe = (m) => {
        const { carpeta, nombreCarpeta } = partesDestino(m.destino);
        if (!porCarpeta.has(carpeta)) {
            const porCedula = m.cedula && indices.porCedula.get(String(m.cedula));
            porCarpeta.set(carpeta, porCedula ? { ficha: porCedula, tipo: 'cedula' } : asociarCarpeta(nombreCarpeta, indices));
        }
        return porCarpeta.get(carpeta);
    };

    const conteo = { nuevos: 0, ya_registrados: 0, sin_ficha: 0, falta_en_disco: 0 };
    const sinFicha = new Map();
    const faltan = [];
    const aproximadas = new Set();
    const carpetaFijada = new Map(fichas.filter(f => f.expediente_carpeta).map(f => [f.id, f.expediente_carpeta]));
    const fichasConArchivos = new Set();

    for (const m of archivos) {
        const { carpeta, subcarpeta, nombre } = partesDestino(m.destino);
        const r = asociacionDe(m);
        if (!r.ficha) {
            conteo.sin_ficha++;
            sinFicha.set(carpeta, (sinFicha.get(carpeta) || 0) + 1);
            continue;
        }
        if (r.tipo === 'aproximado') aproximadas.add(`${carpeta} → ${r.ficha.nombre} (${r.puntaje})`);
        const absoluta = path.resolve(raiz, ...m.destino.split('/'));
        if (!absoluta.startsWith(raiz + path.sep) || !fs.existsSync(absoluta)) {
            conteo.falta_en_disco++;
            faltan.push(m.destino);
            continue;
        }
        fichasConArchivos.add(r.ficha.id);
        if (!carpetaFijada.has(r.ficha.id)) {
            carpetaFijada.set(r.ficha.id, carpeta);
            if (args.aplicar) await EmpleadoArchivo.fijarCarpetaSiFalta(r.ficha.id, carpeta);
        }
        if (registradas.has(m.destino)) { conteo.ya_registrados++; continue; }
        if (args.aplicar) {
            await EmpleadoArchivo.registrar({
                usersCompanyId: r.ficha.id, categoria: m.categoria || 'otros', subcarpeta, nombre, ruta: m.destino,
                mime: disco.mimeDe(nombre), tamano: m.tamano, sha256: m.sha256, origen: 'migracion'
            }, { ignorarRepetido: true });
        }
        registradas.add(m.destino);
        conteo.nuevos++;
    }

    const tipos = {};
    for (const r of porCarpeta.values()) tipos[r.tipo] = (tipos[r.tipo] || 0) + 1;
    console.log([
        args.aplicar ? '=== APLICADO ===' : '=== SIMULACIÓN (nada se escribió; usar --aplicar) ===',
        `Raíz: ${raiz}`,
        `Archivos en el manifiesto: ${archivos.length}`,
        `  ${args.aplicar ? 'registrados' : 'se registrarían'} ahora: ${conteo.nuevos}`,
        `  ya estaban registrados: ${conteo.ya_registrados}`,
        `  sin ficha (quedan en disco, sin asociar): ${conteo.sin_ficha}`,
        `  faltan en disco (no se registran): ${conteo.falta_en_disco}`,
        `Fichas con expediente: ${fichasConArchivos.size}`,
        '',
        'Carpetas por tipo de asociación:', ...Object.entries(tipos).map(([k, v]) => `  ${k}: ${v}`),
        '', `Asociadas por nombre parecido: ${aproximadas.size}`, ...[...aproximadas].map(s => `  ${s}`),
        '', `Carpetas sin ficha: ${sinFicha.size}`, ...[...sinFicha].map(([c, n]) => `  ${c} (${n} archivos)`),
        ...(faltan.length ? ['', 'Faltan en disco:', ...faltan.slice(0, 30).map(f => `  ${f}`)] : [])
    ].join('\n'));
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
