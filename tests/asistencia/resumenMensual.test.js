const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resumenDeJornadas, totalesEquipo } = require('../../domain/asistencia/resumenMensual');

const j = (fecha, estado, extra = {}) => ({
    fecha, estado,
    minutos_tarde: 0, minutos_trabajados: 0, minutos_extra: 0,
    minutos_pausa_bano: 0, minutos_break: 0, minutos_pausa_almuerzo: 0, minutos_capacitacion: 0,
    minutos_salida_anticipada: 0, ...extra
});

test('resumen de jornadas: cuenta trabajados, ausencias, tarde y puntualidad', () => {
    const r = resumenDeJornadas([
        j('2026-10-01', 'finalizada', { minutos_trabajados: 480 }),
        j('2026-10-02', 'finalizada', { minutos_trabajados: 470, minutos_tarde: 10 }),
        j('2026-10-03', 'ausente'),
        j('2026-10-04', 'pendiente')
    ]);
    assert.equal(r.dias_trabajados, 2);
    assert.equal(r.ausencias, 1);
    assert.equal(r.dias_tarde, 1);
    assert.equal(r.dias_puntuales, 1);
    assert.equal(r.porcentaje_puntualidad, 50);
    assert.equal(r.minutos_trabajados, 950);
    assert.equal(r.minutos_tarde, 10);
    assert.equal(r.dias.length, 4);
    assert.equal(r.dias[0].estado, 'finalizada');
});

test('resumen suma las pausas por tipo (break y capacitación aparte)', () => {
    const r = resumenDeJornadas([
        j('2026-10-01', 'finalizada', { minutos_pausa_bano: 20, minutos_break: 15, minutos_pausa_almuerzo: 60, minutos_capacitacion: 90, minutos_extra: 30 })
    ]);
    assert.equal(r.minutos_bano, 20);
    assert.equal(r.minutos_break, 15);
    assert.equal(r.minutos_almuerzo, 60);
    assert.equal(r.minutos_capacitacion, 90);
    assert.equal(r.minutos_extra, 30);
});

test('fecha de celda se normaliza a YYYY-MM-DD aunque venga como Date', () => {
    const r = resumenDeJornadas([j(new Date('2026-10-05T00:00:00Z'), 'finalizada')]);
    assert.equal(r.dias[0].fecha, '2026-10-05');
});

test('totales del equipo suman por empleado y promedian la puntualidad global', () => {
    const e1 = resumenDeJornadas([j('2026-10-01', 'finalizada', { minutos_trabajados: 480 }), j('2026-10-02', 'ausente')]);
    const e2 = resumenDeJornadas([j('2026-10-01', 'finalizada', { minutos_trabajados: 470, minutos_tarde: 10 })]);
    const t = totalesEquipo([e1, e2]);
    assert.equal(t.empleados, 2);
    assert.equal(t.dias_trabajados, 2);
    assert.equal(t.ausencias, 1);
    assert.equal(t.minutos_trabajados, 950);
    assert.equal(t.porcentaje_puntualidad, 50); // 1 puntual de 2 días trabajados
});
