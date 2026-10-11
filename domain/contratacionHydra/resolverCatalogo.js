// Resolución de códigos de catálogo de Hydra a IDs de Gestor (conexionhydra.md §4.2).
//
// Puro: recibe las filas ya cargadas (el servicio hace los SELECT) y devuelve la función
// `resolverCatalogo(catalogo, valorHydra) → id | null` que consume mapearPayloadHydra.
//
// Orden de resolución:
//   1. Mapeo explícito guardado por RRHH (hydra_mapeo_catalogo).
//   2. Coincidencia por nombre (o código) normalizado — SOLO si es única. Gestor tiene
//      duplicados reales ("SURA" y "EPS Sura", "COMPENSAR" y "Compensar EPS"); elegir uno
//      al azar asignaría la entidad equivocada sin que nadie lo note, así que un empate
//      queda sin mapear y lo decide RRHH (una vez: luego se recuerda como mapeo).

// Igual que normalizar() de services/importEmpleadosService.js (quita paréntesis, tildes,
// mayúsculas y todo lo no alfanumérico), con dos ajustes por catálogo:
//   - grupo_sanguineo: el signo es el dato ("O+" ≠ "O-"); la normalización genérica lo borra.
//   - eps: Hydra dice "Sanitas EPS" y Gestor "Sanitas"; la palabra EPS no distingue nada.
function normalizarBase(texto) {
    return String(texto ?? '')
        .replace(/\([^)]*\)/g, '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

const AJUSTES = {
    grupo_sanguineo: (texto) => String(texto ?? '').replace(/\+/g, 'pos').replace(/-/g, 'neg'),
    eps: (texto) => String(texto ?? '').replace(/\beps\b/gi, ' ')
};

function normalizar(catalogo, texto) {
    const ajuste = AJUSTES[catalogo];
    return normalizarBase(ajuste ? ajuste(texto) : texto);
}

function claveMapeo(valor) {
    return String(valor ?? '').trim().toLowerCase();
}

/**
 * @param {object} fuentes
 * @param {Object<string, Array<{id: number, nombre: string, codigo?: string}>>} fuentes.catalogos
 *   filas de Gestor por catálogo (las claves son los CATALOGOS de mapearPayloadHydra)
 * @param {Array<{catalogo: string, valor_hydra: string, id_gestor: number}>} fuentes.mapeos
 */
function crearResolverCatalogo({ catalogos, mapeos = [] }) {
    const explicitos = new Map(mapeos.map((m) => [`${m.catalogo}|${claveMapeo(m.valor_hydra)}`, m.id_gestor]));

    // catalogo -> (valor normalizado -> Set de ids). Un Set con más de un id = ambiguo.
    const indices = new Map();
    for (const [catalogo, filas] of Object.entries(catalogos)) {
        const indice = new Map();
        const agregar = (texto, id) => {
            const clave = normalizar(catalogo, texto);
            if (!clave) return;
            if (!indice.has(clave)) indice.set(clave, new Set());
            indice.get(clave).add(id);
        };
        for (const fila of filas) {
            agregar(fila.nombre, fila.id);
            if (fila.codigo) agregar(fila.codigo, fila.id);
        }
        indices.set(catalogo, indice);
    }

    return function resolverCatalogo(catalogo, valorHydra) {
        const explicito = explicitos.get(`${catalogo}|${claveMapeo(valorHydra)}`);
        if (explicito !== undefined) return explicito;

        const ids = indices.get(catalogo)?.get(normalizar(catalogo, valorHydra));
        return ids && ids.size === 1 ? [...ids][0] : null;
    };
}

module.exports = { crearResolverCatalogo, normalizar };
