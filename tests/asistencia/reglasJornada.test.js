const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ReglaAsistenciaError } = require('../../errors/AppError');
const {
    assertPuedeIniciarPausa,
    assertPuedeFinalizarPausa,
    assertPuedeMarcarSalida
} = require('../../domain/asistencia/reglasJornada');

function estado(overrides) {
    return {
        estado: 'en_curso',
        pausaActiva: null,
        puedeMarcarSalida: false,
        ...overrides
    };
}

test('assertPuedeIniciarPausa rechaza sin entrada marcada', () => {
    assert.throws(() => assertPuedeIniciarPausa(estado({ estado: 'pendiente' }), 'bano'), ReglaAsistenciaError);
});

test('assertPuedeIniciarPausa rechaza jornada finalizada', () => {
    assert.throws(() => assertPuedeIniciarPausa(estado({ estado: 'finalizada' }), 'bano'), ReglaAsistenciaError);
});

test('assertPuedeIniciarPausa rechaza una segunda pausa mientras hay una activa', () => {
    const activa = estado({ pausaActiva: { tipo: 'bano' } });
    assert.throws(() => assertPuedeIniciarPausa(activa, 'almuerzo'), ReglaAsistenciaError);
});

test('assertPuedeIniciarPausa permite iniciar cuando la jornada está en curso y sin pausa activa', () => {
    assert.doesNotThrow(() => assertPuedeIniciarPausa(estado(), 'bano'));
});

test('assertPuedeFinalizarPausa rechaza si no hay pausa activa', () => {
    assert.throws(() => assertPuedeFinalizarPausa(estado(), 'bano'), ReglaAsistenciaError);
});

test('assertPuedeFinalizarPausa rechaza cerrar un tipo distinto al activo', () => {
    const activa = estado({ pausaActiva: { tipo: 'bano' } });
    assert.throws(() => assertPuedeFinalizarPausa(activa, 'almuerzo'), ReglaAsistenciaError);
});

test('assertPuedeFinalizarPausa permite cerrar la pausa activa del mismo tipo', () => {
    const activa = estado({ pausaActiva: { tipo: 'bano' } });
    assert.doesNotThrow(() => assertPuedeFinalizarPausa(activa, 'bano'));
});

test('assertPuedeMarcarSalida rechaza sin entrada marcada', () => {
    assert.throws(() => assertPuedeMarcarSalida(estado({ estado: 'pendiente' })), ReglaAsistenciaError);
});

test('assertPuedeMarcarSalida rechaza jornada ya finalizada', () => {
    assert.throws(() => assertPuedeMarcarSalida(estado({ estado: 'finalizada' })), ReglaAsistenciaError);
});

test('assertPuedeMarcarSalida rechaza fuera de la ventana habilitada', () => {
    assert.throws(() => assertPuedeMarcarSalida(estado({ puedeMarcarSalida: false })), ReglaAsistenciaError);
});

test('assertPuedeMarcarSalida permite dentro de la ventana habilitada', () => {
    assert.doesNotThrow(() => assertPuedeMarcarSalida(estado({ puedeMarcarSalida: true })));
});
