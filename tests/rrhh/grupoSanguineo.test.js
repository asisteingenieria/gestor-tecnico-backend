const test = require('node:test');
const assert = require('node:assert/strict');
const { claveGrupoSanguineo } = require('../../utils/grupoSanguineo');

test('el signo del RH se conserva: O+ y O- no son lo mismo', () => {
    assert.equal(claveGrupoSanguineo('O+'), 'O+');
    assert.equal(claveGrupoSanguineo('O-'), 'O-');
    assert.notEqual(claveGrupoSanguineo('A+'), claveGrupoSanguineo('A-'));
    assert.equal(claveGrupoSanguineo('AB+'), 'AB+');
    assert.equal(claveGrupoSanguineo('AB-'), 'AB-');
});

test('acepta las formas en que llega el RH en los archivos', () => {
    assert.equal(claveGrupoSanguineo(' o + '), 'O+');
    assert.equal(claveGrupoSanguineo('O POSITIVO'), 'O+');
    assert.equal(claveGrupoSanguineo('A Negativo'), 'A-');
    assert.equal(claveGrupoSanguineo('B pos'), 'B+');
    assert.equal(claveGrupoSanguineo('ORH+'), 'O+');
    assert.equal(claveGrupoSanguineo('O RH -'), 'O-');
    assert.equal(claveGrupoSanguineo('0+'), 'O+');
    assert.equal(claveGrupoSanguineo('AB–'), 'AB-');
});

test('lo que no es un grupo sanguíneo no se adivina', () => {
    assert.equal(claveGrupoSanguineo('O'), null);
    assert.equal(claveGrupoSanguineo('X+'), null);
    assert.equal(claveGrupoSanguineo(''), null);
    assert.equal(claveGrupoSanguineo(null), null);
});
