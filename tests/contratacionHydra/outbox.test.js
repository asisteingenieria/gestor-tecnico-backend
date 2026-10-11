const { test } = require('node:test');
const assert = require('node:assert/strict');

const { decidirResultadoEnvio, RUTA_POR_TIPO } = require('../../domain/contratacionHydra/outbox');
const { validarObligatorios } = require('../../utils/validarEmpleado');
const { datosEmpleadoCompletos } = require('./fixtures');

const POLITICA = { maxIntentos: 10, backoffMaximoMinutos: 60 };
const decidir = (status, intentosPrevios = 0, codigo = null) =>
    decidirResultadoEnvio({ status, codigo, intentosPrevios }, POLITICA);

test('2xx → enviado', () => {
    assert.deepEqual(decidir(200), { estado: 'enviado', intentos: 1, esperaMinutos: null });
    assert.equal(decidir(201).estado, 'enviado');
});

test('409 → enviado (Hydra ya lo había aplicado), salvo PETICION_CONCURRENTE', () => {
    assert.equal(decidir(409).estado, 'enviado');
    assert.equal(decidir(409, 0, 'PETICION_CONCURRENTE').estado, 'pendiente');
});

test('5xx, 408, 429 y red caída se reintentan con backoff exponencial', () => {
    assert.deepEqual(decidir(500, 0), { estado: 'pendiente', intentos: 1, esperaMinutos: 1 });
    assert.deepEqual(decidir(503, 1), { estado: 'pendiente', intentos: 2, esperaMinutos: 2 });
    assert.deepEqual(decidir(null, 3), { estado: 'pendiente', intentos: 4, esperaMinutos: 8 });
    assert.equal(decidir(429, 0).estado, 'pendiente');
    assert.equal(decidir(408, 0).estado, 'pendiente');
});

test('el backoff tiene tope de una hora', () => {
    assert.equal(decidir(500, 8).esperaMinutos, 60); // 2^8 = 256 → 60
});

test('al llegar al máximo de intentos queda fallido', () => {
    assert.deepEqual(decidir(500, 9), { estado: 'fallido', intentos: 10, esperaMinutos: null });
});

test('otros 4xx son permanentes: fallido al primer intento', () => {
    for (const status of [400, 401, 403, 404, 422]) {
        assert.equal(decidir(status).estado, 'fallido', String(status));
    }
});

test('cada tipo de aviso tiene su endpoint en Hydra', () => {
    assert.equal(RUTA_POR_TIPO.candidato_registrado, '/contrataciones');
    assert.equal(RUTA_POR_TIPO.candidato_descartado, '/descartes');
});

test('validarObligatorios compartido acepta el borrador completo del checklist', () => {
    // Si secciones.js y utils/validarEmpleado.js divergen, un candidato "listo" fallaría al registrar.
    assert.equal(validarObligatorios(datosEmpleadoCompletos()), null);
    assert.match(validarObligatorios(datosEmpleadoCompletos({ 'contrato.oleada_id': null })), /oleada/);
    assert.match(validarObligatorios(datosEmpleadoCompletos({ 'salario.salario': 0 })), /salario/);
});
