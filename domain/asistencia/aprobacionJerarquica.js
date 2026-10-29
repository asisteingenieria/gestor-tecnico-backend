const { ReglaAsistenciaError } = require('../../errors/AppError');

// Horas extra y cambios de turno (asistencia.md §51): los solicita el jefe de operaciones —quien
// gestiona la asistencia del empleado— y los aprueba SU jefe, el director: quien gestiona la asistencia
// del jefe. Sin E/S: el servicio ya resolvió las fichas.
const LARGO_MENSAJE = 255;

const hhmm = (hora) => (hora ? String(hora).slice(0, 5) : '');
const ddmm = (fecha) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;

function formatearNombre(nombre) {
    return String(nombre || '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espacio, letra) => espacio + letra.toUpperCase()).trim();
}

function recortar(texto) {
    return texto.length <= LARGO_MENSAJE ? texto : `${texto.slice(0, LARGO_MENSAJE - 1)}…`;
}

// El aprobador es el gestor de quien solicita. Si no tiene, o es él mismo (la ficha se gestiona a sí
// misma), nadie podría aprobar y la solicitud quedaría colgada: se rechaza de entrada.
function assertAprobador(solicitanteId, aprobadorId) {
    if (!aprobadorId || aprobadorId === solicitanteId) {
        throw new ReglaAsistenciaError('No tienes en RRHH un jefe que apruebe tus solicitudes: pide que lo asignen en tu ficha');
    }
}

// "Ana Pérez" o "3 personas".
function paraQuien(nombres) {
    return nombres.length === 1 ? formatearNombre(nombres[0]) : `${nombres.length} personas`;
}

function franja(fecha, inicio, fin) {
    return `el ${ddmm(fecha)} de ${hhmm(inicio)} a ${hhmm(fin)}`;
}

const mensajesHoraExtra = {
    solicitada: (jefe, nombres, fecha, inicio, fin) => recortar(`${formatearNombre(jefe)} solicita horas extra para ${paraQuien(nombres)} ${franja(fecha, inicio, fin)}`),
    aprobada: (empleado, fecha, director) => recortar(`Las horas extra de ${formatearNombre(empleado)} del ${ddmm(fecha)} fueron aprobadas por ${formatearNombre(director)}`),
    rechazada: (empleado, fecha, director, motivo) => recortar(`Las horas extra de ${formatearNombre(empleado)} del ${ddmm(fecha)} fueron rechazadas por ${formatearNombre(director)}${motivo ? `. Motivo: ${motivo}` : ''}`),
    // Al empleado, cuando ya están aprobadas: desde ahí AsisLock le cuenta el tiempo extra en esa franja.
    paraEmpleado: (fecha, inicio, fin) => recortar(`Tienes horas extra aprobadas ${franja(fecha, inicio, fin)}`)
};

module.exports = { assertAprobador, mensajesHoraExtra, formatearNombre };
