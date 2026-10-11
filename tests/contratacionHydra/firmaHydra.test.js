const { test } = require('node:test');
const assert = require('node:assert/strict');

const { firmar, firmaValida, igualesSeguro, timestampVigente } = require('../../utils/firmaHydra');

const SECRETO = 'secreto-de-prueba-0123456789abcdef';
const CUERPO = JSON.stringify({ lote_externo_id: 'L-1', candidatos: [] });

test('una firma calculada con el mismo secreto, timestamp y cuerpo es válida', () => {
    const firma = firmar(SECRETO, '1759300000', CUERPO);
    assert.match(firma, /^sha256=[0-9a-f]{64}$/);
    assert.equal(firmaValida(SECRETO, '1759300000', CUERPO, firma), true);
    assert.equal(firmaValida(SECRETO, '1759300000', Buffer.from(CUERPO), firma), true);
});

test('cambiar un byte del cuerpo invalida la firma', () => {
    const firma = firmar(SECRETO, '1759300000', CUERPO);
    assert.equal(firmaValida(SECRETO, '1759300000', CUERPO.replace('L-1', 'L-2'), firma), false);
});

test('el timestamp va firmado: reusar la firma con otro timestamp falla', () => {
    const firma = firmar(SECRETO, '1759300000', CUERPO);
    assert.equal(firmaValida(SECRETO, '1759300001', CUERPO, firma), false);
});

test('otro secreto no valida', () => {
    const firma = firmar(SECRETO, '1759300000', CUERPO);
    assert.equal(firmaValida('otro-secreto', '1759300000', CUERPO, firma), false);
});

test('firma ausente o con otro formato no valida (sin lanzar)', () => {
    assert.equal(firmaValida(SECRETO, '1759300000', CUERPO, undefined), false);
    assert.equal(firmaValida(SECRETO, '1759300000', CUERPO, 'abc'), false);
});

test('cuerpo vacío (GET) se firma igual que el string vacío', () => {
    assert.equal(firmar(SECRETO, '1', Buffer.alloc(0)), firmar(SECRETO, '1', ''));
});

test('igualesSeguro compara sin importar longitudes distintas', () => {
    assert.equal(igualesSeguro('abc', 'abc'), true);
    assert.equal(igualesSeguro('abc', 'abcd'), false);
    assert.equal(igualesSeguro(undefined, 'x'), false);
});

test('timestampVigente aplica la ventana en ambos sentidos y rechaza basura', () => {
    assert.equal(timestampVigente('1000', 1000 + 300, 300), true);
    assert.equal(timestampVigente('1000', 1000 + 301, 300), false);
    assert.equal(timestampVigente('1301', 1000, 300), false);
    assert.equal(timestampVigente('abc', 1000, 300), false);
    assert.equal(timestampVigente(undefined, 1000, 300), false);
    assert.equal(timestampVigente('1000.5', 1000, 300), false);
});
