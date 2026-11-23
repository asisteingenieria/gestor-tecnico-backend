const { test } = require('node:test');
const assert = require('node:assert/strict');
const { errorDeRango, resultadoDelDia, resumir } = require('../../domain/asistencia/mallaRetroactiva');

// Carga retroactiva de la malla (asistencia.md §76).

test('rango: solo días que ya pasaron, en orden y hasta 31', () => {
    assert.equal(errorDeRango('2026-11-21', '2026-11-22', '2026-11-23', 2), null);
    assert.match(errorDeRango('2026-11-21', '2026-11-23', '2026-11-23', 3), /ya pasaron/);
    assert.match(errorDeRango('2026-11-22', '2026-11-21', '2026-11-23', 0), /anterior/);
    assert.match(errorDeRango('2026-09-01', '2026-11-01', '2026-11-23', 32), /31/);
    assert.match(errorDeRango(null, '2026-11-22', '2026-11-23', 0), /--desde/);
});

test('resultado del día según el horario cargado y la jornada recalculada', () => {
    const turno = { esDescanso: false };
    const descanso = { esDescanso: true };
    assert.equal(resultadoDelDia(turno, { estado: 'finalizada', minutos_tarde: 0 }), 'puntual');
    assert.equal(resultadoDelDia(turno, { estado: 'finalizada', minutos_tarde: 12 }), 'tarde');
    assert.equal(resultadoDelDia(turno, { estado: 'ausente', minutos_tarde: 0 }), 'ausente');
    assert.equal(resultadoDelDia(turno, null), 'sin_jornada');
    assert.equal(resultadoDelDia(descanso, null), 'descanso');
    assert.equal(resultadoDelDia(descanso, { estado: 'finalizada', minutos_tarde: 0 }), 'trabajo_en_descanso');
});

test('resumen por resultado y personas distintas', () => {
    const r = resumir([
        { users_company_id: 1, resultado: 'tarde' }, { users_company_id: 1, resultado: 'puntual' },
        { users_company_id: 2, resultado: 'ausente' }
    ]);
    assert.equal(r.tarde, 1);
    assert.equal(r.puntual, 1);
    assert.equal(r.ausente, 1);
    assert.equal(r.descanso, 0);
    assert.equal(r.dias, 3);
    assert.equal(r.personas, 2);
});
