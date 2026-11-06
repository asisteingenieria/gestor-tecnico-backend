/**
 * Prepara la copia de los expedientes de empleados de la carpeta compartida de Gestión Humana
 * (ALTAS FORMATO, Bogotá) al servidor. Paso 1 de 3 (ver claude/modulo recursoshumanos.md §49).
 *
 *   node scripts/prepararExpedientes.js [--origen <carpeta>] [--salida <carpeta>]
 *                                       [--equivalencias <archivo.csv>] [--hash]
 *
 * SOLO LEE: no modifica la carpeta compartida ni la base. Recorre <origen>/<año>/<APELLIDOS NOMBRES>/,
 * asocia cada carpeta a una ficha de users_company por nombre y escribe en <salida>:
 *
 *   - manifiesto.json: un registro por archivo con su ruta de origen, su ruta normalizada en el
 *     expediente (<año>/<APELLIDOS NOMBRES>/<categoría>/...), la cédula del empleado, categoría,
 *     subtipo de novedad, tamaño y, con --hash, su sha256. El servidor lo usa para ubicar y
 *     registrar cada archivo (paso 3). Se asocia por cédula, no por id: los ids locales y los de
 *     producción no son los mismos.
 *   - revisar.csv: carpetas sin ficha (sin coincidencia o ambiguas). Sirve de plantilla de
 *     --equivalencias: si alguna sí tiene ficha con otro nombre, se pone su cédula y se vuelve a correr.
 *   - reporte.txt: resumen, con las carpetas asociadas por nombre parecido para revisarlas.
 *
 * Regla (decisión del usuario, 2026-11-05): TODO se copia; lo que tiene ficha se asocia y lo que no,
 * no. El manifiesto trae todos los archivos del origen (el script falla si falta uno). Lo que está
 * fuera de las seis carpetas va a OTROS/<ruta original>. Un nombre mal escrito ("VALENTINA" /
 * "VALENTIA") se asocia si la ficha es claramente esa (umbral y ventaja de homologar). Sin ficha, el
 * archivo va con `cedula: null` a una carpeta con su propio nombre.
 *
 * El manifiesto y el CSV llevan cédulas: la salida va fuera del repo (Descargas) y no se versiona.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/db');
const {
    CATEGORIA_POR_CLAVE, normalizarTexto, clasificarCarpeta, ubicarArchivo, indexarFichas, asociarCarpeta
} = require('../utils/expedientes');

const ORIGEN_POR_DEFECTO = '//10.255.255.10/compartida-asiste/GESTION HUMANA/COMUN/ASISTE ING/01 .BOGOTA/'
    + 'GESTION DOCUMENTAL/CARPETAS ASISTE ING/BOGOTA/ALTAS FORMATO';
const SALIDA_POR_DEFECTO = path.join(os.homedir(), 'Downloads', 'expedientes_bogota');

function leerArgs(argv) {
    const args = { origen: ORIGEN_POR_DEFECTO, salida: SALIDA_POR_DEFECTO, equivalencias: null, hash: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--hash') args.hash = true;
        else if (['--origen', '--salida', '--equivalencias'].includes(a)) args[a.slice(2)] = argv[++i];
        else throw new Error(`Argumento desconocido: ${a}`);
    }
    return args;
}

// CSV con ; (Excel en español). Columnas: carpeta;cedula — carpeta = "<año>/<nombre de la carpeta>".
function leerEquivalencias(archivo) {
    const mapa = new Map();
    if (!archivo) return mapa;
    const lineas = fs.readFileSync(archivo, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
    for (const linea of lineas.slice(1)) {
        const [carpeta, cedula] = linea.split(';').map(s => (s || '').trim());
        if (carpeta && cedula) mapa.set(carpeta.toUpperCase(), cedula);
    }
    return mapa;
}

async function cargarFichas() {
    const [rows] = await db.query(`
        SELECT uc.id, uc.numero_identificacion AS cedula,
               uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido,
               (SELECT MIN(c.fecha_ingreso) FROM contrato c WHERE c.users_company_id = uc.id) AS fecha_ingreso
        FROM users_company uc`);
    return rows;
}

/** Ficha de una carpeta: la equivalencia forzada, si la hay; si no, por nombre (utils/expedientes). */
function asociar(carpeta, idCarpeta, indices, equivalencias) {
    const forzada = equivalencias.get(idCarpeta.toUpperCase());
    if (forzada) {
        const ficha = indices.porCedula.get(forzada);
        return ficha ? { ficha, tipo: 'equivalencia' } : { tipo: 'equivalencia_sin_ficha', detalle: forzada };
    }
    return asociarCarpeta(carpeta, indices);
}

