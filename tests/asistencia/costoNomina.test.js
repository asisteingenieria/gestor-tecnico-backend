const { test } = require('node:test');
const assert = require('node:assert/strict');

const { diasEnMes, ibcMensual, salarioMinimoDe, auxilioTransporteDe, costoDelMes, historico } = require('../../domain/asistencia/costoNomina');

const FACTORES = [
    { codigo: 'cesantias', nombre: 'Cesantías', porcentaje: 8.33 },
    { codigo: 'intereses_cesantias', nombre: 'Intereses', porcentaje: 1 },
    { codigo: 'prima', nombre: 'Prima', porcentaje: 8.33 },
    { codigo: 'vacaciones', nombre: 'Vacaciones', porcentaje: 4.17 }
];
const tramo = (extra) => ({ users_company_id: 1, idcampania: 7, campania: 'HOGAR', desde: '2026-01-01', hasta: '9999-12-31', salario: 3000000, bonos: 0, ...extra });

test('diasEnMes: mes completo = 30 aunque tenga 31 o 28 días', () => {
    assert.equal(diasEnMes(tramo(), '2026-10'), 30);
    assert.equal(diasEnMes(tramo(), '2026-02'), 30);
    assert.equal(diasEnMes(tramo(), '2026-09'), 30);
});

test('diasEnMes: ingreso y retiro a mitad de mes, y fuera del mes', () => {
    assert.equal(diasEnMes(tramo({ desde: '2026-10-16' }), '2026-10'), 15);
    assert.equal(diasEnMes(tramo({ hasta: '2026-10-10' }), '2026-10'), 10);
    assert.equal(diasEnMes(tramo({ desde: '2026-10-31' }), '2026-10'), 1);
    assert.equal(diasEnMes(tramo({ desde: '2026-11-01' }), '2026-10'), 0);
    assert.equal(diasEnMes(tramo({ hasta: '2026-09-30' }), '2026-10'), 0);
});

test('diasEnMes: el corte limita a lo causado a la fecha', () => {
    assert.equal(diasEnMes(tramo(), '2026-10', '2026-10-23'), 23);
    assert.equal(diasEnMes(tramo(), '2026-02', '2026-02-28'), 30);
    assert.equal(diasEnMes(tramo({ desde: '2026-10-20' }), '2026-10', '2026-10-23'), 4);
});

test('costoDelMes: prestaciones = 21,83 % del salario; los bonos no son base', () => {
    const r = costoDelMes([tramo({ bonos: 200000 })], FACTORES, '2026-10');
    assert.equal(r.salarios, 3000000);
    assert.equal(r.bonos, 200000);
    assert.equal(r.prestaciones, 249900 + 30000 + 249900 + 125100);
    assert.equal(r.total, 3000000 + 654900 + 200000);
    assert.equal(r.empleados, 1);
    assert.deepEqual(r.detalle_prestaciones.map((d) => d.valor), [249900, 30000, 249900, 125100]);
});

test('costoDelMes: un cambio de salario a mitad de mes se prorratea por tramos y por campaña', () => {
    const r = costoDelMes([
        tramo({ hasta: '2026-10-14', salario: 1500000 }),
        tramo({ desde: '2026-10-15', salario: 3000000 }),
        tramo({ users_company_id: 2, idcampania: 5, campania: 'T&T', salario: 2000000 })
    ], FACTORES, '2026-10');
    assert.equal(r.salarios, 700000 + 1600000 + 2000000);
    assert.equal(r.empleados, 2);
    assert.deepEqual(r.por_campania.map((c) => [c.campania, c.salarios, c.empleados]), [['HOGAR', 2300000, 1], ['T&T', 2000000, 1]]);
});

test('historico: no calcula meses futuros y el mes en curso trae proyectado y causado', () => {
    const h = historico([tramo()], FACTORES, ['2026-09', '2026-10', '2026-11'], '2026-10-15');
    assert.deepEqual(h.map((m) => m.periodo), ['2026-09', '2026-10']);
    assert.equal(h[0].en_curso, false);
    assert.equal(h[0].causado, undefined);
    assert.equal(h[1].en_curso, true);
    assert.equal(h[1].salarios, 3000000);
    assert.equal(h[1].causado.salarios, 1500000);
});

const APORTES = [
    { codigo: 'salud', nombre: 'Salud', categoria: 'aporte', porcentaje: 8.5, exonerable: true },
    { codigo: 'pension', nombre: 'Pensión', categoria: 'aporte', porcentaje: 12, exonerable: false },
    { codigo: 'arl', nombre: 'ARL', categoria: 'aporte', porcentaje: 0.522, exonerable: false },
    { codigo: 'caja', nombre: 'Caja', categoria: 'aporte', porcentaje: 4, exonerable: false },
    { codigo: 'icbf', nombre: 'ICBF', categoria: 'aporte', porcentaje: 3, exonerable: true },
    { codigo: 'sena', nombre: 'SENA', categoria: 'aporte', porcentaje: 2, exonerable: true }
];
const SMMLV = [{ anio: 2025, valor: 1423500 }, { anio: 2026, valor: 1750905 }];

