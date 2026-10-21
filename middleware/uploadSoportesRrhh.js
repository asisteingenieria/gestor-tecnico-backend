const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Soportes documentales de RRHH (novedades: certificados de incapacidad, epicrisis, registros
// civiles...; traspasos: formatos de evaluación, otrosí...): datos sensibles. Por eso NO van en
// uploads/, que index.js sirve sin login en /api/files, sino en storage/<carpeta>/, y solo se
// descargan por la API con sesión de RRHH.
const RAIZ_STORAGE = path.join(__dirname, '..', 'storage');

const TIPOS_PERMITIDOS = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp']
};
const TAMANO_MAXIMO_MB = 10;

const fileFilter = (req, file, cb) => {
    const extensiones = TIPOS_PERMITIDOS[file.mimetype];
    if (extensiones && extensiones.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'archivo'));
};

// Devuelve el middleware (un archivo en el campo "archivo") y las utilidades de disco de una
// carpeta de storage/. Los errores de multer (tipo o tamaño) responden 400 con un mensaje claro,
// en vez de caer al errorHandler global como 500.
function crearSoportesRrhh(carpeta) {
    const directorio = path.join(RAIZ_STORAGE, carpeta);
    fs.mkdirSync(directorio, { recursive: true });

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, directorio),
        // Nombre generado: el original solo se guarda en BD (nombre_original), nunca se usa como ruta.
        filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
    });
    const upload = multer({ storage, fileFilter, limits: { fileSize: TAMANO_MAXIMO_MB * 1024 * 1024, files: 1 } });

    function middleware(req, res, next) {
        upload.single('archivo')(req, res, (err) => {
            if (!err) return next();
            const message = err.code === 'LIMIT_FILE_SIZE'
                ? `El archivo supera el máximo de ${TAMANO_MAXIMO_MB} MB`
                : err.code === 'LIMIT_UNEXPECTED_FILE'
                    ? 'Solo se aceptan archivos PDF o imagen (JPG, PNG, WEBP)'
                    : `No se pudo recibir el archivo: ${err.message}`;
            res.status(400).json({ success: false, message });
        });
    }

    // Ruta en disco de un archivo, sin salir de la carpeta aunque el nombre guardado en BD trajera
    // "../" (el nombre lo genera el servidor, pero no se confía en él).
    function ruta(nombre) {
        const completa = path.resolve(directorio, path.basename(String(nombre || '')));
        return completa.startsWith(path.resolve(directorio) + path.sep) ? completa : null;
    }

    function borrar(nombre) {
        const completa = ruta(nombre);
        if (completa) fs.unlink(completa, (err) => { if (err && err.code !== 'ENOENT') console.error('No se pudo borrar el soporte', completa, err.message); });
    }

    return { middleware, ruta, borrar };
}

module.exports = {
    soportesNovedad: crearSoportesRrhh('novedades'),
    soportesTraspaso: crearSoportesRrhh('traspasos')
};
