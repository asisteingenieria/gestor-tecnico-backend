const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    validarLoteHydra,
    validarCandidatoHydra,
    validarCancelacionHydra
} = require('../../validators/integracionHydraSchemas');
const { payloadCandidato } = require('./fixtures');

function lote(cambios = {}) {
    return {
        lote_externo_id: 'HYD-2026-10-01-FORM-12',
        nombre: 'Formación Hogar',
        fecha_ingreso_sugerida: '2026-10-06',
        candidatos: [payloadCandidato()],
        ...cambios
    };
}

test('un lote conforme al contrato no tiene errores', () => {
    assert.deepEqual(validarLoteHydra(lote()), []);
});

test('campos desconocidos se ignoran (compatibilidad hacia adelante)', () => {
    assert.deepEqual(validarLoteHydra(lote({ campo_nuevo_de_hydra: 1 })), []);
});

test('exige lote_externo_id, nombre y al menos un candidato', () => {
    const errores = validarLoteHydra({ candidatos: [] });
    assert.ok(errores.includes('lote_externo_id es requerido'));
    assert.ok(errores.includes('nombre es requerido'));
    assert.ok(errores.some((e) => e.startsWith('candidatos debe ser un arreglo')));
});

test('rechaza fechas imposibles aunque tengan formato YYYY-MM-DD', () => {
    const errores = validarLoteHydra(lote({ fecha_ingreso_sugerida: '2026-02-30' }));
    assert.deepEqual(errores, ['fecha_ingreso_sugerida debe ser una fecha YYYY-MM-DD válida']);
});

test('rechaza más de 200 candidatos', () => {
    const candidatos = Array.from({ length: 201 }, (_, i) => payloadCandidato({ hydra_candidato_id: i + 1 }));
    assert.match(validarLoteHydra(lote({ candidatos }))[0], /máximo 200/);
});

test('reporta errores por candidato con su índice', () => {
    const malo = payloadCandidato({ identificacion: { tipo: 'CC', numero: '12 34' }, nombres: { primer_nombre: 'Ana' } });
    const errores = validarLoteHydra(lote({ candidatos: [payloadCandidato(), malo] }));
    assert.ok(errores.some((e) => e.startsWith('candidatos[1].identificacion.numero')));
    assert.ok(errores.includes('candidatos[1].nombres.primer_apellido es requerido'));
});

test('rechaza ids de Hydra repetidos en el mismo lote', () => {
    const errores = validarLoteHydra(lote({ candidatos: [payloadCandidato(), payloadCandidato()] }));
    assert.ok(errores.some((e) => e.includes('repetido')));
});

test('version y hydra_candidato_id deben ser enteros positivos', () => {
    const errores = validarLoteHydra(lote({ candidatos: [payloadCandidato({ version: '1', hydra_candidato_id: -3 })] }));
    assert.ok(errores.includes('candidatos[0].hydra_candidato_id debe ser un entero positivo'));
    assert.ok(errores.includes('candidatos[0].version debe ser un entero positivo'));
});

test('email inválido se reporta', () => {
    const errores = validarLoteHydra(lote({ candidatos: [payloadCandidato({ contacto: { email: 'no-es-email' } })] }));
    assert.deepEqual(errores, ['candidatos[0].contacto.email no es un email válido']);
});

test('PUT de candidato: el id del cuerpo debe coincidir con el de la URL', () => {
    assert.deepEqual(validarCandidatoHydra(payloadCandidato(), { params: { hydraCandidatoId: '4821' } }), []);
    assert.deepEqual(
        validarCandidatoHydra(payloadCandidato(), { params: { hydraCandidatoId: '1' } }),
        ['candidato.hydra_candidato_id no coincide con el de la URL']
    );
});

test('cancelación: el motivo es opcional pero acotado', () => {
    assert.deepEqual(validarCancelacionHydra(undefined), []);
    assert.deepEqual(validarCancelacionHydra({ motivo: 'Desistió' }), []);
    assert.equal(validarCancelacionHydra({ motivo: 'x'.repeat(300) }).length, 1);
});
