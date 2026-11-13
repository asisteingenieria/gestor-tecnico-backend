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

// "No ha llegado" en vivo (§62).
const { noHaLlegado } = require('../../domain/asistencia/reglasJornada');
const { combinarFechaHora: hora } = require('../../utils/fechaBogota');

test('no ha llegado: sin entrada y ya pasó la hora de entrada del turno', () => {
    const horario = { fecha: '2026-11-13', hora_entrada: '08:00:00', es_descanso: 0 };
    const pendiente = { estado: 'pendiente' };
    assert.equal(noHaLlegado(pendiente, horario, hora('2026-11-13', '07:59:59')), false);
    assert.equal(noHaLlegado(pendiente, horario, hora('2026-11-13', '08:00:00')), true);
    assert.equal(noHaLlegado({ estado: 'en_curso' }, horario, hora('2026-11-13', '09:00:00')), false);
});

test('no ha llegado: sin horario o en descanso no cuenta', () => {
    const ahora = hora('2026-11-13', '12:00:00');
    assert.equal(noHaLlegado({ estado: 'pendiente' }, null, ahora), false);
    assert.equal(noHaLlegado({ estado: 'pendiente' }, { fecha: '2026-11-13', hora_entrada: '00:00:00', es_descanso: 1 }, ahora), false);
});
