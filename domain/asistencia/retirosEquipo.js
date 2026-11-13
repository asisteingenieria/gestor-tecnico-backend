// Retiros del equipo para la Red Maestra de Claro (asistencia.md §59, migración 102). Puro: sin E/S y
// con la fecha de hoy recibida como parámetro.
//
// Cuando RRHH retira a alguien de Claro, sus jefes del contrato retirado —jefe inmediato (coordinador),
// jefe de área y gestor de asistencia— deben registrar la fecha en que lo retiraron de la Red Maestra.
// Hasta que no la registren, el retiro queda "pendiente" y el portal les muestra la alerta.

function textoFecha(valor) {
    if (!valor) return null;
    return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

/** Fila del repositorio → lo que ve el jefe. */
function presentarRetiro(fila) {
    const registradoPor = fila.retiro_rm_por_ficha || fila.retiro_rm_por_usuario || null;
    return {
        empleado_id: fila.empleado_id,
        empleado: fila.empleado_nombre,
        cedula: fila.empleado_identificacion,
        cargo: fila.cargo,
        campania: fila.campania,
        centro_costo: fila.centro_costo,
        jefe_inmediato: fila.jefe_inmediato,
        fecha_ingreso: textoFecha(fila.fecha_ingreso),
        fecha_retiro: textoFecha(fila.fecha_retiro),
        tipo_retiro: fila.tipo_retiro,
        estado_rm: fila.estado_rm || null,
        fecha_retiro_rm: textoFecha(fila.fecha_retiro_rm),
        retiro_rm_registrado_por: registradoPor,
        retiro_rm_registrado_en: fila.retiro_rm_registrado_en || null,
        pendiente: !fila.fecha_retiro_rm
    };
}

/**
 * Fichas a las que se avisa de un retiro: el jefe de área y el gestor de asistencia del contrato retirado, sin repetir,
 * sin vacíos y sin el propio retirado (un jefe que se retira no se avisa a sí mismo).
 */
// Desde §61 no se avisa al jefe inmediato (coordinador): el retiro en la Red Maestra lo registran los jefes
// que gestionan el equipo, no el coordinador. Si el coordinador además es el gestor, entra como gestor.
function destinatariosAvisoRetiro({ empleadoId, jefeAreaId, gestorAsistenciaId }) {
    return [...new Set([jefeAreaId, gestorAsistenciaId])]
        .filter((id) => id && id !== empleadoId);
}

/** Texto del aviso de la campana (notificacion_asistencia.mensaje es VARCHAR(255)). */
function mensajeAvisoRetiro({ nombre, fechaRetiro }) {
    const fecha = textoFecha(fechaRetiro);
    const texto = `RRHH retiró a ${nombre || 'un empleado'}${fecha ? ` (retiro ${fecha})` : ''}. Registra su retiro en la Red Maestra.`;
    return texto.length > 255 ? `${texto.slice(0, 252)}...` : texto;
}

/** La fecha del retiro en la Red Maestra no puede ser futura ni anterior al ingreso. Devuelve el error o null. */
function errorFechaRetiroRm(fecha, { hoy, fechaIngreso }) {
    if (!fecha) return null;
    if (fecha > hoy) return 'La fecha de retiro en la Red Maestra no puede ser futura';
    const ingreso = textoFecha(fechaIngreso);
    if (ingreso && fecha < ingreso) return 'La fecha de retiro en la Red Maestra no puede ser anterior al ingreso';
    return null;
}

module.exports = { presentarRetiro, destinatariosAvisoRetiro, mensajeAvisoRetiro, errorFechaRetiroRm };
