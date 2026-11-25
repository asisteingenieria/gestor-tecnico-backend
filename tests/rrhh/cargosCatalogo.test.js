const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nombreCargo, validarCargo, compararConCatalogo, aNumero } = require('../../utils/cargosCatalogo');
const { crearBuscador } = require('../../utils/personaPorNombre');

const CARGOS = [
    { id: 12, nombre: 'AGENTE CALL CENTER' },
    { id: 45, nombre: 'AUXILIAR DE GESTION HUMANA' },
    { id: 58, nombre: 'ANALISTA DE GESTIÓN HUMANA' }
];

test('nombre del cargo: sin espacios de más y en mayúsculas', () => {
    assert.equal(nombreCargo('  auxiliar   de nómina '), 'AUXILIAR DE NÓMINA');
});

test('validarCargo: nombre obligatorio y referencias completas', () => {
    assert.deepEqual(validarCargo({}).errores, ['El nombre del cargo es obligatorio']);
    const { errores } = validarCargo({ nombre: 'X', referencias: [{ cliente_id: '', salario: 100 }, { cliente_id: 3, salario: 0 }] });
    assert.deepEqual(errores, ['Referencia 1: elige el cliente', 'Referencia 2: el sueldo debe ser mayor que cero']);
});

test('validarCargo: sueldo con puntos de miles y sin duplicados', () => {
    const ok = validarCargo({ nombre: 'auxiliar contable', codigo_ssff: ' ', referencias: [{ cliente_id: '3', salario: '1.423.500' }] });
    assert.deepEqual(ok.errores, []);
    assert.deepEqual(ok.datos, { nombre: 'AUXILIAR CONTABLE', codigo_ssff: null, referencias: [{ cliente_id: 3, salario: 1423500 }] });
    const dup = validarCargo({ nombre: 'X', referencias: [{ cliente_id: 3, salario: 1500000 }, { cliente_id: 3, salario: '1.500.000' }] });
    assert.equal(dup.errores.length, 1);
    assert.equal(aNumero('$ 1,423,500'), 1423500);
});

test('compararConCatalogo: igual sin tildes ni mayúsculas, y parecidos', () => {
    assert.equal(compararConCatalogo('Analista de gestion humana', CARGOS).igual.id, 58);
    // Al editar el mismo cargo no choca consigo mismo.
    assert.equal(compararConCatalogo('ANALISTA DE GESTION HUMANA', CARGOS, 58).igual, null);
    const { igual, parecidos } = compararConCatalogo('AGENTE DE CALL CENTER', CARGOS);
    assert.equal(igual, null);
    assert.equal(parecidos[0].id, 12);
    assert.deepEqual(compararConCatalogo('CONTADOR', CARGOS), { igual: null, parecidos: [] });
});

const EMPLEADOS = [
    { id: 1, nombre_completo: 'Angie Gisethe Rodriguez Franco', cedula: '1025320035', activo: 1 },
    { id: 2, nombre_completo: 'Maria Rodriguez Perez', cedula: '52000001', activo: 1 },
    { id: 3, nombre_completo: 'Maria Rodriguez Gomez', cedula: '52000002', activo: 0 },
    { id: 4, nombre_completo: 'Carlos Pérez', cedula: '79000001', activo: 1 },
    { id: 5, nombre_completo: 'Carlos Pérez', cedula: '79000002', activo: 1 }
];

test('persona por nombre: nombre incompleto del Excel encuentra la ficha (caso Angie)', () => {
    const buscar = crearBuscador(EMPLEADOS);
    assert.deepEqual(buscar('ANGIE GISETHE RODRIGUEZ'), { id: 1 });
    assert.deepEqual(buscar('angie rodriguez franco'), { id: 1 });
    assert.deepEqual(buscar('ANGIE GISETHE RODRÍGUEZ FRANCO'), { id: 1 });
    assert.deepEqual(buscar('1025320035'), { id: 1 });
});

test('persona por nombre: prefiere la activa y no adivina entre dos', () => {
    const buscar = crearBuscador(EMPLEADOS);
    assert.deepEqual(buscar('MARIA RODRIGUEZ'), { id: 2 });
    assert.deepEqual(buscar('CARLOS PEREZ').ambiguos.length, 2);
    assert.equal(buscar('ANGIE'), null); // una sola palabra no basta
    assert.equal(buscar('FRANCO ANGIE'), null); // el orden importa
    assert.equal(buscar(''), null);
});
