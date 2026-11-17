const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const { asislock } = require('../../domain/asistencia');

// Fichas de RRHH para una cédula que llega de AsisLock (logins y consultas). Primero la cédula exacta;
// si no hay ninguna y es un número de 7 dígitos, el PPT con el prefijo 600 con el que lo guarda RRHH
// (6776237 → 6006776237), solo entre fichas tipo PPT (asistencia.md §69).
async function fichasPorCedula(cedula, conn) {
    if (!cedula) return [];
    const exactas = await empleadoRepo.findPorNumeroIdentificacion(cedula, conn);
    if (exactas.length > 0) return exactas;
    const ppt = asislock.cedulaPptConPrefijo(cedula);
    return ppt ? empleadoRepo.findPptPorNumero(ppt, conn) : [];
}

module.exports = { fichasPorCedula };