test('ibcMensual: los bonos solo suman en lo que pasen del 40 % de la remuneración', () => {
    assert.equal(ibcMensual(3000000, 200000), 3000000);
    assert.equal(ibcMensual(1000000, 1000000), 1200000);
});

test('salarioMinimoDe: usa el del año o el último cargado antes; sin datos, null', () => {
    assert.equal(salarioMinimoDe(SMMLV, 2026), 1750905);
    assert.equal(salarioMinimoDe(SMMLV, 2027), 1750905);
    assert.equal(salarioMinimoDe(SMMLV, 2024), null);
});

test('aportes: bajo 10 SMMLV salud, ICBF y SENA quedan exonerados; ARL con la tarifa del empleado', () => {
    const r = costoDelMes([tramo({ tarifa_arl: 2.436 })], [...FACTORES, ...APORTES], '2026-10', { salariosMinimos: SMMLV });
    const valor = (c) => r.detalle_aportes.find((d) => d.codigo === c).valor;
    assert.equal(valor('salud'), 0);
    assert.equal(valor('icbf'), 0);
    assert.equal(valor('sena'), 0);
    assert.equal(valor('pension'), 360000);
    assert.equal(valor('arl'), 73080);
    assert.equal(valor('caja'), 120000);
    assert.equal(r.aportes, 553080);
    assert.equal(r.total, 3000000 + 654900 + 553080);
});

test('aportes: sobre 10 SMMLV se paga todo; tarifa ARL inválida usa la del factor', () => {
    const r = costoDelMes([tramo({ salario: 20000000, tarifa_arl: 80 })], APORTES, '2026-10', { salariosMinimos: SMMLV });
    assert.equal(r.aportes, Math.round(20000000 * (8.5 + 12 + 0.522 + 4 + 3 + 2) / 100));
    assert.equal(r.detalle_aportes.find((d) => d.codigo === 'arl').porcentaje_efectivo, 0.522);
});

test('aportes: sin SMMLV cargado no se exonera (estimación conservadora)', () => {
    const r = costoDelMes([tramo()], APORTES, '2026-10');
    assert.equal(r.detalle_aportes.find((d) => d.codigo === 'salud').valor, 255000);
});

const SMMLV_AUX = [{ anio: 2025, valor: 1423500, auxilio_transporte: 200000 }, { anio: 2026, valor: 1750905, auxilio_transporte: 249095 }];
const PRESTACIONES_AUX = FACTORES.map((f) => ({ ...f, categoria: 'prestacion', incluye_auxilio: f.codigo !== 'vacaciones' }));

test('auxilioTransporteDe: usa el del año o el último cargado antes', () => {
    assert.equal(auxilioTransporteDe(SMMLV_AUX, 2026), 249095);
    assert.equal(auxilioTransporteDe(SMMLV_AUX, 2027), 249095);
    assert.equal(auxilioTransporteDe(SMMLV_AUX, 2024), null);
});

test('auxilio: hasta 2 SMMLV se paga prorrateado y es base de cesantías, intereses y prima, no de vacaciones', () => {
    const r = costoDelMes([tramo({ salario: 2000000, desde: '2026-10-16' })], PRESTACIONES_AUX, '2026-10', { salariosMinimos: SMMLV_AUX });
    const aux = 249095 / 2;
    assert.equal(r.auxilio_transporte, Math.round(aux));
    assert.equal(r.empleados_con_auxilio, 1);
    const valor = (c) => r.detalle_prestaciones.find((d) => d.codigo === c).valor;
    assert.equal(valor('cesantias'), Math.round(((1000000 + aux) * 8.33) / 100));
    assert.equal(valor('vacaciones'), Math.round((1000000 * 4.17) / 100));
    assert.equal(r.total, r.salarios + r.auxilio_transporte + r.prestaciones);
});

test('auxilio: sobre 2 SMMLV no se paga, ni sin SMMLV cargado; no es base de aportes', () => {
    const alto = costoDelMes([tramo({ salario: 3600000 })], PRESTACIONES_AUX, '2026-10', { salariosMinimos: SMMLV_AUX });
    assert.equal(alto.auxilio_transporte, 0);
    assert.equal(costoDelMes([tramo({ salario: 2000000 })], PRESTACIONES_AUX, '2026-10').auxilio_transporte, 0);
    const conAportes = costoDelMes([tramo({ salario: 2000000 })], APORTES, '2026-10', { salariosMinimos: SMMLV_AUX });
    assert.equal(conAportes.detalle_aportes.find((d) => d.codigo === 'pension').valor, 240000);
});
