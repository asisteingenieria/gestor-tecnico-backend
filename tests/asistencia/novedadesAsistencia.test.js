const { test } = require('node:test');
const assert = require('node:assert/strict');

const { novedadDelDia, porEmpleado, novedadesPorFecha, cubreDiaCompleto, ajustarAgregado } = require('../../domain/asistencia/novedadesAsistencia');
const { resumenDeJornadas, totalesEquipo } = require('../../domain/asistencia/resumenMensual');

const incapacidad = { users_company_id: 7, idnovedad_rrhh: 1, tipo: 'Incapacidades origen comun 1- 2 días', fecha_inicial: new Date('2026-11-10T00:00:00Z'), fecha_final: new Date('2026-11-11T00:00:00Z') };
const votacion = { users_company_id: 7, idnovedad_rrhh: 2, tipo: 'Horas de votacion', fecha_inicial: '2026-11-12', fecha_final: null };
const vacaciones = { users_company_id: 8, idnovedad_rrhh: 3, tipo: 'Vacaciones', fecha_inicial: '2026-11-03', fecha_final: '2026-11-07' };

test('novedadDelDia: cubre del inicio al final, ambos incluidos', () => {
    assert.equal(novedadDelDia([incapacidad], '2026-11-09'), null);
    assert.deepEqual(novedadDelDia([incapacidad], '2026-11-10'), {
        id: 1, tipo: 'Incapacidades origen comun 1- 2 días', desde: '2026-11-10', hasta: '2026-11-11', cubre_dia: true
    });
    assert.equal(novedadDelDia([incapacidad], '2026-11-11').id, 1);
    assert.equal(novedadDelDia([incapacidad], '2026-11-12'), null);
});

test('novedadDelDia: sin fecha final es un solo día; las horas de votación no cubren el día', () => {
    const n = novedadDelDia([votacion], '2026-11-12');
    assert.equal(n.hasta, '2026-11-12');
    assert.equal(n.cubre_dia, false);
    assert.equal(cubreDiaCompleto({ tipo: 'HORAS DE VOTACIÓN' }), false);
    assert.equal(cubreDiaCompleto({ tipo: 'Suspensiones' }), true);
});

test('novedadDelDia: si dos se cruzan, gana la que cubre el día', () => {
    const otra = { ...votacion, fecha_inicial: '2026-11-10' };
    assert.equal(novedadDelDia([otra, incapacidad], '2026-11-10').id, 1);
});

test('porEmpleado y novedadesPorFecha', () => {
    const mapa = porEmpleado([incapacidad, votacion, vacaciones]);
    assert.equal(mapa.get(7).length, 2);
    assert.equal(mapa.get(8).length, 1);
    const dias = novedadesPorFecha(mapa.get(8), '2026-11-01', '2026-11-05');
    assert.deepEqual([...dias.keys()], ['2026-11-03', '2026-11-04', '2026-11-05']);
    assert.equal(novedadesPorFecha([], '2026-11-01', '2026-11-30').size, 0);
});

test('resumenDeJornadas: un ausente con novedad no es ausencia, es día con novedad', () => {
    const jornadas = [
        { fecha: '2026-11-09', estado: 'finalizada', minutos_tarde: 0, minutos_trabajados: 480 },
        { fecha: '2026-11-10', estado: 'ausente', minutos_tarde: 0, minutos_trabajados: 0 },
        { fecha: '2026-11-11', estado: 'ausente', minutos_tarde: 0, minutos_trabajados: 0 },
        { fecha: '2026-11-13', estado: 'ausente', minutos_tarde: 0, minutos_trabajados: 0 }
    ];
    const r = resumenDeJornadas(jornadas, novedadesPorFecha([incapacidad], '2026-11-01', '2026-11-30'));
    assert.equal(r.ausencias, 1);
    assert.equal(r.dias_novedad, 2);
    assert.equal(r.dias_trabajados, 1);
    assert.deepEqual(r.dias.map((d) => d.estado), ['finalizada', 'novedad', 'novedad', 'ausente']);
    assert.equal(r.dias[1].novedad.tipo, 'Incapacidades origen comun 1- 2 días');
});

test('resumenDeJornadas: días con novedad sin jornada entran a la grilla; si trabajó, el día sigue trabajado', () => {
    const jornadas = [{ fecha: '2026-11-04', estado: 'finalizada', minutos_tarde: 5, minutos_trabajados: 470 }];
    const r = resumenDeJornadas(jornadas, novedadesPorFecha([vacaciones], '2026-11-01', '2026-11-05'));
    assert.equal(r.dias_trabajados, 1);
    assert.equal(r.dias_novedad, 2);
    assert.deepEqual(r.dias.map((d) => `${d.fecha}:${d.estado}`), ['2026-11-03:novedad', '2026-11-04:finalizada', '2026-11-05:novedad']);
    assert.equal(r.dias[1].novedad.tipo, 'Vacaciones');
});

test('resumenDeJornadas sin novedades queda igual que antes, y totalesEquipo suma los días con novedad', () => {
    const r = resumenDeJornadas([{ fecha: '2026-11-10', estado: 'ausente', minutos_tarde: 0 }]);
    assert.equal(r.ausencias, 1);
    assert.equal(r.dias_novedad, 0);
    assert.equal(totalesEquipo([{ dias_novedad: 2 }, { dias_novedad: 3 }]).dias_novedad, 5);
});

test('ajustarAgregado (histórico de financiera): resta las ausencias cubiertas y cuenta los días con novedad', () => {
    const estados = new Map([['2026-11-10', 'ausente'], ['2026-11-11', 'finalizada'], ['2026-11-13', 'ausente']]);
    const novedades = novedadesPorFecha([{ ...incapacidad, fecha_final: '2026-11-12' }], '2026-11-01', '2026-11-30');
    const r = ajustarAgregado({ users_company_id: 7, ausencias: 2, dias_trabajados: 1 }, estados, novedades);
    // 10 ausente cubierto → novedad; 11 trabajó → sigue trabajado; 12 sin jornada → novedad; 13 ausente sin cubrir.
    assert.equal(r.ausencias, 1);
    assert.equal(r.dias_novedad, 2);
    assert.equal(r.dias_trabajados, 1);
    const parcial = ajustarAgregado({ ausencias: 1 }, new Map([['2026-11-12', 'ausente']]), novedadesPorFecha([votacion], '2026-11-01', '2026-11-30'));
    assert.deepEqual([parcial.ausencias, parcial.dias_novedad], [1, 0]);
});

test('resumenDeJornadas: los días de descanso van en la grilla y nunca son ausencia (§73)', () => {
    const jornadas = [
        { fecha: '2026-11-08', estado: 'finalizada', minutos_tarde: 0, minutos_trabajados: 480 },
        { fecha: '2026-11-09', estado: 'ausente', minutos_tarde: 0, minutos_trabajados: 0 }
    ];
    const descansos = new Set(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    const novedades = novedadesPorFecha([incapacidad], '2026-11-01', '2026-11-30'); // 10 y 11
    const r = resumenDeJornadas(jornadas, novedades, descansos);
    // 08 trabajó (sigue trabajado); 09 descanso aunque quedó ausente; 10-11 manda la novedad.
    assert.deepEqual(r.dias.map((d) => `${d.fecha.slice(8)}:${d.estado}`), ['08:finalizada', '09:descanso', '10:novedad', '11:novedad']);
    assert.equal(r.dias_descanso, 1);
    assert.equal(r.ausencias, 0);
    assert.equal(r.dias_trabajados, 1);
    assert.equal(totalesEquipo([r, { dias_descanso: 2 }]).dias_descanso, 3);
});
