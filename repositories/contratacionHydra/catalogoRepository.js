const db = require('../../config/db');

// Filas de Gestor contra las que se resuelven los códigos de Hydra, una consulta por
// catálogo de CATALOGOS (domain/contratacionHydra/mapearPayloadHydra.js). Todas con la
// forma { id, nombre[, codigo] } que espera crearResolverCatalogo.
const CONSULTAS = {
    tipo_identificacion: ['SELECT idtipo_identificacion AS id, nombre, codigo FROM tipo_identificacion'],
    genero: ['SELECT idgenero AS id, nombre FROM genero'],
    estado_civil: ['SELECT idestado_civil AS id, nombre FROM estado_civil'],
    grupo_sanguineo: ['SELECT idgrupo_sanguineo AS id, nombre FROM grupo_sanguineo'],
    // Solo las vigentes (migración 068): un candidato nuevo se afilia a una entidad de la lista
    // oficial, y así los duplicados viejos ("SURA" / "EPS SURA") no vuelven ambigua la búsqueda.
    eps: ['SELECT identidad_seguridad_social AS id, nombre FROM entidad_seguridad_social WHERE tipo = ? AND vigente = 1', ['EPS']],
    afp: ['SELECT identidad_seguridad_social AS id, nombre FROM entidad_seguridad_social WHERE tipo = ? AND vigente = 1', ['AFP']],
    parentesco: ['SELECT idparentesco AS id, nombre FROM parentesco'],
    cargo: ['SELECT idcargo AS id, nombre FROM cargo'],
    tipo_direccion: ['SELECT idtipo_direccion AS id, nombre FROM tipo_direccion']
};

async function findCatalogos(catalogos, conn = db) {
    const resultado = {};
    for (const catalogo of catalogos) {
        const consulta = CONSULTAS[catalogo];
        if (!consulta) throw new Error(`Catálogo sin consulta en catalogoRepository: ${catalogo}`);
        const [rows] = await conn.query(consulta[0], consulta[1] ?? []);
        resultado[catalogo] = rows;
    }
    return resultado;
}

async function findMapeos(conn = db) {
    const [rows] = await conn.query('SELECT catalogo, valor_hydra, id_gestor FROM hydra_mapeo_catalogo');
    return rows;
}

// Listado para la UI, con el nombre del valor de Gestor y quién lo creó. El nombre se
// resuelve en el servicio contra findCatalogos para no repetir aquí las 9 consultas.
async function findMapeosDetalle(conn = db) {
    const [rows] = await conn.query(
        `SELECT m.idhydra_mapeo_catalogo, m.catalogo, m.valor_hydra, m.id_gestor, m.created_at,
                u.full_name AS creado_por_nombre
         FROM hydra_mapeo_catalogo m
         LEFT JOIN users u ON u.id = m.creado_por_user_id
         ORDER BY m.catalogo, m.valor_hydra`
    );
    return rows;
}

// Crear o corregir un mapeo (la clave es catalogo + valor_hydra).
async function guardarMapeo({ catalogo, valorHydra, idGestor, usuarioId }, conn = db) {
    await conn.query(
        `INSERT INTO hydra_mapeo_catalogo (catalogo, valor_hydra, id_gestor, creado_por_user_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE id_gestor = VALUES(id_gestor), creado_por_user_id = VALUES(creado_por_user_id)`,
        [catalogo, valorHydra, idGestor, usuarioId]
    );
}

module.exports = { findCatalogos, findMapeos, findMapeosDetalle, guardarMapeo };
