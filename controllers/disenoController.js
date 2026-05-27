const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const Diseno = require('../models/Diseno');

const getDisenos = async (req, res) => {
    try {
        const { estado, fecha_desde, fecha_hasta } = req.query;
        const filters = {};

        if (estado) filters.estado = estado;
        if (fecha_desde) filters.fecha_desde = fecha_desde;
        if (fecha_hasta) filters.fecha_hasta = fecha_hasta;

        if (req.user.role === 'disenador') {
            // El diseñador solo ve los asignados a él (incluyendo los que creó para sí mismo)
            filters.disenador_id = req.user.id;
        } else if (req.user.role === 'admin') {
            // Admin ve todo excepto los que un diseñador creó para sí mismo
            filters.exclude_disenador_solicitudes = true;
        } else {
            // Coordinador, jefe_operaciones y cualquier otro rol: solo ve sus propias solicitudes
            filters.solicitante_id = req.user.id;
        }

        const disenos = await Diseno.getAll(filters);
        res.json({ success: true, data: disenos });
    } catch (err) {
        console.error('Error al obtener diseños:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const getDisenoById = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        if (!_canViewDiseno(diseno, role, userId)) {
            return res.status(403).json({ success: false, message: 'Sin permisos para ver este diseño' });
        }

        res.json({ success: true, data: diseno });
    } catch (err) {
        console.error('Error al obtener diseño:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const createDiseno = async (req, res) => {
    const uploadedFiles = req.files ? req.files.map(f => f.filename) : [];
    try {
        const { nombre, descripcion } = req.body;

        if (!nombre || !descripcion) {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(400).json({ success: false, message: 'nombre y descripcion son requeridos' });
        }

        const id = await Diseno.create({ nombre, descripcion, solicitante_id: req.user.id });

        if (uploadedFiles.length > 0) {
            await Diseno.addImagenes(id, uploadedFiles);
        }

        let autoAsignadoMsg = null;

        if (req.user.role === 'disenador') {
            await Diseno.assign(id, req.user.id);
            autoAsignadoMsg = 'Diseño creado y asignado a ti';
        } else {
            const disenadores = await Diseno.getDisenadores();
            if (disenadores.length === 1) {
                await Diseno.assign(id, disenadores[0].id);
                autoAsignadoMsg = `Diseño creado y asignado automáticamente a ${disenadores[0].full_name}`;
            }
        }

        const diseno = await Diseno.getById(id);
        res.status(201).json({
            success: true,
            message: autoAsignadoMsg || 'Diseño creado correctamente',
            data: diseno
        });
    } catch (err) {
        uploadedFiles.forEach(f => _deleteFile('disenos', f));
        console.error('Error al crear diseño:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const updateDiseno = async (req, res) => {
    const uploadedFiles = req.files ? req.files.map(f => f.filename) : [];
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        const canEdit =
            role === 'admin' ||
            diseno.solicitante_id === userId;

        if (!canEdit) {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(403).json({ success: false, message: 'Sin permisos para editar este diseño' });
        }

        const nombre = req.body.nombre || diseno.nombre;
        const descripcion = req.body.descripcion || diseno.descripcion;

        await Diseno.update(req.params.id, { nombre, descripcion });

        if (uploadedFiles.length > 0) {
            await Diseno.addImagenes(req.params.id, uploadedFiles);
        }

        const updated = await Diseno.getById(req.params.id);
        res.json({ success: true, message: 'Diseño actualizado', data: updated });
    } catch (err) {
        uploadedFiles.forEach(f => _deleteFile('disenos', f));
        console.error('Error al actualizar diseño:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const deleteDiseno = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const filenames = await Diseno.delete(req.params.id);
        filenames.forEach(f => _deleteFile('disenos', f));

        res.json({ success: true, message: 'Diseño eliminado' });
    } catch (err) {
        console.error('Error al eliminar diseño:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const assignDesigner = async (req, res) => {
    try {
        const { disenador_id } = req.body;
        if (!disenador_id) {
            return res.status(400).json({ success: false, message: 'disenador_id es requerido' });
        }

        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        await Diseno.assign(req.params.id, disenador_id);
        const updated = await Diseno.getById(req.params.id);
        res.json({ success: true, message: 'Diseñador asignado', data: updated });
    } catch (err) {
        console.error('Error al asignar diseñador:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const downloadEntregas = async (req, res) => {
    try {
        const diseno = await Diseno.getForEntregasDownload(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        if (!_canViewDiseno(diseno, role, userId)) {
            return res.status(403).json({ success: false, message: 'Sin permisos' });
        }

        const entregas = (diseno.entregas || []).filter(Boolean);
        if (!entregas.length) {
            return res.status(404).json({ success: false, message: 'No hay archivos de entrega' });
        }

        const existentes = entregas.filter(a =>
            fs.existsSync(path.join(__dirname, '..', 'uploads', 'disenos', 'entregas', a.filename))
        );

        if (!existentes.length) {
            return res.status(404).json({ success: false, message: 'No se encontraron archivos en el servidor' });
        }

        const safeName = diseno.nombre.replace(/[^a-zA-Z0-9_\- ]/g, '_');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_entregas.zip"`);

        const archive = archiver('zip', { zlib: { level: 0 } });
        archive.on('warning', err => { if (err.code !== 'ENOENT') console.error('Archiver warning:', err); });
        archive.on('error', err => {
            console.error('Archiver error:', err);
            if (!res.headersSent) res.status(500).end();
        });
        archive.pipe(res);

        existentes.forEach(archivo => {
            const filePath = path.join(__dirname, '..', 'uploads', 'disenos', 'entregas', archivo.filename);
            archive.file(filePath, { name: archivo.original_name });
        });

        archive.finalize();
    } catch (err) {
        console.error('Error al generar zip de entregas:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Error al generar descarga' });
        }
    }
};

const setFechaEstimada = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { id: userId } = req.user;

        if (diseno.disenador_id !== userId) {
            return res.status(403).json({ success: false, message: 'Solo el diseñador asignado puede establecer la fecha estimada' });
        }

        const { fecha_estimada } = req.body;
        await Diseno.setFechaEstimada(req.params.id, fecha_estimada || null);
        const updated = await Diseno.getById(req.params.id);
        res.json({ success: true, message: 'Fecha estimada actualizada', data: updated });
    } catch (err) {
        console.error('Error al establecer fecha estimada:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const markCompleted = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        const canComplete =
            role === 'admin' ||
            diseno.disenador_id === userId;

        if (!canComplete) {
            return res.status(403).json({ success: false, message: 'Solo el diseñador asignado puede completar esta solicitud' });
        }

        if (diseno.estado === 'completado') {
            return res.status(400).json({ success: false, message: 'El diseño ya está completado' });
        }

        if (!['en_progreso', 'en_espera', 'devuelto'].includes(diseno.estado)) {
            return res.status(400).json({ success: false, message: 'El diseño debe estar en progreso o devuelto para poder completarlo' });
        }

        await Diseno.markCompleted(req.params.id);
        const updated = await Diseno.getById(req.params.id);
        res.json({ success: true, message: 'Diseño marcado como completado', data: updated });
    } catch (err) {
        console.error('Error al completar diseño:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const returnDiseno = async (req, res) => {
    const uploadedFiles = req.files ? req.files.map(f => f.filename) : [];
    try {
        const { nota } = req.body;
        if (!nota || !nota.trim()) {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(400).json({ success: false, message: 'Debes escribir una nota explicando la devolución' });
        }

        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        if (diseno.estado !== 'completado') {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(400).json({ success: false, message: 'Solo puedes devolver un diseño que esté completado' });
        }

        const { role, id: userId } = req.user;
        const canReturn =
            role === 'admin' ||
            diseno.solicitante_id === userId;

        if (!canReturn) {
            uploadedFiles.forEach(f => _deleteFile('disenos', f));
            return res.status(403).json({ success: false, message: 'Solo el solicitante puede devolver este diseño' });
        }

        let oldImageFiles = [];
        if (uploadedFiles.length > 0) {
            oldImageFiles = await Diseno.replaceImagenes(req.params.id, uploadedFiles);
        }

        const count = await Diseno.countDevoluciones(req.params.id);
        await Diseno.returnDiseno(req.params.id, nota.trim());
        await Diseno.createDevolucion(req.params.id, nota.trim(), userId, count + 1);

        oldImageFiles.forEach(f => _deleteFile('disenos', f));

        const updated = await Diseno.getById(req.params.id);
        res.json({ success: true, message: 'Diseño devuelto al diseñador', data: updated });
    } catch (err) {
        uploadedFiles.forEach(f => _deleteFile('disenos', f));
        console.error('Error al devolver diseño:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const toggleEspera = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { id: userId } = req.user;
        if (diseno.disenador_id !== userId) {
            return res.status(403).json({ success: false, message: 'Solo el diseñador asignado puede pausar esta solicitud' });
        }

        if (!['en_progreso', 'en_espera'].includes(diseno.estado)) {
            return res.status(400).json({ success: false, message: 'Solo se pueden pausar diseños en progreso' });
        }

        const newEstado = await Diseno.toggleEspera(diseno.id, diseno.estado);
        const updated = await Diseno.getById(diseno.id);
        const msg = newEstado === 'en_espera' ? 'Solicitud pausada' : 'Solicitud reanudada';
        res.json({ success: true, message: msg, data: updated });
    } catch (err) {
        console.error('Error al cambiar estado de espera:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const getDevoluciones = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        if (!_canViewDiseno(diseno, role, userId)) {
            return res.status(403).json({ success: false, message: 'Sin permisos para ver este diseño' });
        }

        const devoluciones = await Diseno.getDevoluciones(req.params.id);
        res.json({ success: true, data: devoluciones, total: devoluciones.length });
    } catch (err) {
        console.error('Error al obtener historial de devoluciones:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const replaceEntregas = async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ success: false, message: 'Debes adjuntar al menos un archivo' });
        }

        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        const canUpload =
            role === 'admin' ||
            diseno.disenador_id === userId;

        if (!canUpload) {
            uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
            return res.status(403).json({ success: false, message: 'Solo el diseñador asignado puede reemplazar los archivos de entrega' });
        }

        if (diseno.estado === 'pendiente') {
            uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
            return res.status(400).json({ success: false, message: 'El diseño aún no está en progreso' });
        }

        const oldFiles = await Diseno.replaceEntregas(diseno.id, uploadedFiles.map(f => ({
            filename: f.filename,
            original_name: f.originalname,
            mimetype: f.mimetype,
            size: f.size
        })));

        oldFiles.forEach(f => _deleteFile('disenos/entregas', f));

        const updated = await Diseno.getById(diseno.id);
        res.json({ success: true, message: 'Archivos de entrega reemplazados correctamente', data: updated });
    } catch (err) {
        uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
        console.error('Error al reemplazar entregas:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const deleteImagen = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const filename = await Diseno.deleteImagen(req.params.imagenId);
        if (!filename) {
            return res.status(404).json({ success: false, message: 'Imagen no encontrada' });
        }

        _deleteFile('disenos', filename);
        res.json({ success: true, message: 'Imagen eliminada' });
    } catch (err) {
        console.error('Error al eliminar imagen:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const uploadEntrega = async (req, res) => {
    const uploadedFiles = req.files || [];
    try {
        if (uploadedFiles.length === 0) {
            return res.status(400).json({ success: false, message: 'Debes adjuntar al menos un archivo' });
        }

        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        const canUpload =
            role === 'admin' ||
            diseno.disenador_id === userId;

        if (!canUpload) {
            uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
            return res.status(403).json({ success: false, message: 'Solo el diseñador asignado puede enviar archivos de entrega' });
        }

        if (diseno.estado === 'pendiente') {
            uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
            return res.status(400).json({ success: false, message: 'El diseño aún no está en progreso' });
        }

        await Diseno.addEntregas(diseno.id, uploadedFiles.map(f => ({
            filename: f.filename,
            original_name: f.originalname,
            mimetype: f.mimetype,
            size: f.size
        })));

        const updated = await Diseno.getById(diseno.id);
        res.json({ success: true, message: 'Archivos de entrega subidos correctamente', data: updated });
    } catch (err) {
        uploadedFiles.forEach(f => _deleteFile('disenos/entregas', f.filename));
        console.error('Error al subir entrega:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const deleteEntrega = async (req, res) => {
    try {
        const diseno = await Diseno.getById(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        const canDelete =
            role === 'admin' ||
            diseno.disenador_id === userId;

        if (!canDelete) {
            return res.status(403).json({ success: false, message: 'Sin permisos para eliminar este archivo' });
        }

        const filename = await Diseno.deleteEntrega(req.params.archivoId);
        if (!filename) {
            return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
        }

        _deleteFile('disenos/entregas', filename);
        res.json({ success: true, message: 'Archivo eliminado' });
    } catch (err) {
        console.error('Error al eliminar entrega:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

const downloadImagenes = async (req, res) => {
    try {
        const diseno = await Diseno.getForDownload(req.params.id);
        if (!diseno) {
            return res.status(404).json({ success: false, message: 'Diseño no encontrado' });
        }

        const { role, id: userId } = req.user;
        if (!_canViewDiseno(diseno, role, userId)) {
            return res.status(403).json({ success: false, message: 'Sin permisos' });
        }

        const imagenes = (diseno.imagenes || []).filter(Boolean);
        if (!imagenes.length) {
            return res.status(404).json({ success: false, message: 'No hay archivos de referencia' });
        }

        const existentes = imagenes.filter(img =>
            fs.existsSync(path.join(__dirname, '..', 'uploads', 'disenos', img.filename))
        );

        if (!existentes.length) {
            return res.status(404).json({ success: false, message: 'No se encontraron archivos en el servidor' });
        }

        const safeName = diseno.nombre.replace(/[^a-zA-Z0-9_\- ]/g, '_');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}_referencias.zip"`);

        const archive = archiver('zip', { zlib: { level: 0 } });

        archive.on('warning', err => { if (err.code !== 'ENOENT') console.error('Archiver warning:', err); });
        archive.on('error', err => {
            console.error('Archiver error:', err);
            if (!res.headersSent) res.status(500).end();
        });

        archive.pipe(res);

        existentes.forEach(img => {
            const filePath = path.join(__dirname, '..', 'uploads', 'disenos', img.filename);
            const cleanName = img.filename.replace(/^\d+_\d+_/, '');
            archive.file(filePath, { name: cleanName });
        });

        archive.finalize();
    } catch (err) {
        console.error('Error al generar zip:', err);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Error al generar descarga' });
        }
    }
};

const getDisenadores = async (req, res) => {
    try {
        const disenadores = await Diseno.getDisenadores();
        res.json({ success: true, data: disenadores });
    } catch (err) {
        console.error('Error al obtener diseñadores:', err);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
};

function _canViewDiseno(diseno, role, userId) {
    // Diseños creados por un diseñador para sí mismo: solo él puede verlos
    if (diseno.solicitante_role === 'disenador') {
        return diseno.disenador_id === userId;
    }
    // Admin ve cualquier diseño; los demás solo los suyos (como solicitante o diseñador asignado)
    return (
        role === 'admin' ||
        diseno.solicitante_id === userId ||
        diseno.disenador_id === userId
    );
}

function _deleteFile(folder, filename) {
    const filePath = path.join(__dirname, '..', 'uploads', folder, filename);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

module.exports = {
    getDisenos,
    getDisenoById,
    createDiseno,
    updateDiseno,
    deleteDiseno,
    assignDesigner,
    markCompleted,
    returnDiseno,
    deleteImagen,
    getDisenadores,
    uploadEntrega,
    deleteEntrega,
    replaceEntregas,
    toggleEspera,
    getDevoluciones,
    setFechaEstimada,
    downloadImagenes,
    downloadEntregas
};
