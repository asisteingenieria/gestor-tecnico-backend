const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resumenHoraExtra } = require('../../domain/asistencia/resumenHoraExtra');
const { combinarFechaHora } = require('../../utils/fechaBogota');

const FECHA = '2026-10-23';
const HORARIO = { fecha: FECHA, hora_entrada: '08:00:00', hora_salida: '17:00:00' };
const h = (hhmmss) => combinarFechaHora(FECHA, hhmmss);
const ev = (tipo, hora) => ({ tipo, ocurrido_en: h(hora) });
const HE = (ini, fin) => ({ idhora_extra: 1, hora_inicio: ini, hora_fin: fin, minutos_aprobados: 120, creado_en: '2026-10-23T20:40:00Z', fecha_decision: '2026-10-23T21:10:00Z' });

test('sin horas extra aprobadas → null', () => {
    assert.equal(resumenHoraExtra({ eventos: [ev('entrada', '08:00:00')], horario: HORARIO, horasExtraAprobadas: [], fecha: FECHA, ahora: h('18:00:00') }), null);
});

test('extra pegada al turno: desde la salida programada hasta la salida real', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '18:30:00')];
    const r = resumenHoraExtra({ eventos, horario: HORARIO, horasExtraAprobadas: [HE('17:00:00', '19:00:00')], fecha: FECHA, ahora: h('18:30:00') });
    assert.equal(r.extra.contiguo, true);
    assert.equal(r.extra.minutos, 90); // 17:00 → 18:30
    assert.equal(r.extra.excedio_min, 0);
});

test('extra pegada con desborde del fin aprobado', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '19:30:00')];
    const r = resumenHoraExtra({ eventos, horario: HORARIO, horasExtraAprobadas: [HE('17:00:00', '19:00:00')], fecha: FECHA, ahora: h('19:30:00') });
    assert.equal(r.extra.excedio_min, 30); // siguió 30 min más allá de las 19:00
});

test('extra en bloque aparte (reapertura): toma la hora real de ingreso y de salida', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00'), ev('inicio_extra', '19:03:00'), ev('fin_extra', '21:10:00')];
    const r = resumenHoraExtra({ eventos, horario: HORARIO, horasExtraAprobadas: [HE('19:00:00', '21:00:00')], fecha: FECHA, ahora: h('21:30:00') });
    assert.equal(r.extra.contiguo, false);
    assert.equal(r.extra.en_curso, false);
    assert.equal(r.extra.minutos, 127); // 19:03 → 21:10
    assert.equal(r.extra.excedio_min, 10); // 10 min más allá de las 21:00
});

test('extra en curso pegada al turno (todavía trabajando)', () => {
    const eventos = [ev('entrada', '08:00:00')];
    const r = resumenHoraExtra({ eventos, horario: HORARIO, horasExtraAprobadas: [HE('17:00:00', '19:00:00')], fecha: FECHA, ahora: h('18:00:00') });
    assert.equal(r.extra.en_curso, true);
    assert.equal(r.extra.contiguo, true);
    assert.equal(r.extra.minutos, 60); // 17:00 → 18:00 (ahora)
});

test('solicitudes traen franja, tramos y marcas de tiempo', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '18:30:00')];
    const r = resumenHoraExtra({
        eventos, horario: HORARIO, horasExtraAprobadas: [HE('17:00:00', '19:00:00')],
        tramosPorHe: { 1: [{ clase: 'extras_nocturnas', minutos: 120 }] }, fecha: FECHA, ahora: h('18:30:00')
    });
    assert.equal(r.solicitudes.length, 1);
    assert.equal(r.solicitudes[0].hora_inicio, '17:00');
    assert.equal(r.solicitudes[0].hora_fin, '19:00');
    assert.deepEqual(r.solicitudes[0].tramos, [{ clase: 'extras_nocturnas', minutos: 120 }]);
    assert.ok(r.solicitudes[0].aprobado_en);
});
