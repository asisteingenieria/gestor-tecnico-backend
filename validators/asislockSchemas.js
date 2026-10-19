const config = require('../config/integracionAsislock');

// Validación estructural del envío de AsisLock (asistencia.md §18). Solo rechaza el envío
// completo (400) si la forma es incorrecta. El formato de fecha/hora y la cédula se evalúan
// registro por registro en el servicio, para que un dato malo no frene a los demás.

const esTextoOpcional = (v, max) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const esHora = (v) => v === undefined || v === null || v === '' || typeof v === 'string';

function validarRegistro(r, i) {
    const p = `registros[${i}]`;
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return [`${p} debe ser un objeto`];

    const errores = [];
    // id es opcional: sin él, Gestor identifica cada evento por cédula + fecha + hora.
    const sinId = r.id === undefined || r.id === null;
    if (!sinId && (!Number.isInteger(r.id) || r.id <= 0)) errores.push(`${p}.id, si se envía, debe ser un entero positivo (login_biometrico.id)`);

    const usuarioValido = (typeof r.usuario === 'string' && r.usuario.trim().length > 0 && r.usuario.length <= 20)
        || (Number.isInteger(r.usuario) && r.usuario > 0);
    if (!usuarioValido) errores.push(`${p}.usuario es requerido (cédula del empleado)`);

    if (typeof r.fecha !== 'string' || r.fecha.trim() === '' || r.fecha.length > 20) errores.push(`${p}.fecha es requerida (texto, p. ej. "2026-10-11")`);
    if (!esHora(r.hora_login)) errores.push(`${p}.hora_login debe ser texto "HH:MM:SS" o null`);
    if (!esHora(r.hora_logout)) errores.push(`${p}.hora_logout debe ser texto "HH:MM:SS" o null`);
    if (!r.hora_login && !r.hora_logout) errores.push(`${p} debe traer hora_login, hora_logout o ambas`);

    // VARCHAR(20) en login_biometrico de AsisLock; se acepta también como número.
    if (!(esTextoOpcional(r.estado_conexion, 20) || Number.isInteger(r.estado_conexion))) {
        errores.push(`${p}.estado_conexion debe ser texto de hasta 20 caracteres, número o null`);
    }
    if (!esTextoOpcional(r.ip_local, 50)) errores.push(`${p}.ip_local debe ser texto de hasta 50 caracteres`);
    if (!esTextoOpcional(r.ip_publica, 50)) errores.push(`${p}.ip_publica debe ser texto de hasta 50 caracteres`);
    if (!esTextoOpcional(r.aplicativo, 80)) errores.push(`${p}.aplicativo debe ser texto de hasta 80 caracteres`);
    if (!esTextoOpcional(r.conectado_biometrico, 15)) errores.push(`${p}.conectado_biometrico debe ser texto de hasta 15 caracteres`);
    return errores;
}

function validarEnvioAsislock(body) {
    if (!body || !Array.isArray(body.registros)) return ['El cuerpo debe ser { "registros": [ ... ] }'];
    if (body.registros.length === 0) return ['registros no puede estar vacío'];
    if (body.registros.length > config.maxRegistrosPorEnvio) {
        return [`registros admite como máximo ${config.maxRegistrosPorEnvio} elementos por envío`];
    }
    const errores = body.registros.flatMap(validarRegistro);
    if (errores.length > 0) return errores.slice(0, 50);

    const vistos = new Set();
    for (const r of body.registros) {
        if (r.id === undefined || r.id === null) continue;
        if (vistos.has(r.id)) return [`El registro id ${r.id} viene repetido en el mismo envío`];
        vistos.add(r.id);
    }
    return [];
}

module.exports = { validarEnvioAsislock };
