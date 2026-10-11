const { obtenerSeccion } = require('./secciones');
const { obtener, asignar, estaVacio } = require('./rutas');

// Edición de una sección del borrador por parte de RRHH (conexionhydra.md §8).
//
// El cuerpo trae la sección con la misma forma anidada de `datos_empleado`
// (p. ej. `{ contrato: { campania_id: 5 } }`). Solo se aplican las rutas que la sección
// declara; cualquier otra clave se ignora, de modo que guardar "salario" nunca puede
// tocar el contrato. Una ruta ausente del cuerpo no se modifica (actualización parcial);
// una ruta presente con '' o null se vacía.

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const BOOLEANAS = ['contrato.aplica_dotacion', 'declarante_renta'];
const NUMERICAS = ['salario.salario', 'salario.bono_no_prestacional', 'salario.bono_cafeteria', 'seguridad_social.tarifa_arl', 'numero_hijos'];
const LARGO_MAXIMO_TEXTO = 255;
// El borrador se guarda tal cual en una columna JSON y luego va completo a UserCompany:
// un número mal formado o un ID de texto fallaría recién al registrar el lote, dentro
// de la transacción de todos. Se rechaza aquí, campo por campo.

// El tipo se deduce de la convención de nombres del esquema (todo FK termina en `_id`,
// toda fecha empieza por `fecha`), en vez de duplicar un tipo por cada uno de los ~70
// campos de secciones.js.
function tipoDeCampo(ruta) {
    const campo = ruta.split('.').pop();
    if (BOOLEANAS.includes(ruta)) return 'booleano';
    if (NUMERICAS.includes(ruta)) return 'numero';
    if (campo.endsWith('_id')) return 'id';
    if (campo.startsWith('fecha') || campo.endsWith('_fecha_afiliacion')) return 'fecha';
    return 'texto';
}

function fechaReal(valor) {
    if (typeof valor !== 'string' || !FECHA.test(valor)) return false;
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
}

// Devuelve { valor, error }: el valor ya normalizado al tipo que espera UserCompany.
function normalizarValor(ruta, crudo) {
    if (estaVacio(crudo)) return { valor: null };

    switch (tipoDeCampo(ruta)) {
        case 'id': {
            const n = Number(crudo);
            return Number.isInteger(n) && n > 0 ? { valor: n } : { error: 'debe ser un ID válido' };
        }
        case 'numero': {
            const n = Number(crudo);
            return Number.isFinite(n) && n >= 0 ? { valor: n } : { error: 'debe ser un número mayor o igual a cero' };
        }
        case 'fecha':
            return fechaReal(crudo) ? { valor: crudo } : { error: 'debe ser una fecha YYYY-MM-DD válida' };
        case 'booleano':
            return typeof crudo === 'boolean' ? { valor: crudo } : { error: 'debe ser verdadero o falso' };
        default: {
            if (typeof crudo !== 'string' && typeof crudo !== 'number') return { error: 'debe ser texto' };
            const texto = String(crudo).trim();
            return texto.length > LARGO_MAXIMO_TEXTO
                ? { error: `supera ${LARGO_MAXIMO_TEXTO} caracteres` }
                : { valor: texto };
        }
    }
}

/**
 * @param {object} datosEmpleado borrador actual
 * @param {string} clave         sección a editar
 * @param {object} cambios       cuerpo con la forma anidada de datos_empleado
 * @returns {{ datos: object, errores: string[], aplicados: string[] }}
 *   `datos` es una copia; la entrada no se muta. Si hay errores, `datos` no debe guardarse.
 */
function aplicarCambiosSeccion(datosEmpleado, clave, cambios) {
    const seccion = obtenerSeccion(clave);
    if (!seccion) throw new Error(`Sección desconocida: ${clave}`);

    const datos = structuredClone(datosEmpleado);
    const errores = [];
    const aplicados = [];

    for (const campo of seccion.campos) {
        const crudo = obtener(cambios, campo.ruta);
        if (crudo === undefined) continue;
        const { valor, error } = normalizarValor(campo.ruta, crudo);
        if (error) {
            errores.push(`${campo.etiqueta} ${error}`);
            continue;
        }
        asignar(datos, campo.ruta, valor);
        aplicados.push(campo.ruta);
    }

    return { datos, errores, aplicados };
}

module.exports = { aplicarCambiosSeccion, tipoDeCampo };
