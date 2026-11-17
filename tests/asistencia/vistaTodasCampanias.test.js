const test = require('node:test');
const assert = require('node:assert/strict');
const { veTodasLasCampanias, alcanceDeConsulta, normalizarCargo } = require('../../domain/asistencia/vistaTodasCampanias');

test('el Director de Tecnología ve todas las campañas, con o sin tildes y mayúsculas', () => {
    assert.equal(veTodasLasCampanias('DIRECTOR DE TECNOLOGIA'), true);
    assert.equal(veTodasLasCampanias('Director de Tecnología'), true);
    assert.equal(veTodasLasCampanias('  director  de   tecnologia '), true);
});

test('otros cargos, o sin cargo, no ven todas las campañas', () => {
    assert.equal(veTodasLasCampanias('DIRECTOR DE OPERACIONES'), false);
    assert.equal(veTodasLasCampanias('JEFE DE TECNOLOGIA'), false);
    assert.equal(veTodasLasCampanias(null), false);
    assert.equal(veTodasLasCampanias(''), false);
});

test('normalizarCargo quita tildes y espacios de más', () => {
    assert.equal(normalizarCargo(' Gestión  Humana '), 'GESTION HUMANA');
});

test('el alcance por defecto es su equipo', () => {
    assert.deepEqual(alcanceDeConsulta(), { tipo: 'equipo', campaniaId: null });
    assert.deepEqual(alcanceDeConsulta({ campaniaId: '' }), { tipo: 'equipo', campaniaId: null });
});

test('una campaña o todas', () => {
    assert.deepEqual(alcanceDeConsulta({ campaniaId: '7' }), { tipo: 'campania', campaniaId: 7 });
    assert.deepEqual(alcanceDeConsulta({ alcance: 'todas', campaniaId: 7 }), { tipo: 'todas', campaniaId: null });
});
