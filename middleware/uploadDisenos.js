const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = 'uploads/disenos';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}_${Math.round(Math.random() * 1E9)}_${file.originalname}`;
        cb(null, uniqueName);
    }
});

const uploadDisenos = multer({
    storage,
    limits: {
        fileSize: 20 * 1024 * 1024,
        files: 60
    }
});

module.exports = uploadDisenos;
