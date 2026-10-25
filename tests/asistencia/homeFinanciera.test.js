const { test } = require('node:test');
const assert = require('node:assert/strict');

const { variacionPct, deltaPp, unirPorCampania, hallazgos, META_PUNTUALIDAD } = require('../../domain/asistencia/homeFinanciera');
const { sumarMeses, periodosHasta } = require('../../utils/fechaBogota');

const kpisBase = (extra = {}) => ({
    nomina: { total: 10000000, sin_salario: 0, ...extra.nomina },
    horas_extra: { dinero: 0, dinero_anterior: 0, variacion_pct: null, ...extra.horas_extra },
    dotacion: { activos: 10, ingresos_mes: 0, retiros_mes: 0, ...extra.dotacion },
    asistencia: { puntualidad: 95, puntualidad_anterior: 95, delta_pp: 0, ...extra.asistencia }
});

test('variacionPct: porcentaje con un decimal y null sin base', () => {
    assert.equal(variacionPct(150, 100), 50);
    assert.equal(variacionPct(90, 120), -25);
    assert.equal(variacionPct(1, 3), -66.7);
    assert.equal(variacionPct(100, 0), null);
    assert.equal(variacionPct(100, null), null);
});

test('deltaPp: diferencia en puntos y null si falta un lado', () => {
    assert.equal(deltaPp(88, 92), -4);
    assert.equal(deltaPp(null, 92), null);
    assert.equal(deltaPp(90, null), null);
});

