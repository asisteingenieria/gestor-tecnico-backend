// Reglas de los usuarios de la pantalla gris de AsisLock (asistencia.md §31, migración 071).
// Puro: el instante actual y la política llegan como parámetros.

const ESTADOS_SIN_ACCESO = ['retirado', 'inactivo'];

/** Una ficha sin contrato o con el último contrato retirado/inactivo no entra a la pantalla gris. */
function contratoVigente(estadoContrato) {
    return Boolean(estadoContrato) && !ESTADOS_SIN_ACCESO.includes(estadoContrato);
}

function estaBloqueado(bloqueadoHasta, ahora) {
    return Boolean(bloqueadoHasta) && new Date(bloqueadoHasta).getTime() > ahora.getTime();
}

/**
 * Qué responder a un intento de inicio de sesión, una vez comparada la clave.
 * `usuario` es la fila de usuario_pantalla_gris (o null si no existe).
 * @returns {{ valido: boolean, motivo: string|null, contarFallo: boolean, reiniciarFallos: boolean }}
 */
function decidirValidacion({ usuario, claveCorrecta, ahora }) {
    // Usuario inexistente y clave errada responden igual, para no revelar qué cédulas existen.
    if (!usuario) return { valido: false, motivo: 'credenciales_invalidas', contarFallo: false, reiniciarFallos: false };
    if (estaBloqueado(usuario.bloqueado_hasta, ahora)) {
        return { valido: false, motivo: 'bloqueado', contarFallo: false, reiniciarFallos: false };
    }
    if (!claveCorrecta) return { valido: false, motivo: 'credenciales_invalidas', contarFallo: true, reiniciarFallos: false };
    // Solo quien conoce la clave se entera de que está retirado.
    if (!contratoVigente(usuario.estado_contrato)) {
        return { valido: false, motivo: 'usuario_inactivo', contarFallo: false, reiniciarFallos: true };
    }
    return { valido: true, motivo: null, contarFallo: false, reiniciarFallos: true };
}

/** null si la clave nueva sirve; si no, el motivo. */
function motivoClaveNuevaInvalida(claveNueva, { usuario, claveActual }, politica) {
    if (typeof claveNueva !== 'string' || claveNueva.length < politica.largoMinimoClave) return 'clave_corta';
    if (claveNueva === String(usuario)) return 'clave_igual_usuario';
    if (claveNueva === claveActual) return 'clave_igual_actual';
    return null;
}

/** Cuerpo del aviso a AsisLock. Nunca lleva la clave. */
function cuerpoAviso(evento, { usuario, nombre, usersCompanyId }, ocurridoEn) {
    return {
        evento,
        usuario: String(usuario),
        nombre: nombre || null,
        users_company_id: usersCompanyId,
        activo: evento !== 'baja',
        ocurrido_en: ocurridoEn.toISOString()
    };
}

module.exports = { contratoVigente, estaBloqueado, decidirValidacion, motivoClaveNuevaInvalida, cuerpoAviso };
