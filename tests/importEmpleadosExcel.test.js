const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parsearArchivo, detectarColumnas } = require('../utils/importEmpleadosExcel');

const libro = (hoja, filas) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), hoja);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

test('el Excel viejo de "TOTAL PERSONAL" se sigue leyendo por posición', () => {
    const encabezado = Array(91).fill('x');
    encabezado[48] = 'Numero de cuenta Correcta';
    assert.equal(detectarColumnas(encabezado).formato, 'total_personal');
});

test('la plantilla se lee por nombre de columna, en cualquier orden', () => {
    const buffer = libro('Empleados', [
        ['Salario', 'Primer Apellido', 'Número De Identificación', 'Tipo De Identificación', 'Primer Nombre', 'Campaña', 'Banco'],
        [1423500, 'CRUZ', '1013593360', 'CC', 'VALENTINA', 'T&T', '007.BANCOLOMBIA']
    ]);
    const { formato, filas } = parsearArchivo(buffer);
    assert.equal(formato, 'por_nombre');
    assert.equal(filas[0].numero_identificacion, '1013593360');
    assert.equal(filas[0].tipo_id_codigo, 'CC');
    assert.equal(filas[0].primer_nombre, 'VALENTINA');
    assert.equal(filas[0].salario, 1423500);
    assert.equal(filas[0].campania_nombre, 'T&T');
    assert.equal(filas[0].banco_nombre, 'BANCOLOMBIA');
});

test('con "Tipo De Identificación" repetido (hojas del HeadCount) la identificación va por posición', () => {
    const { col } = detectarColumnas(['Estado', 'Cliente', 'Tipo De Identificación', 'Tipo De Identificación', 'Tipo De Identificación', 'Identificación', 'Banco']);
    assert.equal(col.TIPO_ID, 2);
    assert.equal(col.NUM_ID, 3);
    assert.equal(col.BANCO, 6);
});

test('cada fila lleva los campos cuya columna no trae el archivo, para conservarlos al actualizar', () => {
    const buffer = libro('Empleados', [['Tipo De Identificación', 'Número De Identificación'], ['CC', '123']]);
    const [fila] = parsearArchivo(buffer).filas;
    assert.ok(fila.campos_ausentes.includes('USUARIO_SSFF'));
    assert.ok(fila.campos_ausentes.includes('EMPRESA'));
    assert.ok(!fila.campos_ausentes.includes('NUM_ID'));
});
