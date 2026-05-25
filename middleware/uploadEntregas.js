const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = 'uploads/disenos/entregas';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${safeName}`);
    }
});

// Acepta cualquier tipo de archivo sin filtro de mimetype
const uploadEntregas = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024, files: 10 }
});

module.exports = uploadEntregas;
