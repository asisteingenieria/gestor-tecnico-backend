const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ReglaContratacionError } = require('../../errors/AppError');
const { aplicarEventoExamen } = require('../../domain/contratacionHydra/examenes');

const marcar = (examenEstado, evento, nota, estadoCandidato = 'pendiente') =>
    aplicarEventoExamen({ estadoCandidato, examenEstado, evento, nota });

test('asistió y aprobó: queda aprobado', () => {
    assert.equal(marcar('pendiente', 'asistio').examenEstado, 'asistio');
    const r = marcar('asistio', 'aprobado');
    assert.deepEqual(r, { examenEstado: 'aprobado', nota: null, candidatoSale: null });
});

test('sin examen guardado (null) se trata como pendiente', () => {
    assert.equal(marcar(null, 'asistio').examenEstado, 'asistio');
});

test('no asistió: la nota es opcional y se limpia', () => {
    assert.equal(marcar('pendiente', 'no_asistio').nota, null);
    assert.equal(marcar('pendiente', 'no_asistio', '   ').nota, null);
    assert.equal(marcar('pendiente', 'no_asistio', '  Incapacidad  ').nota, 'Incapacidad');
});

test('después de no asistir se puede volver a marcar asistencia (reagendado o no)', () => {
    assert.equal(marcar('no_asistio', 'asistio').examenEstado, 'asistio');
    assert.equal(marcar('reagendado', 'asistio').examenEstado, 'asistio');
    assert.equal(marcar('reagendado', 'no_asistio').examenEstado, 'no_asistio');
});

test('no aprobó exige nota y saca al candidato como no apto', () => {
    assert.throws(() => marcar('asistio', 'no_aprobado'), ReglaContratacionError);
    assert.throws(() => marcar('asistio', 'no_aprobado', '  '), ReglaContratacionError);
    const r = marcar('asistio', 'no_aprobado', 'Hipertensión no controlada');
    assert.deepEqual(r, { examenEstado: 'no_aprobado', nota: 'Hipertensión no controlada', candidatoSale: 'no_apto' });
});

test('el resultado solo se marca después de asistir', () => {
    for (const estado of ['pendiente', 'no_asistio', 'reagendado', 'aprobado']) {
        assert.throws(() => marcar(estado, 'aprobado'), ReglaContratacionError);
    }
});

test('aprobado es definitivo: no se vuelve a marcar asistencia', () => {
    assert.throws(() => marcar('aprobado', 'asistio'), ReglaContratacionError);
    assert.throws(() => marcar('aprobado', 'no_asistio'), ReglaContratacionError);
});

test('la decisión de Hydra solo aplica sobre un "no asistió"', () => {
    assert.equal(marcar('no_asistio', 'continuidad').examenEstado, 'reagendado');
    const r = marcar('no_asistio', 'no_continuidad', 'Desistió');
    assert.equal(r.examenEstado, 'no_asistio');
    assert.equal(r.candidatoSale, 'cancelado_hydra');
    for (const estado of ['pendiente', 'reagendado', 'asistio', 'aprobado']) {
        assert.throws(() => marcar(estado, 'continuidad'), ReglaContratacionError);
    }
});

test('un candidato cerrado no admite marcas', () => {
    for (const cerrado of ['registrado', 'descartado', 'cancelado_hydra', 'no_apto']) {
        assert.throws(() => marcar('pendiente', 'asistio', null, cerrado), ReglaContratacionError);
    }
    assert.equal(marcar('pendiente', 'asistio', null, 'listo').examenEstado, 'asistio');
});

test('evento desconocido', () => {
    assert.throws(() => marcar('pendiente', 'aprobo'), ReglaContratacionError);
});
