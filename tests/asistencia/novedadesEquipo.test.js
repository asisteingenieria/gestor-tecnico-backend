const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    estadoNovedad, observacionesVisibles, estadoSoportes, presentarNovedad
} = require('../../domain/asistencia/novedadesEquipo');

test('estadoNovedad: próxima, en curso y finalizada según hoy', () => {
    assert.equal(estadoNovedad('2026-11-10', '2026-11-12', '2026-11-08'), 'proxima');
    assert.equal(estadoNovedad('2026-11-05', '2026-11-10', '2026-11-08'), 'en_curso');
    assert.equal(estadoNovedad('2026-11-08', '2026-11-08', '2026-11-08'), 'en_curso');
    assert.equal(estadoNovedad('2026-10-01', '2026-10-03', '2026-11-08'), 'finalizada');
});

test('estadoNovedad: sin fecha final dura solo el día inicial y acepta Date', () => {
    assert.equal(estadoNovedad(new Date('2026-11-08T00:00:00Z'), null, '2026-11-08'), 'en_curso');
    assert.equal(estadoNovedad('2026-11-07', null, '2026-11-08'), 'finalizada');
});

test('observacionesVisibles oculta el texto interno del cargue masivo', () => {
    assert.equal(observacionesVisibles('Cargue masivo desde el Excel de novedades de Gestión Humana (fila 25).'), null);
    assert.equal(observacionesVisibles('   '), null);
    assert.equal(observacionesVisibles(null), null);
    assert.equal(observacionesVisibles(' Reintegro con recomendaciones '), 'Reintegro con recomendaciones');
});

test('estadoSoportes cuenta el documento del expediente como soporte', () => {
    assert.equal(estadoSoportes(2, 2, 0), 'completos');
    assert.equal(estadoSoportes(2, 1, 0), 'incompletos');
    assert.equal(estadoSoportes(2, 0, 0), 'pendientes');
    assert.equal(estadoSoportes(1, 0, 1), 'completos');
    assert.equal(estadoSoportes(0, 0, 0), 'no_requiere');
});

test('presentarNovedad no expone el diagnóstico', () => {
    const vista = presentarNovedad({
        idnovedad_rrhh: 1, empleado_id: 7, empleado_nombre: 'Ana Pérez', empleado_identificacion: '123',
        tipo_novedad_id: 3, tipo_novedad: 'Incapacidad', fecha_inicial: new Date('2026-11-01T00:00:00Z'),
        fecha_final: new Date('2026-11-03T00:00:00Z'), total_dias: 3, contrato_vigente: 0,
        resumen_diagnostico: 'J00 rinofaringitis', soportes_requeridos: 1, soportes_cargados: 0, documentos_expediente: 0
    }, '2026-11-08');
    assert.equal(vista.fecha_inicial, '2026-11-01');
    assert.equal(vista.estado, 'finalizada');
    assert.equal(vista.contrato_vigente, false);
    assert.equal(vista.soportes, 'pendientes');
    assert.ok(!('resumen_diagnostico' in vista));
    assert.ok(!JSON.stringify(vista).includes('J00'));
});
