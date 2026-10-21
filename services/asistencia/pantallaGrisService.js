const bcrypt = require('bcryptjs');
const config = require('../../config/integracionAsislock');
const usuarioRepo = require('../../repositories/asistencia/usuarioPantallaGrisRepository');
const envioRepo = require('../../repositories/asistencia/asislockEnvioRepository');
const { pantallaGris } = require('../../domain/asistencia');

// Usuarios de la pantalla gris de AsisLock (asistencia.md §31). Son credenciales propias,
// distintas de la cuenta por cédula del portal (cuenta_empleado). Gestor es el dueño: los crea
// al registrar al empleado, avisa a AsisLock por el outbox y valida cada inicio de sesión.

const RONDAS_BCRYPT = 10;

// Con un usuario inexistente se compara igual contra un hash cualquiera, para que el tiempo de
// respuesta no delate qué cédulas existen.
let hashSenuelo = null;
const senuelo = () => (hashSenuelo ??= bcrypt.hashSync('pantalla-gris-senuelo', RONDAS_BCRYPT));

async function encolarAviso(conn, evento, { usersCompanyId, usuario, nombre }) {
    await envioRepo.insertar({
        evento,
        usersCompanyId,
        usuario,
        payload: pantallaGris.cuerpoAviso(evento, { usuario, nombre, usersCompanyId }, new Date())
    }, conn);
}

/**
 * Crea el usuario de una ficha (usuario y clave inicial = cédula) y encola el aviso de alta,
 * dentro de la transacción de quien llama. No lanza por reglas de negocio: devuelve el motivo,
 * para que el alta del empleado nunca se caiga por esto.
 */
async function crearEnConexion(conn, { usersCompanyId, cedula, nombre }) {
    const usuario = String(cedula ?? '').trim();
    if (!usuario) return { creado: false, motivo: 'sin_cedula' };

    const conflicto = await usuarioRepo.findConflicto(usersCompanyId, usuario, conn);
    if (conflicto) return { creado: false, motivo: conflicto };

    const hash = await bcrypt.hash(usuario, RONDAS_BCRYPT);
    const id = await usuarioRepo.insertar({ usersCompanyId, usuario, hash }, conn);
    await encolarAviso(conn, 'alta', { usersCompanyId, usuario, nombre });
    return { creado: true, id, usuario };
}

/**
 * Encola un aviso de baja o reactivación para la ficha, si tiene usuario. Va en la transacción
 * del retiro, de su reversión o del borrado de la ficha.
 */
async function avisarEnConexion(conn, usersCompanyId, evento) {
    const usuario = await usuarioRepo.findPorFicha(usersCompanyId, conn);
    if (!usuario) return false;
    await encolarAviso(conn, evento, { usersCompanyId, usuario: usuario.usuario, nombre: usuario.nombre });
    return true;
}

/** Borra el usuario de una ficha que se elimina, con su aviso de baja. */
async function eliminarEnConexion(conn, usersCompanyId) {
    if (await avisarEnConexion(conn, usersCompanyId, 'baja')) await usuarioRepo.borrarPorFicha(usersCompanyId, conn);
}

/** Compara la clave y aplica el conteo de intentos fallidos y el bloqueo. */
async function comprobar(usuarioTexto, clave) {
    const usuario = await usuarioRepo.findPorUsuario(String(usuarioTexto).trim());
    const claveCorrecta = await bcrypt.compare(String(clave), usuario?.password ?? senuelo());
    const decision = pantallaGris.decidirValidacion({ usuario, claveCorrecta, ahora: new Date() });

    if (decision.contarFallo) await usuarioRepo.registrarFallo(usuario.idusuario_pantalla_gris, config.pantallaGris);
    return { usuario, decision };
}

function datosUsuario(usuario) {
    return {
        usuario: usuario.usuario,
        nombre: usuario.nombre,
        users_company_id: usuario.users_company_id,
        debe_cambiar_clave: Boolean(usuario.debe_cambiar_password)
    };
}

async function validar({ usuario: usuarioTexto, clave }) {
    const { usuario, decision } = await comprobar(usuarioTexto, clave);
    if (decision.reiniciarFallos) {
        await usuarioRepo.reiniciarFallos(usuario.idusuario_pantalla_gris, { ingreso: decision.valido });
    }
    if (!decision.valido) return { success: true, valido: false, motivo: decision.motivo };
    return { success: true, valido: true, usuario: datosUsuario(usuario) };
}

async function cambiarClave({ usuario: usuarioTexto, claveActual, claveNueva }) {
    const { usuario, decision } = await comprobar(usuarioTexto, claveActual);
    if (!decision.valido) {
        if (decision.reiniciarFallos) await usuarioRepo.reiniciarFallos(usuario.idusuario_pantalla_gris, { ingreso: false });
        return { success: true, cambiada: false, motivo: decision.motivo };
    }

    const motivo = pantallaGris.motivoClaveNuevaInvalida(claveNueva, { usuario: usuario.usuario, claveActual }, config.pantallaGris);
    if (motivo) return { success: true, cambiada: false, motivo };

    await usuarioRepo.cambiarPassword(usuario.idusuario_pantalla_gris, await bcrypt.hash(claveNueva, RONDAS_BCRYPT));
    return { success: true, cambiada: true, usuario: { ...datosUsuario(usuario), debe_cambiar_clave: false } };
}

/** Lista completa para que AsisLock se sincronice (p. ej. la primera vez o tras una caída). */
async function listarUsuarios() {
    const filas = await usuarioRepo.listar();
    return {
        success: true,
        total: filas.length,
        usuarios: filas.map((f) => ({
            usuario: f.usuario,
            nombre: f.nombre,
            users_company_id: f.users_company_id,
            activo: pantallaGris.contratoVigente(f.estado_contrato),
            debe_cambiar_clave: Boolean(f.debe_cambiar_password),
            actualizado_en: f.actualizado_en
        }))
    };
}

module.exports = { crearEnConexion, avisarEnConexion, eliminarEnConexion, validar, cambiarClave, listarUsuarios };
