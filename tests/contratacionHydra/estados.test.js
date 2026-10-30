const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ReglaContratacionError } = require('../../errors/AppError');
const {
    estadoCandidato,
    estadoLote,
    assertCandidatoEditable,
    assertSeccionValida,
    assertPuedeVerificar,
    assertPuedeDescartar,
    assertHydraPuedeActualizar,
    assertLoteRegistrable
} = require('../../domain/contratacionHydra/estados');

test('estadoCandidato deriva pendiente/listo de la completitud y del examen médico', () => {
    assert.equal(estadoCandidato('pendiente', { listo: true }, 'aprobado'), 'listo');
    assert.equal(estadoCandidato('listo', { listo: false }, 'aprobado'), 'pendiente');
});

test('estadoCandidato: sin el examen aprobado por SST no queda listo', () => {
    for (const examen of [undefined, null, 'pendiente', 'no_asistio', 'reagendado', 'asistio']) {
        assert.equal(estadoCandidato('pendiente', { listo: true }, examen), 'pendiente');
    }
    assert.equal(estadoCandidato('listo', { listo: true }, 'asistio'), 'pendiente');
});

test('estadoCandidato no saca a un candidato de un estado terminal', () => {
    for (const terminal of ['registrado', 'descartado', 'cancelado_hydra', 'no_apto']) {
        assert.equal(estadoCandidato(terminal, { listo: true }, 'aprobado'), terminal);
    }
});

test('estadoLote: un candidato no apto no bloquea ni cuenta', () => {
    assert.equal(estadoLote('abierto', ['listo', 'no_apto']), 'listo');
    assert.equal(estadoLote('abierto', ['no_apto']), 'abierto');
});

test('estadoLote: listo solo si todos los activos están listos', () => {
    assert.equal(estadoLote('abierto', ['listo', 'listo']), 'listo');
    assert.equal(estadoLote('abierto', ['listo', 'pendiente']), 'abierto');
    assert.equal(estadoLote('listo', ['listo', 'pendiente']), 'abierto');
});

test('estadoLote: descartados y cancelados no bloquean ni cuentan', () => {
    assert.equal(estadoLote('abierto', ['listo', 'descartado', 'cancelado_hydra']), 'listo');
    assert.equal(estadoLote('abierto', ['descartado', 'cancelado_hydra']), 'abierto');
    assert.equal(estadoLote('abierto', []), 'abierto');
});

test('estadoLote no saca a un lote de registrado o cancelado', () => {
    assert.equal(estadoLote('registrado', ['pendiente']), 'registrado');
    assert.equal(estadoLote('cancelado', ['listo']), 'cancelado');
});

test('assertCandidatoEditable rechaza estados terminales', () => {
    assert.doesNotThrow(() => assertCandidatoEditable('pendiente'));
    assert.doesNotThrow(() => assertCandidatoEditable('listo'));
    assert.throws(() => assertCandidatoEditable('registrado'), ReglaContratacionError);
    assert.throws(() => assertCandidatoEditable('descartado'), ReglaContratacionError);
});

test('assertSeccionValida rechaza secciones que no existen', () => {
    assert.doesNotThrow(() => assertSeccionValida('contrato'));
    assert.throws(() => assertSeccionValida('documentos'), ReglaContratacionError);
});

test('assertPuedeVerificar solo deja marcar secciones completas', () => {
    assert.doesNotThrow(() => assertPuedeVerificar({ completa: true, problemas: [] }));
    assert.throws(
        () => assertPuedeVerificar({ completa: false, problemas: [{ ruta: 'salario.salario', mensaje: 'Salario es obligatorio' }] }),
        /Salario es obligatorio/
    );
});

test('assertPuedeDescartar exige motivo y candidato editable', () => {
    assert.doesNotThrow(() => assertPuedeDescartar('pendiente', 'No se presentó a firmar'));
    assert.throws(() => assertPuedeDescartar('pendiente', '  '), ReglaContratacionError);
    assert.throws(() => assertPuedeDescartar('registrado', 'x'), ReglaContratacionError);
});

test('assertHydraPuedeActualizar solo bloquea registrados', () => {
    assert.doesNotThrow(() => assertHydraPuedeActualizar('descartado'));
    assert.throws(() => assertHydraPuedeActualizar('registrado'), ReglaContratacionError);
});

test('assertLoteRegistrable recalcula en vez de confiar en el estado guardado', () => {
    // Guardado dice "listo" pero un candidato volvió a pendiente.
    assert.throws(() => assertLoteRegistrable('listo', ['listo', 'pendiente']), /1 candidato/);
    assert.doesNotThrow(() => assertLoteRegistrable('listo', ['listo', 'descartado']));
});

test('assertLoteRegistrable rechaza lotes registrados, cancelados o sin candidatos activos', () => {
    assert.throws(() => assertLoteRegistrable('registrado', ['listo']), /ya fue registrado/);
    assert.throws(() => assertLoteRegistrable('cancelado', ['listo']), /cancelado/);
    assert.throws(() => assertLoteRegistrable('abierto', ['descartado']), /no tiene candidatos/);
});
