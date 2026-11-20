const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../utils/vacacionesNovedad');

test('la modalidad solo aplica a Vacaciones', () => {
    assert.equal(V.esVacaciones('Vacaciones'), true);
    assert.equal(V.esVacaciones('Incapacidad general'), false);
    assert.deepEqual(V.normalizar({ modalidad_vacaciones: 'compensadas', dias_compensados: 3 }, false).campos,
        { modalidad_vacaciones: null, dias_disfrutados: null, dias_compensados: null });
});

test('disfrutadas, compensadas y las dos: total = suma', () => {
    assert.deepEqual(V.normalizar({ modalidad_vacaciones: 'disfrutadas', dias_disfrutados: '15', dias_compensados: 9 }, true).campos,
        { modalidad_vacaciones: 'disfrutadas', dias_disfrutados: 15, dias_compensados: 0, total_dias: 15 });
    assert.deepEqual(V.normalizar({ modalidad_vacaciones: 'compensadas', dias_disfrutados: 4, dias_compensados: 7 }, true).campos,
        { modalidad_vacaciones: 'compensadas', dias_disfrutados: 0, dias_compensados: 7, total_dias: 7 });
    assert.deepEqual(V.normalizar({ modalidad_vacaciones: 'disfrutadas_compensadas', dias_disfrutados: 5, dias_compensados: 5 }, true).campos,
        { modalidad_vacaciones: 'disfrutadas_compensadas', dias_disfrutados: 5, dias_compensados: 5, total_dias: 10 });
});

test('pide la modalidad y los días de cada parte', () => {
    assert.match(V.normalizar({}, true).error, /disfrutadas, compensadas/);
    assert.match(V.normalizar({ modalidad_vacaciones: 'disfrutadas' }, true).error, /cuántos días disfruta/);
    assert.match(V.normalizar({ modalidad_vacaciones: 'compensadas', dias_compensados: 0 }, true).error, /compensan/);
    assert.match(V.normalizar({ modalidad_vacaciones: 'disfrutadas_compensadas', dias_disfrutados: 5 }, true).error, /compensan/);
    assert.match(V.normalizar({ modalidad_vacaciones: 'disfrutadas', dias_disfrutados: 2.5 }, true).error, /enteros/);
});

test('una novedad de antes de la 107 cuenta como disfrutada', () => {
    assert.deepEqual(V.partes({ total_dias: 8 }), { disfrutados: 8, compensados: 0 });
    assert.deepEqual(V.partes({ total_dias: 10, modalidad_vacaciones: 'disfrutadas_compensadas', dias_disfrutados: 6, dias_compensados: 4 }),
        { disfrutados: 6, compensados: 4 });
});