test('meses: sumarMeses cruza el año y periodosHasta va del más antiguo al actual', () => {
    assert.equal(sumarMeses('2026-01', -1), '2025-12');
    assert.equal(sumarMeses('2026-12', 1), '2027-01');
    assert.deepEqual(periodosHasta('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
});

test('unirPorCampania: junta dotación, costo, asistencia y horas extra; ordena por costo total', () => {
    const filas = unirPorCampania({
        nomina: [
            { idcampania: 1, campania: 'HOGAR', empleados: 5, sin_salario: 0 },
            { idcampania: 2, campania: 'T&T', empleados: 3, sin_salario: 1 }
        ],
        costos: [
            { idcampania: 1, campania: 'HOGAR', salarios: 7000000, prestaciones: 1528100, bonos: 500000, total: 9028100, empleados: 5 },
            { idcampania: 2, campania: 'T&T', salarios: 9000000, prestaciones: 1964700, bonos: 0, total: 10964700, empleados: 3 }
        ],
        asistencia: [{ idcampania: 1, campania: 'HOGAR', totales: { porcentaje_puntualidad: 80, ausencias: 2, dias_trabajados: 40, empleados: 5 } }],
        horasExtra: [
            { idcampania: 1, campania: 'HOGAR', totales: { total_dinero: 120000, total_horas: 6 } },
            { idcampania: 9, campania: 'RETIRADA', totales: { total_dinero: 5000, total_horas: 1 } }
        ]
    });
    assert.deepEqual(filas.map((f) => f.campania), ['T&T', 'HOGAR', 'RETIRADA']);
    const hogar = filas.find((f) => f.idcampania === 1);
    assert.equal(hogar.costo_total, 9028100);
    assert.equal(hogar.prestaciones, 1528100);
    assert.equal(filas.find((f) => f.idcampania === 2).sin_salario, 1);
    assert.equal(hogar.puntualidad, 80);
    assert.equal(hogar.dinero_extra, 120000);
    assert.equal(filas.find((f) => f.idcampania === 2).puntualidad, null);
    assert.equal(filas.find((f) => f.idcampania === 9).dinero_extra, 5000);
});

test('hallazgos: sin novedades relevantes no dice nada', () => {
    assert.deepEqual(hallazgos({ kpis: kpisBase(), porCampania: [] }), []);
});

test('hallazgos: alertas primero (costo, puntualidad, campañas bajo meta, sin salario)', () => {
    const r = hallazgos({
        kpis: kpisBase({
            nomina: { sin_salario: 2 },
            horas_extra: { dinero: 300000, dinero_anterior: 200000, variacion_pct: 50 },
            asistencia: { puntualidad: 85, puntualidad_anterior: 91, delta_pp: -6 }
        }),
        porCampania: [
            { campania: 'HOGAR', puntualidad: 70, dinero_extra: 250000 },
            { campania: 'T&T', puntualidad: 95, dinero_extra: 50000 }
        ],
        nombreMesAnterior: 'septiembre 2026'
    });
    assert.ok(r.length >= 5);
    assert.equal(r[0].nivel, 'alerta');
    assert.match(r[0].texto, /subió 50 % frente a septiembre 2026/);
    assert.ok(r.some((h) => /cayó 6 puntos/.test(h.texto)));
    assert.ok(r.some((h) => new RegExp(`1 campaña por debajo del ${META_PUNTUALIDAD} % de puntualidad: Hogar \\(70 %\\)`).test(h.texto)));
    assert.ok(r.some((h) => /2 empleados activos sin salario/.test(h.texto)));
    assert.ok(r.some((h) => h.nivel === 'info' && /Hogar concentra el 83.3 %/.test(h.texto)));
    const niveles = r.map((h) => h.nivel);
    assert.deepEqual(niveles, [...niveles].sort((a, b) => ['alerta', 'bueno', 'info'].indexOf(a) - ['alerta', 'bueno', 'info'].indexOf(b)));
});

test('hallazgos: una baja de costo y una mejora de puntualidad salen como "bueno"', () => {
    const r = hallazgos({
        kpis: kpisBase({
            horas_extra: { dinero: 80000, dinero_anterior: 100000, variacion_pct: -20 },
            asistencia: { puntualidad: 96, puntualidad_anterior: 90, delta_pp: 6 }
        }),
        porCampania: []
    });
    assert.ok(r.some((h) => h.nivel === 'bueno' && /bajó 20 %/.test(h.texto)));
    assert.ok(r.some((h) => h.nivel === 'bueno' && /mejoró 6 puntos/.test(h.texto)));
});

test('hallazgos: variaciones pequeñas no se reportan y más retiros que ingresos sí', () => {
    const r = hallazgos({
        kpis: kpisBase({
            horas_extra: { dinero: 105000, dinero_anterior: 100000, variacion_pct: 5 },
            dotacion: { ingresos_mes: 1, retiros_mes: 4 }
        }),
        porCampania: []
    });
    assert.ok(!r.some((h) => /costo de horas extra/.test(h.texto)));
    assert.ok(r.some((h) => /salieron más personas \(4\) de las que ingresaron \(1\)/.test(h.texto)));
});

test('hallazgos: en el mes en curso no compara el costo contra el mes anterior completo', () => {
    const r = hallazgos({
        kpis: kpisBase({ horas_extra: { dinero: 0, dinero_anterior: 100000, variacion_pct: -100 } }),
        porCampania: [],
        mesEnCurso: true
    });
    assert.ok(!r.some((h) => /costo de horas extra/.test(h.texto)));
});

test('hallazgos: una fracción mínima de la nómina se dice "menos del 0,1 %"', () => {
    const r = hallazgos({ kpis: kpisBase({ horas_extra: { dinero: 2000 } }), porCampania: [] });
    assert.ok(r.some((h) => /equivalen a menos del 0,1 % del costo total de nómina/.test(h.texto)));
});

test('hallazgos: el costo total de nómina se reporta desde un 5 % de cambio', () => {
    const con = hallazgos({ kpis: kpisBase({ nomina: { total: 1060000, total_anterior: 1000000, variacion_pct: 6 } }), porCampania: [], nombreMesAnterior: 'septiembre 2026' });
    assert.ok(con.some((h) => /costo total de nómina sube 6 % frente a septiembre 2026 \(\$ 1\.000\.000 → \$ 1\.060\.000\)/.test(h.texto)));
    const sin = hallazgos({ kpis: kpisBase({ nomina: { variacion_pct: 2.1 } }), porCampania: [] });
    assert.ok(!sin.some((h) => /costo total de nómina/.test(h.texto)));
});
