const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validarMantenimiento,
    validarMotivoBaja,
    validarTraslado,
    nivelAlerta,
    sumarMeses,
    fechaMasReciente,
    describirTareas,
    normalizarComentario
} = require('../utils/mantenimientoActivos');

test('preventivo exige al menos una tarea y solo aplica a computadores', () => {
    assert.equal(validarMantenimiento({ tipo: 'preventivo' }, 'ECC-CPU').ok, false);
    assert.equal(validarMantenimiento({ tipo: 'preventivo', formateo: true }, 'ECC-MON').ok, false);

    const r = validarMantenimiento({ tipo: 'preventivo', pasta_termica: true, limpieza_componentes: '1' }, 'ECC-CPU');
    assert.equal(r.ok, true);
    assert.deepEqual(r.datos, {
        tipo: 'preventivo', pasta_termica: true, limpieza_componentes: true, formateo: false, descripcion: null
    });
    assert.equal(validarMantenimiento({ tipo: 'preventivo', formateo: 1 }, 'ECC-POR').ok, true);
});

test('correctivo exige descripción y aplica a cualquier tipo de equipo', () => {
    assert.equal(validarMantenimiento({ tipo: 'correctivo', descripcion: 'corto' }, 'ECC-CPU').ok, false);
    const r = validarMantenimiento({ tipo: 'correctivo', descripcion: '  Cambio de fuente de poder  ', formateo: true }, 'ECC-MON');
    assert.equal(r.ok, true);
    assert.equal(r.datos.descripcion, 'Cambio de fuente de poder');
    assert.equal(r.datos.formateo, false, 'el correctivo no marca tareas preventivas');
});

test('tipo de mantenimiento desconocido se rechaza', () => {
    assert.equal(validarMantenimiento({ tipo: 'otro' }, 'ECC-CPU').ok, false);
    assert.equal(validarMantenimiento(null, 'ECC-CPU').ok, false);
});

test('la baja exige observación', () => {
    assert.equal(validarMotivoBaja('').ok, false);
    assert.equal(validarMotivoBaja('   dañado  ').ok, false);
    assert.deepEqual(validarMotivoBaja(' Board quemada, no enciende '), { ok: true, motivo: 'Board quemada, no enciende' });
    assert.equal(validarMotivoBaja('x'.repeat(2001)).ok, false);
    assert.equal(normalizarComentario('   '), null);
});

test('traslado de puesto valida puesto y site', () => {
    assert.equal(validarTraslado({}).ok, false);
    assert.deepEqual(validarTraslado({ puesto: ' 106 ' }), { ok: true, puesto: '106', site: undefined });
    assert.deepEqual(validarTraslado({ puesto: '106', site: 'Site B' }), { ok: true, puesto: '106', site: 'Site B' });
    assert.deepEqual(validarTraslado({ puesto: '106', site: '' }), { ok: true, puesto: '106', site: null });
    assert.equal(validarTraslado({ puesto: '106', site: 'Site C' }).ok, false);
});

test('alerta: al día < 3 meses, naranja >= 3, rojo >= 6, sin registro', () => {
    const ahora = new Date('2026-11-20T15:00:00Z');
    assert.equal(nivelAlerta(null, ahora), 'sin_registro');
    assert.equal(nivelAlerta('fecha-mala', ahora), 'sin_registro');
    assert.equal(nivelAlerta('2026-09-01T00:00:00Z', ahora), 'al_dia');
    assert.equal(nivelAlerta('2026-08-20T16:00:00Z', ahora), 'al_dia', 'aún no cumple 3 meses');
    assert.equal(nivelAlerta('2026-08-20T15:00:00Z', ahora), 'naranja', 'justo 3 meses');
    assert.equal(nivelAlerta('2026-06-01T00:00:00Z', ahora), 'naranja');
    assert.equal(nivelAlerta('2026-05-20T15:00:00Z', ahora), 'rojo', 'justo 6 meses');
    assert.equal(nivelAlerta(new Date('2025-01-01T00:00:00Z'), ahora), 'rojo');
});

test('sumarMeses respeta fin de mes', () => {
    assert.equal(sumarMeses(new Date('2026-08-31T10:00:00Z'), 6).toISOString(), '2027-02-28T10:00:00.000Z');
    assert.equal(sumarMeses(new Date('2026-11-30T00:00:00Z'), 3).toISOString(), '2027-02-28T00:00:00.000Z');
});

test('fechaMasReciente y describirTareas', () => {
    assert.equal(fechaMasReciente(null, null), null);
    assert.equal(fechaMasReciente('2026-01-01', null), '2026-01-01');
    assert.equal(fechaMasReciente('2026-01-01', '2026-03-01'), '2026-03-01');
    assert.deepEqual(describirTareas({ pasta_termica: 1, limpieza_componentes: 0, formateo: 1 }), ['Cambio de pasta térmica', 'Formateo']);
});
