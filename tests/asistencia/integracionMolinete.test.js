const test = require('node:test');
const assert = require('node:assert/strict');
const { validarEnvioMolinete } = require('../../validators/molineteSchemas');

// Envío del intermediario del molinete (asistencia.md §80). Datos ficticios.
const marcacion = (extra = {}) => ({
    unique_key: '1-2026-11-24 08:01:02-9',
    pin: '123',
    cedula: '9000000002',
    departamento: 'STAFF',
    lector: 'Molinete-1-In',
    event_time: '2026-11-24 08:01:02',
    create_time: '2026-11-24 08:01:08.123',
    ...extra
});

test('un envío bien formado pasa', () => {
    assert.deepEqual(validarEnvioMolinete({ marcaciones: [marcacion(), marcacion({ unique_key: 77, pin: 5, cedula: 9000000003 })] }), []);
    // create_time sin milisegundos y campos opcionales en null también sirven.
    assert.deepEqual(validarEnvioMolinete({ marcaciones: [marcacion({ create_time: '2026-11-24 08:01:08', pin: null, lector: null })] }), []);
});

test('la forma del cuerpo se valida', () => {
    assert.equal(validarEnvioMolinete(null).length, 1);
    assert.equal(validarEnvioMolinete({ registros: [] }).length, 1);
    assert.match(validarEnvioMolinete({ marcaciones: [] })[0], /vacío/);
    const muchas = Array.from({ length: 501 }, (_, i) => marcacion({ unique_key: String(i) }));
    assert.match(validarEnvioMolinete({ marcaciones: muchas })[0], /500/);
});

test('cada marcación necesita su llave y sus horas en hora de Bogotá sin zona', () => {
    const errores = validarEnvioMolinete({
        marcaciones: [
            marcacion({ unique_key: '' }),
            marcacion({ event_time: '2026-11-24T13:01:02Z' }),
            marcacion({ create_time: null }),
            'no soy objeto'
        ]
    });
    assert.equal(errores.length, 4);
    assert.match(errores[0], /marcaciones\[0\]\.unique_key/);
    assert.match(errores[1], /marcaciones\[1\]\.event_time/);
    assert.match(errores[2], /marcaciones\[2\]\.create_time/);
    assert.match(errores[3], /marcaciones\[3\] debe ser un objeto/);
});
