const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { RAIZ } = require('../utils/expedienteDisco');

// Subida de un archivo al expediente del empleado (migración 097). Multer lo deja en una carpeta
// temporal dentro de storage/expedientes/ (mismo disco, así moverlo es un rename) y el controller lo
// mueve a <carpeta del empleado>/<categoría>/ con su nombre original saneado.
const TEMPORAL = path.join(RAIZ, '.subidas');
const MAXIMO_MB = 50;
const TIPOS = {
    'application/pdf': ['.pdf'],
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'image/webp': ['.webp']
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdir(TEMPORAL, { recursive: true }, (err) => cb(err, TEMPORAL));
        },
        filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`)
    }),
    fileFilter: (req, file, cb) => {
        const ext = TIPOS[file.mimetype];
        if (ext && ext.includes(path.extname(file.originalname).toLowerCase())) return cb(null, true);
        cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'archivo'));
    },
    limits: { fileSize: MAXIMO_MB * 1024 * 1024, files: 1 }
});

function archivoExpediente(req, res, next) {
    upload.single('archivo')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? `El archivo supera el máximo de ${MAXIMO_MB} MB`
            : err.code === 'LIMIT_UNEXPECTED_FILE'
                ? 'Solo se aceptan archivos PDF o imagen (JPG, PNG, WEBP)'
                : `No se pudo recibir el archivo: ${err.message}`;
        res.status(400).json({ success: false, message });
    });
}

module.exports = { archivoExpediente };
