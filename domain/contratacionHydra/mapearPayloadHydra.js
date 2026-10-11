const { SECCIONES } = require('./secciones');
const { obtener, asignar, estaVacio } = require('./rutas');

// Traducción del payload de un candidato de Hydra (contrato en conexionhydra.md §5.1) al
// borrador `datos_empleado` (forma del body de POST /api/users-company).
//
// Puro: la resolución de catálogos llega inyectada como `resolverCatalogo(catalogo,
// valorHydra) → id | null`, que el servicio arma con hydra_mapeo_catalogo + nombres
// normalizados. Aquí no se toca la base.

// [ruta en el payload de Hydra, ruta en datos_empleado]
const CAMPOS_DIRECTOS = [
    ['identificacion.numero', 'numero_identificacion'],
    ['nombres.primer_nombre', 'primer_nombre'],
    ['nombres.segundo_nombre', 'segundo_nombre'],
    ['nombres.primer_apellido', 'primer_apellido'],
    ['nombres.segundo_apellido', 'segundo_apellido'],
    ['contacto.email', 'email'],
    ['contacto.celular', 'telefono'],
    ['personal.fecha_nacimiento', 'fecha_nacimiento'],
    ['direccion.direccion', 'direccion.direccion'],
    ['direccion.barrio', 'direccion.barrio'],
    ['contacto_emergencia.nombre', 'contacto_emergencia.nombre'],
    ['contacto_emergencia.telefono', 'contacto_emergencia.telefono'],
    ['dotacion.talla_camisa', 'dotacion.talla_camisa']
];

// [ruta en el payload de Hydra, catálogo (columna `catalogo` de hydra_mapeo_catalogo), ruta en datos_empleado]
// El cliente de Hydra NO se mapea: Gestor necesita una campaña, y un cliente puede tener
// varias. Viaja en datos_hydra como referencia y RRHH elige la campaña.
const CAMPOS_CATALOGO = [
    ['identificacion.tipo', 'tipo_identificacion', 'tipo_identificacion_id'],
    ['personal.genero', 'genero', 'genero_id'],
    ['personal.estado_civil', 'estado_civil', 'estado_civil_id'],
    ['personal.grupo_sanguineo', 'grupo_sanguineo', 'grupo_sanguineo_id'],
    ['seguridad_social.eps', 'eps', 'seguridad_social.eps_id'],
    ['seguridad_social.afp', 'afp', 'seguridad_social.afp_id'],
    ['contacto_emergencia.parentesco', 'parentesco', 'contacto_emergencia.parentesco_id'],
    ['proceso.cargo', 'cargo', 'contrato.cargo_id']
];

// Hydra solo captura la dirección de residencia.
const TIPO_DIRECCION_HYDRA = 'residencia';

const CATALOGOS = [...new Set([...CAMPOS_CATALOGO.map(([, catalogo]) => catalogo), 'tipo_direccion'])];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function limpiar(valor) {
    if (estaVacio(valor)) return null;
    return typeof valor === 'string' ? valor.trim() : valor;
}

// Borrador vacío con todas las rutas que declaran las secciones, para que el frontend
// reciba siempre la misma forma.
function datosEmpleadoVacio() {
    const datos = {};
    for (const seccion of SECCIONES) {
        for (const campo of seccion.campos) asignar(datos, campo.ruta, null);
    }
    datos.declarante_renta = false;
    return datos;
}

/**
 * @param {object} candidato  un elemento de `candidatos[]` del payload de Hydra
 * @param {(catalogo: string, valorHydra: string) => (number|null)} resolverCatalogo
 * @param {{fechaIngresoSugerida?: string|null}} [opciones]
 * @returns {{ datosEmpleado: object, sinMapear: Array<{ruta, catalogo, valorHydra}>, resumen: object }}
 */
