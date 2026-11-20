const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const R = require('../../utils/reporteEmpleados');

test('sin filtros descarga todos, sin rango de fechas', () => {
    assert.deepEqual(R.parsearFiltros({}).filtros, { estados: [], campoFecha: null, desde: null, hasta: null });
});

test('retirados con rango usa la fecha de retiro por defecto', () => {
    const { filtros } = R.parsearFiltros({ estados: 'retirado', desde: '2026-11-10', hasta: '2026-11-20' });
    assert.deepEqual(filtros, { estados: ['retirado'], campoFecha: 'retiro', desde: '2026-11-10', hasta: '2026-11-20' });
});

test('activos con rango usa la fecha de ingreso por defecto', () => {
    assert.equal(R.parsearFiltros({ estados: 'activo', desde: '2026-11-01' }).filtros.campoFecha, 'ingreso');
    assert.equal(R.parsearFiltros({ estados: 'activo,retirado', hasta: '2026-11-01' }).filtros.campoFecha, 'ingreso');
});

test('el tipo de fecha elegido manda sobre el de por defecto', () => {
    const { filtros } = R.parsearFiltros({ estados: 'retirado', campoFecha: 'registro', desde: '2026-11-01' });
    assert.equal(filtros.campoFecha, 'registro');
});

test('sin fechas se ignora el tipo de fecha', () => {
    assert.equal(R.parsearFiltros({ estados: 'activo', campoFecha: 'retiro' }).filtros.campoFecha, null);
});

test('rechaza estados, tipos de fecha y fechas inválidos', () => {
    assert.match(R.parsearFiltros({ estados: 'activo,borrado' }).error, /borrado/);
    assert.match(R.parsearFiltros({ campoFecha: 'nacimiento', desde: '2026-01-01' }).error, /Tipo de fecha/);
    assert.match(R.parsearFiltros({ desde: '2026-02-30' }).error, /desde/);
    assert.match(R.parsearFiltros({ hasta: '20/11/2026' }).error, /hasta/);
    assert.match(R.parsearFiltros({ desde: '2026-11-20', hasta: '2026-11-10' }).error, /posterior/);
});

test('arma la fila con los encabezados de la plantilla y fechas dd/mm/aaaa', () => {
    const [fila] = R.armarFilas([{
        numero_identificacion: '1000', tipo_identificacion_codigo: 'CC', primer_nombre: 'Ana', primer_apellido: 'Pérez',
        fecha_ingreso: new Date('2026-01-15T00:00:00Z'), fecha_retiro: '2026-11-12', estado_contrato: 'retirado',
        salario: '1750905.00', carnet_entregado: 1, aplica_dotacion: 0, registrado_en: new Date('2026-11-13T02:30:00Z')
    }]);
    assert.equal(fila['Número De Identificación'], '1000');
    assert.equal(fila['Tipo De Identificación'], 'CC');
    assert.equal(fila['Fecha De Ingreso'], '15/01/2026');
    assert.equal(fila['Fecha De Retiro'], '12/11/2026');
    assert.equal(fila['Estado'], 'Retirado');
    assert.equal(fila['Salario'], 1750905);
    assert.equal(fila['Carnet'], 'ENTREGADO');
    assert.equal(fila['Dotación'], 'NO');
    assert.equal(fila['Nombre Completo'], 'Ana Pérez');
    assert.equal(fila['Fecha De Registro'], '12/11/2026 21:30'); // UTC → Bogotá
    assert.equal(fila['Segundo Nombre'], '');
    assert.deepEqual(Object.keys(fila), R.ENCABEZADOS);
});

test('sin contrato el estado dice "Sin contrato"', () => {
    assert.equal(R.armarFilas([{}])[0]['Estado'], 'Sin contrato');
});

test('describe los filtros y arma el nombre del archivo', () => {
    const filtros = { estados: ['retirado'], campoFecha: 'retiro', desde: '2026-11-10', hasta: '2026-11-20' };
    assert.deepEqual(R.describirFiltros(filtros), { estado: 'Retirado', rango: 'Fecha de retiro del 10/11/2026 al 20/11/2026' });
    assert.equal(R.nombreArchivo(filtros, '2026-11-20'), 'empleados_retirado_2026-11-10_a_2026-11-20.xlsx');
    assert.equal(R.nombreArchivo({ estados: [], desde: null, hasta: null }, '2026-11-20'), 'empleados_todos_2026-11-20.xlsx');
});

test('genera el libro con las hojas Empleados y Filtros', () => {
    const filtros = { estados: ['activo'], campoFecha: null, desde: null, hasta: null };
    const buffer = R.generarLibro(R.armarFilas([{ numero_identificacion: '1', estado_contrato: 'activo' }]), filtros, '20/11/2026 10:00', XLSX);
    const libro = XLSX.read(buffer, { type: 'buffer' });
    assert.deepEqual(libro.SheetNames, ['Empleados', 'Filtros']);
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Empleados);
    assert.equal(filas.length, 1);
    assert.equal(filas[0]['Estado'], 'Activo');
    const resumen = XLSX.utils.sheet_to_json(libro.Sheets.Filtros, { header: 1 });
    assert.deepEqual(resumen[0], ['Estado', 'Activo']);
});

test('el libro vacío conserva los encabezados', () => {
    const buffer = R.generarLibro([], { estados: [], campoFecha: null, desde: null, hasta: null }, '', XLSX);
    const enc = XLSX.utils.sheet_to_json(XLSX.read(buffer, { type: 'buffer' }).Sheets.Empleados, { header: 1 })[0];
    assert.deepEqual(enc, R.ENCABEZADOS);
});
