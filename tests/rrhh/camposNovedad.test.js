const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../utils/camposNovedad');

const base = {
    fecha_inicial: '2026-11-20', fecha_final: '2026-11-24', fecha_retorno: '2026-11-25',
    origen_incapacidad: 'Común', resumen_diagnostico: 'Gripa', accidente_transito: true
};

test('las incapacidades conservan origen y diagnóstico; el accidente de tránsito lo da el tipo', () => {
    const comun = C.limpiarPorTipo(base, 'Incapacidades origen comun 1- 2 días');
    assert.equal(comun.origen_incapacidad, 'Común');
    assert.equal(comun.resumen_diagnostico, 'Gripa');
    assert.equal(comun.accidente_transito, false);
    assert.equal(C.limpiarPorTipo({ ...base, accidente_transito: false }, 'Incapacidades accidente de transito 3 días o mas').accidente_transito, true);
});

test('otros tipos no llevan datos de incapacidad', () => {
    const r = C.limpiarPorTipo(base, 'Licencia por luto');
    assert.equal(r.origen_incapacidad, null);
    assert.equal(r.resumen_diagnostico, null);
    assert.equal(r.accidente_transito, false);
    assert.equal(r.fecha_final, '2026-11-24');
});

test('vacaciones compensadas: sin fecha final ni de retorno', () => {
    const r = C.limpiarPorTipo({ ...base, modalidad_vacaciones: 'compensadas' }, 'Vacaciones');
    assert.equal(r.fecha_final, null);
    assert.equal(r.fecha_retorno, null);
    assert.equal(r.fecha_inicial, '2026-11-20');
    assert.equal(r.origen_incapacidad, null);
    const disfrutadas = C.limpiarPorTipo({ ...base, modalidad_vacaciones: 'disfrutadas' }, 'Vacaciones');
    assert.equal(disfrutadas.fecha_retorno, '2026-11-25');
});