function mapearPayloadHydra(candidato, resolverCatalogo, opciones = {}) {
    const datosEmpleado = datosEmpleadoVacio();
    const sinMapear = [];

    for (const [origen, destino] of CAMPOS_DIRECTOS) {
        asignar(datosEmpleado, destino, limpiar(obtener(candidato, origen)));
    }

    const resolver = (catalogo, valorHydra, destino) => {
        const id = resolverCatalogo(catalogo, valorHydra);
        if (id == null) sinMapear.push({ ruta: destino, catalogo, valorHydra });
        asignar(datosEmpleado, destino, id ?? null);
    };

    for (const [origen, catalogo, destino] of CAMPOS_CATALOGO) {
        const valor = limpiar(obtener(candidato, origen));
        if (valor !== null) resolver(catalogo, String(valor), destino);
    }

    if (datosEmpleado.direccion.direccion !== null) {
        resolver('tipo_direccion', TIPO_DIRECCION_HYDRA, 'direccion.tipo_direccion_id');
    }

    const fechaIngreso = opciones.fechaIngresoSugerida;
    if (typeof fechaIngreso === 'string' && FECHA.test(fechaIngreso)) {
        datosEmpleado.contrato.fecha_ingreso = fechaIngreso;
    }

    const nombreCompleto = [
        datosEmpleado.primer_nombre, datosEmpleado.segundo_nombre,
        datosEmpleado.primer_apellido, datosEmpleado.segundo_apellido
    ].filter(Boolean).join(' ');

    return {
        datosEmpleado,
        sinMapear,
        resumen: {
            hydraCandidatoId: candidato.hydra_candidato_id,
            tipoIdentificacion: limpiar(obtener(candidato, 'identificacion.tipo')),
            numeroIdentificacion: datosEmpleado.numero_identificacion,
            nombreCompleto,
            cargoHydra: limpiar(obtener(candidato, 'proceso.cargo'))
        }
    };
}

// Rutas de datos_empleado que alimenta Hydra (las únicas que un reenvío puede tocar).
const RUTAS_ALIMENTADAS_POR_HYDRA = [
    ...CAMPOS_DIRECTOS.map(([, destino]) => destino),
    ...CAMPOS_CATALOGO.map(([, , destino]) => destino),
    'direccion.tipo_direccion_id',
    'contrato.fecha_ingreso'
];

/**
 * Reenvío de Hydra sobre un borrador que RRHH ya pudo haber editado (merge a tres vías):
 * un campo toma el valor nuevo de Hydra solo si RRHH no lo cambió, es decir, si el
 * borrador todavía tiene lo que Hydra había mandado antes. Lo que RRHH editó se respeta.
 *
 * @param {object} actual          datos_empleado guardado
 * @param {object} hydraAnterior   datosEmpleado mapeado del payload anterior
 * @param {object} hydraNuevo      datosEmpleado mapeado del payload nuevo
 * @returns {object} nuevo borrador (no muta `actual`)
 */
function fusionarReenvioHydra(actual, hydraAnterior, hydraNuevo) {
    const resultado = structuredClone(actual);
    for (const ruta of RUTAS_ALIMENTADAS_POR_HYDRA) {
        const vigente = obtener(actual, ruta) ?? null;
        const anterior = obtener(hydraAnterior, ruta) ?? null;
        if (String(vigente) === String(anterior)) {
            asignar(resultado, ruta, obtener(hydraNuevo, ruta) ?? null);
        }
    }
    return resultado;
}

// Rutas de datos_empleado que alimenta cada catálogo.
function rutasDeCatalogo(catalogo) {
    const rutas = CAMPOS_CATALOGO.filter(([, c]) => c === catalogo).map(([, , destino]) => destino);
    if (catalogo === 'tipo_direccion') rutas.push('direccion.tipo_direccion_id');
    return rutas;
}

/**
 * Cuando RRHH guarda un mapeo nuevo, los candidatos abiertos que tenían ese valor sin
 * mapear se completan solos: se toma el valor recién resuelto SOLO en las rutas de ese
 * catálogo que siguen vacías. Lo que RRHH ya eligió a mano no se toca.
 *
 * @param {object} datosEmpleado  borrador actual
 * @param {object} hydraMapeado   datosEmpleado de mapearPayloadHydra con el resolutor nuevo
 * @param {string} catalogo
 * @returns {{ datos: object, rutas: string[] }} copia del borrador y rutas que cambiaron
 */
function completarCatalogoDesdeHydra(datosEmpleado, hydraMapeado, catalogo) {
    const datos = structuredClone(datosEmpleado);
    const rutas = [];
    for (const ruta of rutasDeCatalogo(catalogo)) {
        const nuevo = obtener(hydraMapeado, ruta);
        if (estaVacio(obtener(datos, ruta)) && !estaVacio(nuevo)) {
            asignar(datos, ruta, nuevo);
            rutas.push(ruta);
        }
    }
    return { datos, rutas };
}

module.exports = {
    CATALOGOS,
    datosEmpleadoVacio,
    mapearPayloadHydra,
    fusionarReenvioHydra,
    completarCatalogoDesdeHydra
};
