const { test } = require('node:test');
const assert = require('node:assert/strict');

const r = require('../../domain/asistencia/reporteHorasExtra');
const { rangoDelMes } = require('../../utils/fechaBogota');

test('reporte HE: periodo AAAA-MM', () => {
    assert.equal(r.esPeriodo('2026-10'), true);
    assert.equal(r.esPeriodo('2026-13'), false);
    assert.equal(r.esPeriodo('2026-1'), false);
    assert.equal(r.esPeriodo(undefined), false);
    assert.equal(r.periodoDe('2026-10-21'), '2026-10');
    assert.equal(r.esClase('extras_diurnas'), true);
    assert.equal(r.esClase('otra'), false);
});

test('reporte HE: rango del mes', () => {
    assert.deepEqual(rangoDelMes('2026-02'), { desde: '2026-02-01', hasta: '2026-02-28' });
    assert.deepEqual(rangoDelMes('2028-02'), { desde: '2028-02-01', hasta: '2028-02-29' });
    assert.deepEqual(rangoDelMes('2026-12'), { desde: '2026-12-01', hasta: '2026-12-31' });
});

test('reporte HE: total suma las 5 clases; horas extra solo diurnas, nocturnas y dominicales 115%', () => {
    // Fila de Juan Sebastián en el Excel V.3: 2 recargo + 5 diurnas + 6 dominicales 115% = 13.
    const f = { recargo_nocturno: 2, extras_diurnas: 5, extras_nocturnas: 0, dominicales_festivas: 0, extras_dominicales_festivas: 6 };
    assert.equal(r.totalHoras(f), 13);
    assert.equal(r.horasExtraDe(f), 11);
    assert.equal(r.horasDeMinutos(90), 1.5);
    assert.equal(r.horasDeMinutos(0), 0);
});

test('reporte HE: valor hora = salario / 240, 0 si no hay salario', () => {
    assert.equal(r.valorHora(2400000), 10000);
    assert.equal(r.valorHora(null), 0);
    assert.equal(r.valorHora(0), 0);
    assert.equal(r.DIVISOR_HORAS_MES, 240);
});

test('reporte HE: dinero por clase con los factores de ley', () => {
    const vh = 10000; // salario 2.400.000 / 240
    assert.equal(r.dineroDeClase('recargo_nocturno', 2, vh), 7000); // 2 x 10000 x 0.35
    assert.equal(r.dineroDeClase('extras_diurnas', 5, vh), 62500); // 5 x 10000 x 1.25
    assert.equal(r.dineroDeClase('extras_nocturnas', 1, vh), 17500); // 1 x 10000 x 1.75
    assert.equal(r.dineroDeClase('dominicales_festivas', 3, vh), 27000); // 3 x 10000 x 0.90
    assert.equal(r.dineroDeClase('extras_dominicales_festivas', 6, vh), 129000); // 6 x 10000 x 2.15
    assert.equal(r.dineroDeClase('extras_diurnas', 0, vh), 0);
});

test('reporte HE: dinero total de una fila suma las 5 clases', () => {
    const vh = r.valorHora(2400000);
    const fila = { recargo_nocturno: 2, extras_diurnas: 5, extras_nocturnas: 0, dominicales_festivas: 0, extras_dominicales_festivas: 6 };
    // 7000 + 62500 + 0 + 0 + 129000
    assert.equal(r.dineroDeFila(fila, vh), 198500);
});

test('reporte HE: filaReporte pasa minutos a horas y, con dinero, agrega pesos', () => {
    const base = { users_company_id: 8, nombre: 'Ana', salario: 2400000, idcampania: 4, campania: 'Claro' };
    const minutos = { extras_diurnas: 90, recargo_nocturno: 120 }; // 1.5 h y 2 h

    const sinDinero = r.filaReporte(base, minutos);
    assert.equal(sinDinero.extras_diurnas, 1.5);
    assert.equal(sinDinero.recargo_nocturno, 2);
    assert.equal(sinDinero.extras_nocturnas, 0);
    assert.equal(sinDinero.total_horas, 3.5);
    assert.equal(sinDinero.total_dinero, undefined);
    assert.equal(sinDinero.campania, 'Claro');

    const conDinero = r.filaReporte(base, minutos, { conDinero: true });
    assert.equal(conDinero.valor_hora, 10000);
    assert.equal(conDinero.extras_diurnas_dinero, 18750); // 1.5 x 10000 x 1.25
    assert.equal(conDinero.recargo_nocturno_dinero, 7000); // 2 x 10000 x 0.35
    assert.equal(conDinero.total_dinero, 25750);
});

test('reporte HE: sin salario, las horas salen pero el dinero es 0', () => {
    const base = { users_company_id: 9, nombre: 'Beto', salario: null };
    const fila = r.filaReporte(base, { extras_diurnas: 60 }, { conDinero: true });
    assert.equal(fila.extras_diurnas, 1);
    assert.equal(fila.valor_hora, 0);
    assert.equal(fila.total_dinero, 0);
});

test('reporte HE: totales de varias filas (horas y dinero)', () => {
    const vh = r.valorHora(2400000);
    const filas = [
        r.filaReporte({ users_company_id: 1, salario: 2400000 }, { extras_diurnas: 60 }, { conDinero: true }),
        r.filaReporte({ users_company_id: 2, salario: 2400000 }, { extras_diurnas: 120, recargo_nocturno: 60 }, { conDinero: true })
    ];
    const t = r.totalesDe(filas);
    assert.equal(t.extras_diurnas, 3); // 1 + 2
    assert.equal(t.recargo_nocturno, 1);
    assert.equal(t.total_horas, 4);
    assert.equal(t.empleados, 2);
    // dinero: (1+2) h diurnas x 1.25 x vh + 1 h recargo x 0.35 x vh
    assert.equal(t.total_dinero, r.dineroDeClase('extras_diurnas', 3, vh) + r.dineroDeClase('recargo_nocturno', 1, vh));
});

test('reporte HE: totales sin dinero no incluye total_dinero', () => {
    const filas = [r.filaReporte({ users_company_id: 1 }, { extras_diurnas: 60 })];
    const t = r.totalesDe(filas);
    assert.equal(t.total_horas, 1);
    assert.equal('total_dinero' in t, false);
});
