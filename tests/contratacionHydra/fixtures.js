const { datosEmpleadoVacio } = require('../../domain/contratacionHydra/mapearPayloadHydra');
const { asignar } = require('../../domain/contratacionHydra/rutas');

// Payload de un candidato tal como lo define el contrato (conexionhydra.md §5.1).
// Cédulas ficticias del rango 91000000xx: nunca datos reales en pruebas.
function payloadCandidato(overrides = {}) {
    return {
        hydra_candidato_id: 4821,
        version: 1,
        identificacion: { tipo: 'CC', numero: '9100000001' },
        nombres: { primer_nombre: 'Laura', segundo_nombre: null, primer_apellido: 'Gómez', segundo_apellido: 'Ruiz' },
        contacto: { email: 'laura@example.com', celular: '3001234567' },
        personal: { fecha_nacimiento: '2001-05-14', genero: 'femenino', estado_civil: 'soltero', grupo_sanguineo: 'O+' },
        seguridad_social: { eps: 'sanitas', afp: 'porvenir' },
        direccion: { direccion: 'Cra 10 # 20-30', barrio: 'Chapinero' },
        contacto_emergencia: { nombre: 'Ana Ruiz', telefono: '3109876543', parentesco: 'madre' },
        dotacion: { talla_camisa: 'M' },
        proceso: { cliente: 'claro', cargo: 'agente_call_center', aprobado_final_en: '2026-09-29T15:04:00Z' },
        consentimiento: { fecha: '2026-09-20', ciudad: 'Bogotá' },
        ...overrides
    };
}

// Resolver de catálogos en memoria: { catalogo: { valorHydra: id } }.
function resolverDesde(tabla) {
    return (catalogo, valor) => tabla[catalogo]?.[valor] ?? null;
}

const RESOLVER_COMPLETO = resolverDesde({
    tipo_identificacion: { CC: 1 },
    genero: { femenino: 2 },
    estado_civil: { soltero: 1 },
    grupo_sanguineo: { 'O+': 7 },
    eps: { sanitas: 11 },
    afp: { porvenir: 21 },
    parentesco: { madre: 3 },
    cargo: { agente_call_center: 40 },
    tipo_direccion: { residencia: 1 }
});

// Borrador con todos los obligatorios llenos: pasa validarObligatorios de userCompanyController.
function datosEmpleadoCompletos(cambios = {}) {
    const datos = datosEmpleadoVacio();
    const base = {
        tipo_identificacion_id: 1,
        numero_identificacion: '9100000001',
        primer_nombre: 'Laura',
        primer_apellido: 'Gómez',
        'contrato.campania_id': 5,
        'contrato.area_id': 2,
        'contrato.centro_costo_id': 3,
        'contrato.cargo_id': 40,
        'contrato.tipo_contrato_id': 1,
        'contrato.modalidad_id': 1,
        'contrato.oleada_id': 9,
        'contrato.ciudad_id': 11001,
        'contrato.fecha_ingreso': '2026-10-06',
        'salario.salario': 1423500,
        ...cambios
    };
    for (const [ruta, valor] of Object.entries(base)) asignar(datos, ruta, valor);
    return datos;
}

module.exports = { payloadCandidato, resolverDesde, RESOLVER_COMPLETO, datosEmpleadoCompletos };
