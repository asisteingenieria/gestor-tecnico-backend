/**
 * Comprueba en el servidor que la copia de expedientes llegó completa (claude/modulo recursoshumanos.md §49).
 *
 *   node scripts/verificarCopiaExpedientes.js --raiz <carpeta expedientes> --manifiesto <manifiesto_final.json>
 *
 * Por cada archivo del manifiesto revisa que exista en <raiz>/<destino>, con el mismo tamaño y el mismo
 * sha256 que se calculó al empaquetarlo. También lista los archivos que hay en <raiz> y no están en el
 * manifiesto. SOLO LEE: no toca archivos ni la base. Sale con código 1 si falta o cambió alguno.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function leerArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        if (['--raiz', '--manifiesto'].includes(argv[i])) args[argv[i].slice(2)] = argv[++i];
        else throw new Error(`Argumento desconocido: ${argv[i]}`);
    }
    if (!args.raiz || !args.manifiesto) throw new Error('Uso: --raiz <carpeta> --manifiesto <manifiesto_final.json>');
    return args;
}

const sha256 = (ruta) => new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(ruta).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

function listar(dir, base = dir) {
    const salida = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) salida.push(...listar(ruta, base));
        else if (e.isFile()) salida.push(path.relative(base, ruta).split(path.sep).join('/'));
    }
    return salida;
}

async function main() {
    const args = leerArgs(process.argv.slice(2));
    const { archivos } = JSON.parse(fs.readFileSync(args.manifiesto, 'utf8'));
    if (!archivos.every(a => a.sha256)) throw new Error('El manifiesto no trae sha256: usar manifiesto_final.json');

    const faltan = [];
    const distintos = [];
    let ok = 0;
    for (const [i, a] of archivos.entries()) {
        const ruta = path.join(args.raiz, ...a.destino.split('/'));
        if (!fs.existsSync(ruta)) faltan.push(a.destino);
        else if (fs.statSync(ruta).size !== a.tamano || await sha256(ruta) !== a.sha256) distintos.push(a.destino);
        else ok++;
        if ((i + 1) % 500 === 0) console.log(`${i + 1}/${archivos.length} revisados`);
    }
    const esperados = new Set(archivos.map(a => a.destino));
    const sobran = listar(args.raiz).filter(r => !esperados.has(r));

    console.log([
        '',
        `Archivos en el manifiesto: ${archivos.length}`,
        `Correctos (existen, mismo tamaño y sha256): ${ok}`,
        `Faltan: ${faltan.length}`, ...faltan.map(f => `  ${f}`),
        `Distintos (tamaño o sha256): ${distintos.length}`, ...distintos.map(f => `  ${f}`),
        `En la carpeta pero no en el manifiesto (informativo): ${sobran.length}`, ...sobran.slice(0, 50).map(f => `  ${f}`)
    ].join('\n'));
    console.log(faltan.length || distintos.length ? '\nRESULTADO: COPIA INCOMPLETA' : '\nRESULTADO: COPIA COMPLETA Y VERIFICADA');
    process.exit(faltan.length || distintos.length ? 1 : 0);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
