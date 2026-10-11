const { test } = require('node:test');
const assert = require('node:assert/strict');

const { crearResolverCatalogo, normalizar } = require('../../domain/contratacionHydra/resolverCatalogo');

// Filas reales del catálogo local de Gestor (2026-10-01), recortadas.
const CATALOGOS = {
    tipo_identificacion: [
        { id: 1, codigo: 'CC', nombre: 'Cédula de ciudadanía' },
        { id: 4, codigo: 'PPT', nombre: 'Permiso por protección temporal' }
    ],
    genero: [{ id: 1, nombre: 'Masculino' }, { id: 2, nombre: 'Femenino' }],
    estado_civil: [{ id: 1, nombre: 'Soltero(a)' }, { id: 3, nombre: 'Unión libre' }],
    grupo_sanguineo: [{ id: 1, nombre: 'O+' }, { id: 2, nombre: 'O-' }, { id: 7, nombre: 'AB+' }],
    eps: [
        { id: 2, nombre: 'Sanitas' }, { id: 4, nombre: 'Salud Total' },
        { id: 1, nombre: 'EPS Sura' }, { id: 34, nombre: 'SURA' },
        { id: 3, nombre: 'Nueva EPS' }, { id: 28, nombre: 'MUTUALSER' }
    ],
    afp: [{ id: 12, nombre: 'Porvenir' }, { id: 13, nombre: 'Protección' }],
    parentesco: [{ id: 1, nombre: 'Madre' }, { id: 3, nombre: 'Hermano(a)' }, { id: 6, nombre: 'Compañero(a)' }]
};

const resolver = crearResolverCatalogo({ catalogos: CATALOGOS });

test('resuelve los códigos de Hydra por nombre normalizado', () => {
    assert.equal(resolver('tipo_identificacion', 'CC'), 1);
    assert.equal(resolver('tipo_identificacion', 'PPT'), 4);
    assert.equal(resolver('genero', 'femenino'), 2);
    assert.equal(resolver('estado_civil', 'soltero'), 1);
    assert.equal(resolver('estado_civil', 'union_libre'), 3);
    assert.equal(resolver('parentesco', 'hermano'), 3);
    assert.equal(resolver('afp', 'Protección'), 13);
});

test('grupo sanguíneo conserva el signo: O+ y O- no se confunden', () => {
    assert.equal(resolver('grupo_sanguineo', 'O+'), 1);
    assert.equal(resolver('grupo_sanguineo', 'O-'), 2);
    assert.equal(resolver('grupo_sanguineo', 'AB+'), 7);
    assert.notEqual(normalizar('grupo_sanguineo', 'O+'), normalizar('grupo_sanguineo', 'O-'));
});

test('EPS: ignora la palabra "EPS" y los espacios', () => {
    assert.equal(resolver('eps', 'Sanitas EPS'), 2);
    assert.equal(resolver('eps', 'Salud Total EPS'), 4);
    assert.equal(resolver('eps', 'Mutual SER'), 28);
});

test('"Nueva EPS" sigue resolviendo aunque se quite la palabra EPS', () => {
    assert.equal(resolver('eps', 'Nueva EPS'), 3);
});

test('una coincidencia ambigua NO se resuelve: la decide RRHH', () => {
    // "Sura EPS" casa con "EPS Sura" (1) y con "SURA" (34).
    assert.equal(resolver('eps', 'Sura EPS'), null);
});

test('un valor sin equivalente queda sin resolver', () => {
    assert.equal(resolver('parentesco', 'pareja'), null);
    assert.equal(resolver('eps', 'No tengo EPS'), null);
    assert.equal(resolver('catalogo_inexistente', 'x'), null);
});

test('un mapeo guardado por RRHH gana sobre la coincidencia por nombre y resuelve ambiguos', () => {
    const conMapeos = crearResolverCatalogo({
        catalogos: CATALOGOS,
        mapeos: [
            { catalogo: 'eps', valor_hydra: 'Sura EPS', id_gestor: 34 },
            { catalogo: 'parentesco', valor_hydra: 'pareja', id_gestor: 6 },
            { catalogo: 'genero', valor_hydra: 'femenino', id_gestor: 99 }
        ]
    });
    assert.equal(conMapeos('eps', 'Sura EPS'), 34);
    assert.equal(conMapeos('eps', '  sura eps '), 34);
    assert.equal(conMapeos('parentesco', 'pareja'), 6);
    assert.equal(conMapeos('genero', 'femenino'), 99);
});