function listarArchivos(dir, base = dir) {
    const salida = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) salida.push(...listarArchivos(ruta, base));
        else if (e.isFile()) salida.push(path.relative(base, ruta).split(path.sep));
    }
    return salida;
}

function sha256(ruta) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(ruta).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}

const csv = (v) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
    const args = leerArgs(process.argv.slice(2));
    if (!fs.existsSync(args.origen)) throw new Error(`No se encuentra la carpeta de origen: ${args.origen}`);
    fs.mkdirSync(args.salida, { recursive: true });

    const fichas = await cargarFichas();
    const indices = indexarFichas(fichas);
    const equivalencias = leerEquivalencias(args.equivalencias);

    const anios = fs.readdirSync(args.origen, { withFileTypes: true })
        .filter(e => e.isDirectory() && /^\d{4}$/.test(e.name)).map(e => e.name).sort();

    const manifiesto = [];
    const revisar = [];
    const sinClasificar = [];
    const anioDistinto = [];
    const aproximadas = [];
    const conteo = {};
    const destinos = new Set();
    const cedulaPorCarpetaDestino = new Map();
    let renombrados = 0;
    let bytes = 0;
    let totalArchivos = 0;

    for (const anio of anios) {
        const dirAnio = path.join(args.origen, anio);
        const carpetas = fs.readdirSync(dirAnio, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
        for (const carpeta of carpetas) {
            const idCarpeta = `${anio}/${carpeta}`;
            const r = asociar(carpeta, idCarpeta, indices, equivalencias);
            conteo[r.tipo] = (conteo[r.tipo] || 0) + 1;
            const archivos = listarArchivos(path.join(dirAnio, carpeta));

            // Todo se copia. Con ficha, se asocia; sin ficha, el archivo va con cedula null a una carpeta con su
            // propio nombre (y el servidor vuelve a buscar la ficha contra su base al registrarlo).
            const { ficha } = r;
            if (r.tipo === 'aproximado') aproximadas.push(`${idCarpeta} → ${ficha.nombre} (${r.puntaje})`);
            if (!ficha) {
                revisar.push({
                    carpeta: idCarpeta, cedula: '', motivo: r.tipo,
                    sugerida: (r.candidatas || []).map(x => `${x.nombre} (${x.cedula})`).join(' | ') || r.detalle || '',
                    puntaje: r.puntaje ?? '', archivos: archivos.length
                });
            }

            const carpetaDestino = `${anio}/${ficha ? ficha.nombre : normalizarTexto(carpeta)}`;
            // Dos carpetas de origen de la misma persona (p. ej. en 2025 y 2026) se respetan cada una en su
            // año; dos personas distintas que caigan en el mismo destino serían un error de asociación.
            const dueno = ficha ? String(ficha.cedula) : `sin-ficha:${idCarpeta}`;
            const otra = cedulaPorCarpetaDestino.get(carpetaDestino);
            if (otra && otra !== dueno) throw new Error(`Dos carpetas de personas distintas en el mismo destino: ${carpetaDestino}`);
            cedulaPorCarpetaDestino.set(carpetaDestino, dueno);

            const anioIngreso = ficha?.fecha_ingreso ? new Date(ficha.fecha_ingreso).getUTCFullYear() : null;
            if (anioIngreso && String(anioIngreso) !== anio) anioDistinto.push(`${idCarpeta} (ingreso ${anioIngreso})`);

            // Un PDF suelto en la carpeta del empleado cuando su 1.SELECCION existe pero está vacía es, por el
            // patrón de las demás carpetas (un PDF con el nombre del empleado), el de selección (§49).
            const seleccionVacia = fs.readdirSync(path.join(dirAnio, carpeta), { withFileTypes: true })
                .some(e => e.isDirectory() && clasificarCarpeta(e.name) === 'seleccion')
                && !archivos.some(p => p.length > 1 && clasificarCarpeta(p[0]) === 'seleccion');

            for (const partes of archivos) {
                totalArchivos++;
                const origenRel = [anio, carpeta, ...partes].join('/');
                const u = partes.length === 1 && seleccionVacia
                    ? { categoria: 'seleccion', subtipo: null, partes: [CATEGORIA_POR_CLAVE.seleccion.carpeta, partes[0]] }
                    : ubicarArchivo(partes);
                if (!u.categoria) sinClasificar.push(origenRel);

                // Dos archivos con el mismo nombre que caen en la misma carpeta (p. ej. venían de
                // "2. DOCUMENTOS" y "2.DOCUMENTOS"): el segundo se renombra "nombre (2).pdf".
                let destino = [carpetaDestino, ...u.partes].join('/');
                if (destinos.has(destino.toUpperCase())) {
                    const ext = path.posix.extname(destino);
                    const baseSinExt = destino.slice(0, destino.length - ext.length);
                    let n = 2;
                    while (destinos.has(`${baseSinExt} (${n})${ext}`.toUpperCase())) n++;
                    destino = `${baseSinExt} (${n})${ext}`;
                    renombrados++;
                }
                destinos.add(destino.toUpperCase());

                const rutaAbs = path.join(args.origen, ...origenRel.split('/'));
                const { size } = fs.statSync(rutaAbs);
                bytes += size;
                manifiesto.push({
                    origen: origenRel, destino, cedula: ficha ? String(ficha.cedula) : null, asociacion: r.tipo,
                    categoria: u.categoria, subtipo: u.subtipo, tamano: size,
                    ...(args.hash ? { sha256: await sha256(rutaAbs) } : {})
                });
            }
        }
        console.log(`${anio}: ${carpetas.length} carpetas leídas`);
    }

    // Archivos sueltos directamente en <año>/ (fuera de toda carpeta de empleado): también se copian.
    for (const anio of anios) {
        for (const e of fs.readdirSync(path.join(args.origen, anio), { withFileTypes: true }).filter(x => x.isFile())) {
            totalArchivos++;
            const origenRel = `${anio}/${e.name}`;
            const { size } = fs.statSync(path.join(args.origen, anio, e.name));
            bytes += size;
            sinClasificar.push(origenRel);
            manifiesto.push({
                origen: origenRel, destino: `${anio}/OTROS/${e.name}`, cedula: null, asociacion: 'sin_carpeta',
                categoria: null, subtipo: null, tamano: size,
                ...(args.hash ? { sha256: await sha256(path.join(args.origen, anio, e.name)) } : {})
            });
        }
    }
    if (manifiesto.length !== totalArchivos) {
        throw new Error(`El manifiesto tiene ${manifiesto.length} archivos y el origen ${totalArchivos}: faltaría copiar alguno`);
    }

    fs.writeFileSync(path.join(args.salida, 'manifiesto.json'), JSON.stringify({
        generado: new Date().toISOString(), origen: args.origen, con_hash: args.hash, archivos: manifiesto
    }, null, 1));

    const encabezado = 'carpeta;cedula;motivo;ficha_sugerida;puntaje;archivos';
    const filas = revisar.map(f => [f.carpeta, f.cedula, f.motivo, f.sugerida, f.puntaje, f.archivos].map(csv).join(';'));
    fs.writeFileSync(path.join(args.salida, 'revisar.csv'), '﻿' + [encabezado, ...filas].join('\r\n'));

    const porCategoria = {};
    const porSubtipo = {};
    for (const m of manifiesto) {
        porCategoria[m.categoria] = (porCategoria[m.categoria] || 0) + 1;
        if (m.subtipo) porSubtipo[m.subtipo] = (porSubtipo[m.subtipo] || 0) + 1;
    }
    const orden = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join('\n');
    const reporte = [
        `Origen: ${args.origen}`,
        `Fichas en la base: ${fichas.length}`,
        '',
        'Carpetas de empleado por tipo de asociación:', orden(conteo),
        '',
        `Archivos en el manifiesto: ${manifiesto.length} de ${totalArchivos} en el origen (${(bytes / 1024 ** 3).toFixed(2)} GB)`,
        `  asociados a una ficha: ${manifiesto.filter(m => m.cedula).length}`,
        `  copiados pero pendientes de asociar: ${manifiesto.filter(m => !m.cedula).length}`,
        `Renombrados por nombre repetido en la misma carpeta: ${renombrados}`,
        '', 'Por categoría:', orden(porCategoria),
        '', 'Subcarpetas de novedades:', orden(porSubtipo),
        '', `Asociadas por nombre parecido (mal escrito en un lado; revisar): ${aproximadas.length}`,
        ...aproximadas.map(s => `  ${s}`),
        '', `Carpetas sin ficha, se copian sin asociar (revisar.csv): ${revisar.length}`,
        `Archivos fuera de las seis carpetas (se copian en OTROS/): ${sinClasificar.length}`,
        ...sinClasificar.map(s => `  ${s}`),
        '', `Carpetas cuyo año no coincide con el ingreso de la ficha (informativo, se respeta el año de la carpeta): ${anioDistinto.length}`,
        ...anioDistinto.map(s => `  ${s}`)
    ].join('\n');
    fs.writeFileSync(path.join(args.salida, 'reporte.txt'), reporte);
    console.log(`\n${reporte}\n\nSalida en ${args.salida}`);
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
