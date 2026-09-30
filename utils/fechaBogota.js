// Colombia es UTC-5 todo el año, sin horario de verano.
const OFFSET_BOGOTA_MINUTOS = 5 * 60;

function normalizarFecha(fecha) {
    return fecha instanceof Date ? fecha.toISOString().slice(0, 10) : fecha;
}

// Fecha laboral (America/Bogota) correspondiente a un instante UTC. Nunca usar CURDATE().
function fechaLaboral(instante) {
    const desplazado = new Date(instante.getTime() - OFFSET_BOGOTA_MINUTOS * 60 * 1000);
    const anio = desplazado.getUTCFullYear();
    const mes = String(desplazado.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(desplazado.getUTCDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
}

// Combina una fecha (DATE) con una hora local de Bogotá (TIME) en el instante UTC comparable.
function combinarFechaHora(fecha, hora) {
    const comoSiFueraUTC = new Date(`${normalizarFecha(fecha)}T${hora}Z`);
    return new Date(comoSiFueraUTC.getTime() + OFFSET_BOGOTA_MINUTOS * 60 * 1000);
}

module.exports = { fechaLaboral, combinarFechaHora };
