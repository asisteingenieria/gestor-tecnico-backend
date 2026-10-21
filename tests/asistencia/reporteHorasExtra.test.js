const { test } = require('node:test');
const assert = require('node:assert/strict');

const r = require('../../domain/asistencia/reporteHorasExtra');
const { sumarDias, rangoDelMes } = require('../../utils/fechaBogota');

const contexto = (minutosAprobadosPor = {}) => ({
    equipo: new Set([7, 8, 9]),
    minutosAprobadosPor,
    nombrePor: { 7: 'Ana', 8: 'Beto', 9: 'Caro' }
});
const fila = (id, horas = {}, aclaraciones = null) => ({
    users_company_id: id,
    recargo_nocturno: 0, extras_diurnas: 0, extras_nocturnas: 0, dominicales_festivas: 0, extras_dominicales_festivas: 0,
    ...horas,
    aclaraciones
});

test('reporte HE: periodo AAAA-MM', () => {
    assert.equal(r.esPeriodo('2026-10'), true);
    assert.equal(r.esPeriodo('2026-13'), false);
    assert.equal(r.esPeriodo('2026-1'), false);
    assert.equal(r.esPeriodo(undefined), false);
    assert.equal(r.periodoDe('2026-10-21'), '2026-10');
});

test('reporte HE: rango del mes y suma de días', () => {
    assert.deepEqual(rangoDelMes('2026-02'), { desde: '2026-02-01', hasta: '2026-02-28' });
    assert.deepEqual(rangoDelMes('2028-02'), { desde: '2028-02-01', hasta: '2028-02-29' });
    assert.deepEqual(rangoDelMes('2026-12'), { desde: '2026-12-01', hasta: '2026-12-31' });
    assert.equal(sumarDias('2026-10-01', -3), '2026-09-28');
    assert.equal(sumarDias('2026-12-30', 3), '2027-01-02');
});

test('reporte HE: total suma las 5 clases; horas extra solo diurnas, nocturnas y dominicales 115%', () => {
    // Fila de Juan Sebastián en el Excel V.3: 2 recargo + 5 diurnas + 6 dominicales 115% = 13.
    const f = fila(7, { recargo_nocturno: 2, extras_diurnas: 5, extras_dominicales_festivas: 6 });
    assert.equal(r.totalHoras(f), 13);
    assert.equal(r.horasExtraDe(f), 11);
    assert.equal(r.horasDeMinutos(90), 1.5);
});

test('reporte HE: normalizar descarta filas vacías salvo con horas aprobadas o aclaración', () => {
    const filas = r.normalizarFilas([
        { users_company_id: '7', extras_diurnas: '1.255' },
        { users_company_id: 8 },
        { users_company_id: 9, aclaraciones: '  sin novedad  ' },
        { users_company_id: 10 }
    ], { 10: 60 });
    assert.deepEqual(filas.map((f) => f.users_company_id), [7, 9, 10]);
    assert.equal(filas[0].extras_diurnas, 1.26);
    assert.equal(filas[0].recargo_nocturno, 0);
    assert.equal(filas[1].aclaraciones, 'sin novedad');
});

test('reporte HE: al guardar no exige cuadre; al enviar sí', () => {
    const filas = [fila(7, { extras_diurnas: 2 })];
    assert.deepEqual(r.erroresDelReporte(filas, contexto({ 7: 180 }), { exigirCuadre: false }), []);
    const errores = r.erroresDelReporte(filas, contexto({ 7: 180 }), { exigirCuadre: true });
    assert.equal(errores.length, 1);
    assert.match(errores[0], /Ana: tiene 3 h extra aprobadas.*reparte 2 h/);
});

test('reporte HE: cuadra repartiendo entre las 3 clases de extra; los recargos no cuentan', () => {
    const filas = [fila(7, { extras_diurnas: 1, extras_nocturnas: 1.5, extras_dominicales_festivas: 0.5, recargo_nocturno: 4, dominicales_festivas: 8 })];
    assert.deepEqual(r.erroresDelReporte(filas, contexto({ 7: 180 }), { exigirCuadre: true }), []);
});

test('reporte HE: solo recargos sin horas aprobadas es válido', () => {
    const filas = [fila(8, { recargo_nocturno: 6 })];
    assert.deepEqual(r.erroresDelReporte(filas, contexto({}), { exigirCuadre: true }), []);
});

test('reporte HE: quien tiene horas aprobadas no puede faltar al enviar', () => {
    const errores = r.erroresDelReporte([], contexto({ 9: 120 }), { exigirCuadre: true });
    assert.deepEqual(errores, ['Caro tiene 2 h extra aprobadas en el mes y no está en el reporte']);
});

test('reporte HE: fuera del equipo, repetidos y horas inválidas', () => {
    const errores = r.erroresDelReporte(
        [fila(99), fila(7), fila(7), fila(8, { extras_diurnas: -1 }), fila(9, { recargo_nocturno: 800 })],
        contexto({}),
        { exigirCuadre: false }
    );
    assert.equal(errores.length, 4);
    assert.match(errores[0], /ficha 99 no está a su cargo/);
    assert.match(errores[1], /Ana está repetido/);
    assert.match(errores[2], /Beto: las horas/);
    assert.match(errores[3], /Caro: las horas/);
});

test('reporte HE: estados que se editan y se revisan', () => {
    assert.equal(r.puedeEditarse(undefined), true);
    assert.equal(r.puedeEditarse('borrador'), true);
    assert.equal(r.puedeEditarse('devuelto'), true);
    assert.equal(r.puedeEditarse('enviado'), false);
    assert.equal(r.puedeEditarse('aprobado'), false);
    assert.equal(r.puedeRevisarse('enviado'), true);
    assert.equal(r.puedeRevisarse('devuelto'), false);
});

test('reporte HE: fuera de plazo y recordatorio', () => {
    assert.equal(r.fueraDePlazo('2026-11-05', '2026-11-05'), false);
    assert.equal(r.fueraDePlazo('2026-11-06', '2026-11-05'), true);
    assert.equal(r.fueraDePlazo(null, '2026-11-05'), false);
    assert.equal(r.fueraDePlazo('2026-11-06', null), false);

    const desdeAviso = '2026-11-02';
    assert.equal(r.debeRecordar({ estado: undefined, hoy: '2026-11-01', desdeAviso }), false);
    assert.equal(r.debeRecordar({ estado: undefined, hoy: '2026-11-02', desdeAviso }), true);
    assert.equal(r.debeRecordar({ estado: 'borrador', hoy: '2026-11-10', desdeAviso }), true);
    assert.equal(r.debeRecordar({ estado: 'enviado', hoy: '2026-11-10', desdeAviso }), false);
    assert.equal(r.debeRecordar({ estado: 'aprobado', hoy: '2026-11-10', desdeAviso }), false);
});
