// Restablecer la contraseña de una cuenta desde el panel del admin (/users).
//
// Dos modos:
//   - 'cedula': la contraseña vuelve a ser la cédula de la ficha de RRHH (la clave por defecto
//     de las cuentas por cédula, asistencia.md §19/§24). Solo si la cuenta tiene cédula.
//   - 'temporal': el admin escribe una contraseña temporal (mínimo 6 caracteres).
// En los dos casos la cuenta queda con `debe_cambiar_password = 1`: al ingresar, el frontend la
// lleva a /cambiar-password y verifyToken bloquea el resto de la API hasta que la cambie.

const MIN_LONGITUD = 6;

const limpiarCedula = (cedula) => String(cedula ?? '').trim();

/**
 * Decide la contraseña nueva. Devuelve `{ password }` o `{ error }` con un mensaje para el admin.
 * @param {{ modo?: string, password?: string, cedula?: string|number|null }} datos
 */
function claveRestablecida({ modo, password, cedula } = {}) {
    if (modo === 'cedula') {
        const c = limpiarCedula(cedula);
        if (!c) return { error: 'Esta cuenta no tiene cédula registrada: escribe una contraseña temporal.' };
        if (c.length < MIN_LONGITUD) return { error: `La cédula tiene menos de ${MIN_LONGITUD} caracteres: escribe una contraseña temporal.` };
        return { password: c };
    }
    if (modo === 'temporal') {
        const p = typeof password === 'string' ? password : '';
        if (p.trim().length < MIN_LONGITUD) return { error: `La contraseña temporal debe tener al menos ${MIN_LONGITUD} caracteres.` };
        if (p !== p.trim()) return { error: 'La contraseña temporal no puede empezar ni terminar con espacios.' };
        return { password: p };
    }
    return { error: "Modo no válido: usa 'cedula' o 'temporal'." };
}

module.exports = { claveRestablecida, MIN_LONGITUD };
