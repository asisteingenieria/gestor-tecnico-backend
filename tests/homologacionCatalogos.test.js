const test = require('node:test');
const assert = require('node:assert/strict');
const { similitud, sugerencias, homologar } = require('../utils/homologacionCatalogos');

const CARGOS = [
    { id: 1, nombre: 'AGENTE CALL CENTER' },
    { id: 2, nombre: 'AGENTE COMERCIAL' },
    { id: 3, nombre: 'COORDINADOR CALL' },
    { id: 4, nombre: 'BACKOFFICE' },
    { id: 5, nombre: 'ANALISTA DE CALIDAD' }
];

test('el nombre del catálogo más parecido queda de primero', () => {
    const [primera] = sugerencias('AGENTE DE CALL CENTER', CARGOS);
    assert.equal(primera.id, 1);
    assert.equal(sugerencias('Analista calidad', CARGOS)[0].id, 5);
    assert.equal(sugerencias('BACK OFFICE', CARGOS)[0].id, 4);
});

test('no sugiere nombres sin relación y respeta el límite', () => {
    assert.deepEqual(sugerencias('JARDINERO', CARGOS), []);
    assert.ok(sugerencias('AGENTE', CARGOS).length <= 3);
});

test('la similitud ignora tildes, mayúsculas y signos', () => {
    assert.equal(similitud('Bogotá D.C.', 'BOGOTA DC'), 1);
    assert.ok(similitud('T&T', 'T Y T') < 1);
});

test('homologa al más parecido solo si es claramente ese', () => {
    assert.equal(homologar('AGENTE DE CALL CENTER', CARGOS).id, 1);
    assert.equal(homologar('Analista calidad', CARGOS).id, 5);
    assert.equal(homologar('JARDINERO', CARGOS), null);
    // Dos nombres casi iguales: no se elige a ciegas.
    assert.equal(homologar('AGENTE', [{ id: 1, nombre: 'AGENTE CALL' }, { id: 2, nombre: 'AGENTE COMERCIAL' }]), null);
});

test('los números tienen que coincidir', () => {
    const oleadas = [{ id: 1, nombre: 'OLD 141' }, { id: 2, nombre: 'OLD 99' }];
    assert.equal(homologar('OLD 142', oleadas), null);
    assert.equal(homologar('CBAT INBOUND 2', [{ id: 1, nombre: 'CBAT INBOUND 1' }]), null);
});
