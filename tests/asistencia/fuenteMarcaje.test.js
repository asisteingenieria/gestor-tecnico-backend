const { test } = require('node:test');
const assert = require('node:assert/strict');
const { usaAsislock } = require('../../domain/asistencia/fuenteMarcaje');

test('agentes, coordinadores y backoffice de campaña usan AsisLock', () => {
    assert.equal(usaAsislock({ cargo: 'AGENTE CALL CENTER', centroCosto: 'CBAT OUTBOUND' }), true);
    assert.equal(usaAsislock({ cargo: 'COORDINADOR CALL', centroCosto: 'CBAH INBOUND' }), true);
    assert.equal(usaAsislock({ cargo: 'BACKOFFICE OBAMACARE', centroCosto: 'EUAO OBAMA' }), true);
    assert.equal(usaAsislock({ cargo: 'Agente', centroCosto: 'Operación Claro' }), true);
});

test('el staff no usa AsisLock, aunque su cargo diga coordinador', () => {
    assert.equal(usaAsislock({ cargo: 'TECNICO EN SOPORTE DE SISTEMAS', centroCosto: 'ADMINISTRATIVO' }), false);
    assert.equal(usaAsislock({ cargo: 'COORDINADOR DE DESARROLLO', centroCosto: 'ADMINISTRATIVO' }), false);
    assert.equal(usaAsislock({ cargo: 'JEFE DE OPERACIONES', centroCosto: 'DIRECCION OPERATIVA' }), false);
    assert.equal(usaAsislock({ cargo: 'Coordinador', centroCosto: 'Tecnología' }), false);
});

test('cargos de staff dentro de una campaña no usan AsisLock', () => {
    assert.equal(usaAsislock({ cargo: 'ANALISTA DE CALIDAD', centroCosto: 'CBAH WHATSAPP' }), false);
    assert.equal(usaAsislock({ cargo: 'FORMADOR', centroCosto: 'CBAH OUTBOUND' }), false);
    assert.equal(usaAsislock({ cargo: 'JEFE DE BACKOFFICE', centroCosto: 'CBAT INBOUND' }), false);
    assert.equal(usaAsislock({ cargo: null, centroCosto: null }), false);
});

test('si hoy tiene registros de AsisLock se muestran, sea quien sea', () => {
    assert.equal(usaAsislock({ cargo: 'DESARROLLADOR FULLSTACK', centroCosto: 'ADMINISTRATIVO', tieneAsislockHoy: true }), true);
});
