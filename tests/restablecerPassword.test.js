const test = require('node:test');
const assert = require('node:assert/strict');
const { claveRestablecida } = require('../utils/restablecerPassword');

test('modo cédula: la contraseña es la cédula sin espacios', () => {
    assert.deepEqual(claveRestablecida({ modo: 'cedula', cedula: ' 1023456789 ' }), { password: '1023456789' });
    assert.deepEqual(claveRestablecida({ modo: 'cedula', cedula: 1023456789 }), { password: '1023456789' });
});

test('modo cédula sin cédula o muy corta pide contraseña temporal', () => {
    assert.ok(claveRestablecida({ modo: 'cedula', cedula: null }).error);
    assert.ok(claveRestablecida({ modo: 'cedula', cedula: '   ' }).error);
    assert.ok(claveRestablecida({ modo: 'cedula', cedula: '12345' }).error);
});

test('modo temporal: mínimo 6 caracteres y sin espacios en los bordes', () => {
    assert.deepEqual(claveRestablecida({ modo: 'temporal', password: 'Temp2026*' }), { password: 'Temp2026*' });
    assert.ok(claveRestablecida({ modo: 'temporal', password: '12345' }).error);
    assert.ok(claveRestablecida({ modo: 'temporal' }).error);
    assert.ok(claveRestablecida({ modo: 'temporal', password: ' Temp2026 ' }).error);
});

test('modo desconocido es error', () => {
    assert.ok(claveRestablecida({ modo: 'otro', password: 'Temp2026*' }).error);
    assert.ok(claveRestablecida().error);
});
