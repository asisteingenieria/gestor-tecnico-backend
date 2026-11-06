/**
 * Paso 2 de la copia de expedientes (claude/modulo recursoshumanos.md §49): arma un .tar con todos los
 * archivos del manifiesto que generó scripts/prepararExpedientes.js, ya en su estructura organizada
 * (expedientes/<año>/<APELLIDOS NOMBRES>/1.SELECCION/...), para subirlo al servidor en una sola copia.
 *
 *   node scripts/empaquetarExpedientes.js [--salida <carpeta>]
 *
 * Lee <salida>/manifiesto.json (por defecto Downloads/expedientes_bogota) y escribe en la misma carpeta:
 *   - expedientes_bogota.tar
 *   - manifiesto_final.json: el manifiesto con el tamaño y el sha256 de los bytes que entraron al .tar
 *     (calculados al empaquetar, en la misma lectura). En el servidor,
 *     scripts/verificarCopiaExpedientes.js lo usa para comprobar que llegaron todos y sin cambios.
 *
 * SOLO LEE la carpeta compartida. Si falta un archivo del manifiesto (lo borraron o movieron después de
 * preparar), se detiene: hay que volver a correr prepararExpedientes.js. Los nombres van en UTF-8 (cabecera
 * pax), así que tildes y eñes llegan bien al servidor Linux.
 *
 * El .tar y los manifiestos llevan documentos y cédulas de empleados: no se versionan ni se dejan en
 * lugares compartidos; se borran del equipo cuando la copia quede verificada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const tar = require('tar-stream');

// --origen: leer de una copia local (hecha con robocopy, que se puede retomar si se corta) en vez de la
// carpeta compartida que dice el manifiesto. Las rutas relativas son las mismas.
function leerArgs(argv) {
    const args = { salida: path.join(os.homedir(), 'Downloads', 'expedientes_bogota'), origen: null };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--salida') args.salida = argv[++i];
        else if (argv[i] === '--origen') args.origen = argv[++i];
        else throw new Error(`Argumento desconocido: ${argv[i]}`);
    }
    return args;
}

/** Agrega un archivo al paquete calculando su sha256 sobre los mismos bytes. */
function agregar(pack, rutaAbs, nombre, stat) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        let leidos = 0;
        const entrada = pack.entry({ name: nombre, size: stat.size, mtime: stat.mtime, mode: 0o640 }, (err) => {
            if (err) return reject(err);
            if (leidos !== stat.size) return reject(new Error(`${nombre}: se leyeron ${leidos} bytes de ${stat.size}`));
            resolve(hash.digest('hex'));
        });
        fs.createReadStream(rutaAbs)
            .on('data', (d) => { hash.update(d); leidos += d.length; })
            .on('error', reject)
            .pipe(entrada);
    });
}

async function main() {
    const args = leerArgs(process.argv.slice(2));
    const manifiesto = JSON.parse(fs.readFileSync(path.join(args.salida, 'manifiesto.json'), 'utf8'));
    const { archivos } = manifiesto;
    const origen = args.origen || manifiesto.origen;

    // Antes de empezar, que estén todos: no se arma un paquete incompleto.
    const faltantes = archivos.filter(a => !fs.existsSync(path.join(origen, ...a.origen.split('/'))));
    if (faltantes.length) {
        throw new Error(`Faltan ${faltantes.length} archivos del manifiesto en el origen (p. ej. ${faltantes[0].origen}). `
            + 'Volver a correr prepararExpedientes.js.');
    }

    const rutaTar = path.join(args.salida, 'expedientes_bogota.tar');
    const pack = tar.pack();
    const salida = fs.createWriteStream(rutaTar);
    const terminado = new Promise((resolve, reject) => { salida.on('finish', resolve); salida.on('error', reject); });
    pack.pipe(salida);

    const final = [];
    let bytes = 0;
    let cambiados = 0;
    const inicio = Date.now();
    for (const [i, a] of archivos.entries()) {
        const rutaAbs = path.join(origen, ...a.origen.split('/'));
        const stat = fs.statSync(rutaAbs);
        if (stat.size !== a.tamano) cambiados++;
        const sha256 = await agregar(pack, rutaAbs, `expedientes/${a.destino}`, stat);
        bytes += stat.size;
        final.push({ ...a, tamano: stat.size, sha256 });
        if ((i + 1) % 250 === 0 || i + 1 === archivos.length) {
            const seg = Math.round((Date.now() - inicio) / 1000);
            console.log(`${i + 1}/${archivos.length} archivos, ${(bytes / 1024 ** 3).toFixed(2)} GB, ${seg} s`);
        }
    }
    pack.finalize();
    await terminado;

    fs.writeFileSync(path.join(args.salida, 'manifiesto_final.json'), JSON.stringify({
        ...manifiesto, empaquetado: new Date().toISOString(), con_hash: true, archivos: final
    }, null, 1));

    const tamTar = fs.statSync(rutaTar).size;
    const hashTar = await new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(rutaTar).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
    fs.writeFileSync(path.join(args.salida, 'expedientes_bogota.tar.sha256'), `${hashTar}  expedientes_bogota.tar\n`);

    console.log([
        '',
        `Paquete: ${rutaTar} (${(tamTar / 1024 ** 3).toFixed(2)} GB)`,
        `Archivos: ${final.length} (${(bytes / 1024 ** 3).toFixed(2)} GB de documentos)`,
        `Cambiaron de tamaño desde que se preparó el manifiesto: ${cambiados} (el manifiesto final trae el tamaño real)`,
        `sha256 del paquete: ${hashTar}`
    ].join('\n'));
}

main()
    .then(() => process.exit(0))
    .catch((e) => { console.error(e.message); process.exit(1); });
