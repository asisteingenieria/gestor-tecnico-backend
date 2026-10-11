const { createHash } = require('node:crypto');
const { SECCIONES, obtenerSeccion, seccionDeRuta } = require('./secciones');
const { obtener, estaVacio } = require('./rutas');

// Valor canónico para el hash: vacío → null y todo escalar → string recortado, de modo
// que 5 y "5" (número del formulario vs. string del JSON guardado) no invaliden una
// verificación sin que nada haya cambiado de verdad.
function canonico(valor) {
    if (estaVacio(valor)) return null;
    return String(valor).trim();
}

// SHA-256 del contenido de una sección. Solo entra lo que la sección declara, en su
// orden: claves ajenas en `datos_empleado` no la afectan.
function hashSeccion(datosEmpleado, clave) {
    const seccion = obtenerSeccion(clave);
    if (!seccion) throw new Error(`Sección desconocida: ${clave}`);
    const pares = seccion.campos.map((c) => [c.ruta, canonico(obtener(datosEmpleado, c.ruta))]);
    return createHash('sha256').update(JSON.stringify(pares)).digest('hex');
}

function problemasDeSeccion(seccion, datosEmpleado, contexto) {
    const problemas = [];

    for (const campo of seccion.campos) {
        const valor = obtener(datosEmpleado, campo.ruta);
        if (estaVacio(valor)) {
            if (campo.requerido) problemas.push({ ruta: campo.ruta, mensaje: `${campo.etiqueta} es obligatorio` });
            continue;
        }
        const error = campo.validar ? campo.validar(valor) : null;
        if (error) problemas.push({ ruta: campo.ruta, mensaje: error });
    }

    for (const grupo of seccion.grupos) {
        const llenos = grupo.rutas.filter((r) => !estaVacio(obtener(datosEmpleado, r)));
        if (llenos.length > 0 && llenos.length < grupo.rutas.length) {
            for (const ruta of grupo.rutas.filter((r) => !llenos.includes(r))) {
                const etiqueta = seccion.campos.find((c) => c.ruta === ruta).etiqueta;
                problemas.push({
                    ruta,
                    mensaje: `${grupo.etiqueta} incompleta: falta ${etiqueta} (o deja todo el bloque vacío)`
                });
            }
        }
    }

    // Un valor que Hydra envió y no se pudo traducir a un ID de Gestor bloquea mientras
    // el campo siga vacío. Si RRHH elige el valor a mano, deja de bloquear.
    for (const item of contexto.sinMapear) {
        if (seccionDeRuta(item.ruta) !== seccion.clave) continue;
        if (!estaVacio(obtener(datosEmpleado, item.ruta))) continue;
        problemas.push({
            ruta: item.ruta,
            mensaje: `El valor "${item.valorHydra}" que envió Hydra para ${item.catalogo} no existe en Gestor: elige uno`
        });
    }

    if (seccion.clave === 'personal' && contexto.reintegroPendiente) {
        problemas.push({
            ruta: 'numero_identificacion',
            mensaje: 'Esta identificación ya existe como empleado (reintegro): descarta al candidato y gestiónalo desde Retiro → Reactivar'
        });
    }

    return problemas;
}

/**
 * Estado del checklist de un candidato.
 *
 * @param {object} datosEmpleado  borrador con la forma del body de POST /users-company
 * @param {Array<{seccion: string, hash_contenido: string}>} verificaciones  filas de hydra_candidato_verificacion
 * @param {{sinMapear?: Array<{ruta, catalogo, valorHydra}>, reintegroPendiente?: boolean}} [contexto]
 * @returns {{ secciones: Object<string, {completa, verificada, vigente, problemas}>, listo: boolean }}
 *   - completa:  no tiene problemas (se puede marcar el checkbox)
 *   - verificada: tiene checkbox marcado (aunque esté desactualizado)
 *   - vigente:   está marcada y nada cambió desde entonces
 */
function evaluarCompletitud(datosEmpleado, verificaciones = [], contexto = {}) {
    const ctx = { sinMapear: contexto.sinMapear ?? [], reintegroPendiente: Boolean(contexto.reintegroPendiente) };
    const hashPorSeccion = new Map(verificaciones.map((v) => [v.seccion, v.hash_contenido]));

    const secciones = {};
    for (const seccion of SECCIONES) {
        const problemas = problemasDeSeccion(seccion, datosEmpleado, ctx);
        const hashGuardado = hashPorSeccion.get(seccion.clave);
        const verificada = hashGuardado !== undefined;
        secciones[seccion.clave] = {
            completa: problemas.length === 0,
            verificada,
            vigente: verificada && hashGuardado === hashSeccion(datosEmpleado, seccion.clave),
            problemas
        };
    }

    const listo = Object.values(secciones).every((s) => s.completa && s.vigente);
    return { secciones, listo };
}

module.exports = { hashSeccion, evaluarCompletitud };
