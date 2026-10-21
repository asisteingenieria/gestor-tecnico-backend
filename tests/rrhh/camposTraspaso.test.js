const { test } = require('node:test');
const assert = require('node:assert/strict');

const { prepararTraspaso, CAMPOS_NUEVOS_POR_TIPO } = require('../../utils/camposTraspaso');

const completo = {
    contrato_id: 1, tipo_traspaso_id: 1,
    cargo_nuevo_id: 5, salario_nuevo: 2000000, bono_no_prestacional_nuevo: 100000,
    fecha_inicio: '2026-11-01', fecha_fin: '2026-12-31',
    area_nueva_id: 2, campania_nueva_id: 3, centro_costo_nuevo_id: 4, cargo_ssff_nuevo: 'X', usuario_ssff_nuevo: 'u',
    jefe_area_nuevo_id: 7, jefe_inmediato_nuevo_id: 8, modalidad_idmodalidad: 1,
    fecha_inicio_trabajo_casa: '2026-11-03', fecha_fin_trabajo_casa: '2026-11-30', diadema: 'D1', equipo_computo: 'PC1',
    salario_anterior: 1500000, bono_cafeteria_anterior: 50000
};

test('la hoja TRASPASOS define 6 tipos', () => {
    assert.deepEqual(Object.keys(CAMPOS_NUEVOS_POR_TIPO).sort(),
        ['CAMBIO_CARGO', 'CAMBIO_SALARIO', 'ENCARGO', 'NO_RATIFICACION', 'RATIFICACION', 'TRABAJO_CASA']);
});

test('encargo: BNP nuevo y fecha fin sí, salario nuevo y trabajo en casa no', () => {
    const { datos, faltantes } = prepararTraspaso('ENCARGO', completo);
    assert.deepEqual(faltantes, []);
    assert.equal(datos.bono_no_prestacional_nuevo, 100000);
    assert.equal(datos.fecha_fin, '2026-12-31');
    assert.equal(datos.salario_nuevo, null);
    assert.equal(datos.diadema, null);
    assert.equal(datos.fecha_inicio_trabajo_casa, null);
    assert.equal(datos.ratificacion, false);
});

test('encargo exige fecha fin no anterior a la de inicio', () => {
    assert.deepEqual(prepararTraspaso('ENCARGO', { ...completo, fecha_fin: '' }).faltantes, ['fecha_fin']);
    assert.deepEqual(prepararTraspaso('ENCARGO', { ...completo, fecha_fin: '2026-10-01' }).faltantes, ['fecha_fin']);
});

test('ratificación marca ratificacion; no ratificación no', () => {
    assert.equal(prepararTraspaso('RATIFICACION', completo).datos.ratificacion, true);
    assert.equal(prepararTraspaso('NO_RATIFICACION', completo).datos.ratificacion, false);
    assert.equal(prepararTraspaso('RATIFICACION', completo).datos.fecha_fin, null);
    assert.equal(prepararTraspaso('RATIFICACION', completo).datos.bono_no_prestacional_nuevo, null);
});

test('trabajo en casa: solo modalidad, fechas de trabajo en casa, diadema y equipo', () => {
    const { datos, faltantes } = prepararTraspaso('TRABAJO_CASA', { ...completo, fecha_inicio: '' });
    assert.deepEqual(faltantes, []);
    assert.equal(datos.fecha_inicio, '2026-11-03');
    assert.equal(datos.fecha_fin, '2026-11-30');
    assert.equal(datos.modalidad_idmodalidad, 1);
    assert.equal(datos.diadema, 'D1');
    for (const campo of ['cargo_nuevo_id', 'salario_nuevo', 'area_nueva_id', 'jefe_inmediato_nuevo_id']) assert.equal(datos[campo], null, campo);
    assert.deepEqual(prepararTraspaso('TRABAJO_CASA', { ...completo, fecha_fin_trabajo_casa: '' }).faltantes, ['fecha_fin_trabajo_casa']);
});

test('cambio de salario exige salario nuevo, no cargo nuevo', () => {
    assert.deepEqual(prepararTraspaso('CAMBIO_SALARIO', { ...completo, cargo_nuevo_id: '' }).faltantes, []);
    assert.deepEqual(prepararTraspaso('CAMBIO_SALARIO', { ...completo, salario_nuevo: '' }).faltantes, ['salario_nuevo']);
    assert.deepEqual(prepararTraspaso('CAMBIO_CARGO', { ...completo, cargo_nuevo_id: null }).faltantes, ['cargo_nuevo_id']);
});

test('la información actual y los campos fuera de la hoja no se tocan', () => {
    for (const codigo of Object.keys(CAMPOS_NUEVOS_POR_TIPO)) {
        const { datos } = prepararTraspaso(codigo, completo);
        assert.equal(datos.salario_anterior, 1500000);
        assert.equal(datos.bono_cafeteria_anterior, 50000);
    }
});
