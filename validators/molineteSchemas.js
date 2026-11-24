const config = require('../config/integracionMolinete');

// Validación estructural del envío del intermediario del molinete (asistencia.md §80). Cada
// marcación trae las columnas de acc_transaction tal como las lee molineteOrigenRepository.findDesde
// (fechas como texto en hora de Bogotá, sin zona). Si la forma es incorrecta se rechaza el envío
// completo (400); la cédula y la hora se evalúan marcación por marcación en el servicio.

const FECHA_HORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/;
const esTextoOpcional = (v, max) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const esTextoONumero = (v, max) => (typeof v === 'string' && v.trim().length > 0 && v.length <= max) || Number.isInteger(v);

function validarMarcacion(m, i) {
    const p = `marcaciones[${i}]`;
    if (m === null || typeof m !== 'object' || Array.isArray(m)) return [`${p} debe ser un objeto`];

    const errores = [];
    if (!esTextoONumero(m.unique_key, 100)) errores.push(`${p}.unique_key es requerido (acc_transaction.unique_key)`);
    if (typeof m.event_time !== 'string' || !FECHA_HORA.test(m.event_time)) errores.push(`${p}.event_time debe ser "YYYY-MM-DD HH:MM:SS" (hora de Bogotá)`);
    if (typeof m.create_time !== 'string' || !FECHA_HORA.test(m.create_time)) errores.push(`${p}.create_time debe ser "YYYY-MM-DD HH:MM:SS.mmm" (hora de Bogotá)`);
    if (!(esTextoOpcional(m.cedula, 100) || Number.isInteger(m.cedula))) errores.push(`${p}.cedula debe ser texto o null`);
    if (!(esTextoOpcional(m.pin, 100) || Number.isInteger(m.pin))) errores.push(`${p}.pin debe ser texto o null`);
    if (!esTextoOpcional(m.departamento, 100)) errores.push(`${p}.departamento debe ser texto o null`);
    if (!esTextoOpcional(m.lector, 100)) errores.push(`${p}.lector debe ser texto o null`);
    return errores;
}

function validarEnvioMolinete(body) {
    if (!body || !Array.isArray(body.marcaciones)) return ['El cuerpo debe ser { "marcaciones": [ ... ] }'];
    if (body.marcaciones.length === 0) return ['marcaciones no puede estar vacío'];
    if (body.marcaciones.length > config.maxMarcacionesPorEnvio) {
        return [`marcaciones admite como máximo ${config.maxMarcacionesPorEnvio} elementos por envío`];
    }
    const errores = body.marcaciones.flatMap(validarMarcacion);
    return errores.slice(0, 50);
}

module.exports = { validarEnvioMolinete };
