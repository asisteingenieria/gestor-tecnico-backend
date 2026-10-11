const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    mapearPayloadHydra,
    fusionarReenvioHydra,
    datosEmpleadoVacio
} = require('../../domain/contratacionHydra/mapearPayloadHydra');
const { evaluarCompletitud } = require('../../domain/contratacionHydra/completitud');
const { payloadCandidato, resolverDesde, RESOLVER_COMPLETO } = require('./fixtures');

test('mapea campos directos y de catálogo a la forma de POST /users-company', () => {
    const { datosEmpleado, sinMapear } = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO);

    assert.deepEqual(sinMapear, []);
    assert.equal(datosEmpleado.numero_identificacion, '9100000001');
    assert.equal(datosEmpleado.tipo_identificacion_id, 1);
    assert.equal(datosEmpleado.primer_apellido, 'Gómez');
    assert.equal(datosEmpleado.telefono, '3001234567');
    assert.equal(datosEmpleado.genero_id, 2);
    assert.equal(datosEmpleado.seguridad_social.eps_id, 11);
    assert.equal(datosEmpleado.seguridad_social.afp_id, 21);
    assert.equal(datosEmpleado.contacto_emergencia.parentesco_id, 3);
    assert.equal(datosEmpleado.direccion.tipo_direccion_id, 1);
    assert.equal(datosEmpleado.contrato.cargo_id, 40);
    assert.equal(datosEmpleado.dotacion.talla_camisa, 'M');
});

test('el cliente de Hydra no se mapea: RRHH elige la campaña', () => {
    const { datosEmpleado } = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO);
    assert.equal(datosEmpleado.contrato.campania_id, null);
});

test('reporta los valores de catálogo que no se pudieron resolver, con su ruta destino', () => {
    const resolver = resolverDesde({ tipo_identificacion: { CC: 1 } });
    const { datosEmpleado, sinMapear } = mapearPayloadHydra(payloadCandidato(), resolver);

    assert.equal(datosEmpleado.genero_id, null);
    assert.deepEqual(
        sinMapear.find((s) => s.catalogo === 'genero'),
        { ruta: 'genero_id', catalogo: 'genero', valorHydra: 'femenino' }
    );
    assert.ok(sinMapear.some((s) => s.ruta === 'direccion.tipo_direccion_id'));
});

test('no consulta catálogos para valores vacíos ni pide tipo de dirección sin dirección', () => {
    const consultados = [];
    const resolver = (catalogo, valor) => { consultados.push(catalogo); return RESOLVER_COMPLETO(catalogo, valor); };
    mapearPayloadHydra(payloadCandidato({
        personal: { fecha_nacimiento: null, genero: '', estado_civil: null, grupo_sanguineo: null },
        direccion: { direccion: '  ', barrio: null }
    }), resolver);

    assert.ok(!consultados.includes('genero'));
    assert.ok(!consultados.includes('tipo_direccion'));
});

test('recorta espacios y convierte vacíos en null', () => {
    const { datosEmpleado } = mapearPayloadHydra(payloadCandidato({
        nombres: { primer_nombre: '  Laura ', segundo_nombre: '', primer_apellido: 'Gómez', segundo_apellido: null }
    }), RESOLVER_COMPLETO);
    assert.equal(datosEmpleado.primer_nombre, 'Laura');
    assert.equal(datosEmpleado.segundo_nombre, null);
});

test('toma la fecha de ingreso sugerida del lote solo si es una fecha YYYY-MM-DD', () => {
    const ok = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO, { fechaIngresoSugerida: '2026-10-06' });
    assert.equal(ok.datosEmpleado.contrato.fecha_ingreso, '2026-10-06');

    const mala = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO, { fechaIngresoSugerida: '06/10/2026' });
    assert.equal(mala.datosEmpleado.contrato.fecha_ingreso, null);
});

test('arma el resumen para las columnas de búsqueda de hydra_candidato', () => {
    const { resumen } = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO);
    assert.deepEqual(resumen, {
        hydraCandidatoId: 4821,
        tipoIdentificacion: 'CC',
        numeroIdentificacion: '9100000001',
        nombreCompleto: 'Laura Gómez Ruiz',
        cargoHydra: 'agente_call_center'
    });
});

test('lo que llega de Hydra deja personal completa y contrato pendiente de lo que pone RRHH', () => {
    const { datosEmpleado, sinMapear } = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO, { fechaIngresoSugerida: '2026-10-06' });
    const { secciones } = evaluarCompletitud(datosEmpleado, [], { sinMapear });

    assert.equal(secciones.personal.completa, true);
    assert.equal(secciones.direccion_contacto.completa, true);
    assert.deepEqual(
        secciones.contrato.problemas.map((p) => p.ruta).sort(),
        ['contrato.area_id', 'contrato.campania_id', 'contrato.centro_costo_id', 'contrato.ciudad_id',
            'contrato.modalidad_id', 'contrato.oleada_id', 'contrato.tipo_contrato_id']
    );
});

test('datosEmpleadoVacio trae todas las rutas en null', () => {
    const vacio = datosEmpleadoVacio();
    assert.equal(vacio.contrato.campania_id, null);
    assert.equal(vacio.seguridad_social.caja_id, null);
    assert.equal(vacio.declarante_renta, false);
});

test('reenvío de Hydra: actualiza lo que RRHH no tocó y respeta lo que RRHH editó', () => {
    const anterior = mapearPayloadHydra(payloadCandidato(), RESOLVER_COMPLETO).datosEmpleado;
    const nuevo = mapearPayloadHydra(payloadCandidato({
        contacto: { email: 'nuevo@example.com', celular: '3000000000' }
    }), RESOLVER_COMPLETO).datosEmpleado;

    const actual = structuredClone(anterior);
    actual.telefono = '3115555555';          // RRHH corrigió el celular
    actual.contrato.campania_id = 5;         // RRHH completó la campaña

    const fusion = fusionarReenvioHydra(actual, anterior, nuevo);
    assert.equal(fusion.email, 'nuevo@example.com');   // no tocado por RRHH → valor nuevo
    assert.equal(fusion.telefono, '3115555555');       // editado por RRHH → se respeta
    assert.equal(fusion.contrato.campania_id, 5);      // campo que Hydra no alimenta → intacto
    assert.equal(actual.email, 'laura@example.com');   // no muta la entrada
});
