const multer = require('multer');

// A diferencia de uploadActivos/uploadDisenos (diskStorage), este archivo solo
// se necesita en memoria: se parsea con xlsx y se descarta, nunca se persiste.
const storage = multer.memoryStorage();

const TIPOS_PERMITIDOS = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'application/octet-stream' // algunos clientes no reconocen el mimetype de Office Open XML
];

const fileFilter = (req, file, cb) => {
    const extensionValida = /\.(xlsx|xls)$/i.test(file.originalname);
    if (TIPOS_PERMITIDOS.includes(file.mimetype) && extensionValida) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no permitido. Solo se aceptan archivos Excel (.xlsx, .xls).'), false);
    }
};

const uploadEmpleados = multer({
    storage,
    limits: {
        fileSize: 15 * 1024 * 1024, // 15MB
        files: 1
    },
    fileFilter
});

module.exports = uploadEmpleados;
