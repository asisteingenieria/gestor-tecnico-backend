// Disco del expediente documental del empleado (migración 097, claude/modulo recursoshumanos.md §49).
// Todo vive en storage/expedientes/ (privado: no se sirve por /api/files, solo por la API con sesión).
// Las rutas de la base son relativas a esa raíz y nunca se usan sin pasar por `rutaSegura`.

const fs = require('fs');
const path = require('path');
const { CATEGORIAS } = require('./expedientes');

const RAIZ = path.resolve(process.env.EXPEDIENTES_DIR || path.join(__dirname, '..', 'storage', 'expedientes'));

/** Ruta absoluta de una ruta relativa del expediente, o null si se saldría de la raíz ("../"). */
function rutaSegura(relativa) {
    const completa = path.resolve(RAIZ, ...String(relativa || '').split('/'));
    return completa.startsWith(RAIZ + path.sep) ? completa : null;
}

/** Crea la carpeta del empleado con sus seis subcarpetas (si ya existen, no hace nada). */
async function crearEstructura(carpeta) {
    const base = rutaSegura(carpeta);
    if (!base) throw new Error(`Carpeta de expediente inválida: ${carpeta}`);
    await Promise.all(CATEGORIAS.map(c => fs.promises.mkdir(path.join(base, c.carpeta), { recursive: true })));
    return base;
}

// Nombre de archivo que se puede guardar tal cual: sin separadores de ruta ni caracteres que Windows o
// Linux no aceptan, sin espacios al final y con largo acotado.
function nombreArchivoSeguro(nombre) {
    const limpio = path.basename(String(nombre || 'archivo'))
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
        .replace(/^\.+/, '')
        .trim();
    const ext = path.extname(limpio).slice(0, 10);
    const base = limpio.slice(0, limpio.length - path.extname(limpio).length).slice(0, 150) || 'archivo';
    return base + ext;
}

/** Primer nombre libre en `dir`: "x.pdf", "x (2).pdf", "x (3).pdf"... */
function nombreLibre(dir, nombre) {
    const ext = path.extname(nombre);
    const base = nombre.slice(0, nombre.length - ext.length);
    let candidato = nombre;
    for (let n = 2; fs.existsSync(path.join(dir, candidato)); n++) candidato = `${base} (${n})${ext}`;
    return candidato;
}

const MIME_POR_EXTENSION = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};
const mimeDe = (nombre) => MIME_POR_EXTENSION[path.extname(nombre).toLowerCase()] || 'application/octet-stream';

module.exports = { RAIZ, rutaSegura, crearEstructura, nombreArchivoSeguro, nombreLibre, mimeDe };
