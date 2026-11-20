const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const R = require('../../utils/reporteNovedades');

const novedad = (extra = {}) => ({
    idnovedad_rrhh: 1,
    empleado_nombre: 'Laura Acero',
    empleado_identificacion: '1001',
    tipo_novedad_nombre: 'Vacaciones',
    campania_nombre: 'T&T',
    fecha_inicial: new Date('2026-11-10T00:00:00Z'),
    fecha_final: new Date('2026-11-14T00:00:00Z'),
    created_at: new Date('2026-11-12T15:00:00Z'),
    soportes_requeridos: 1,
    soportes_cargados: 0,
    documentos_expediente: 0,
    ...extra
});

test('sin filtros no hay rango y el tipo de fecha por defecto es el registro', () => {
    assert.deepEqual(R.parsearFiltros({}).filtros, { q: '', tipos: [], campanias: [], soportes: [], campoFecha: null, desde: null, hasta: null });
    assert.equal(R.parsearFiltros({ desde: '2026-11-01' }).filtros.campoFecha, 'registro');
    assert.equal(R.parsearFiltros({ desde: '2026-11-01', campoFecha: 'inicial' }).filtros.campoFecha, 'inicial');
});

test('listas de tipos y campañas separadas por |, que admiten comas', () => {
    const { filtros } = R.parsearFiltros({ tipos: 'Vacaciones|Licencia, remunerada', campanias: 'T&T' });
    assert.deepEqual(filtros.tipos, ['Vacaciones', 'Licencia, remunerada']);
    assert.deepEqual(filtros.campanias, ['T&T']);
});

test('rechaza fechas, tipos de fecha y soportes inválidos', () => {
    assert.match(R.parsearFiltros({ desde: '2026-13-01' }).error, /desde/);
    assert.match(R.parsearFiltros({ desde: '2026-11-20', hasta: '2026-11-01' }).error, /posterior/);
    assert.match(R.parsearFiltros({ desde: '2026-11-01', campoFecha: 'retiro' }).error, /retiro/);
    assert.match(R.parsearFiltros({ soportes: 'todos' }).error, /todos/);
});

test('el registro se toma en día de Bogotá: 7 p. m. en adelante no pasa al día siguiente', () => {
    const n = novedad({ created_at: new Date('2026-11-13T02:30:00Z') }); // 12-nov 9:30 p. m. en Bogotá
    assert.equal(R.diaDelRango(n, 'registro'), '2026-11-12');
    const { filtros } = R.parsearFiltros({ desde: '2026-11-12', hasta: '2026-11-12' });
    assert.equal(R.filtrar([n], filtros).length, 1);
});

test('el rango se aplica sobre la fecha elegida', () => {
    const filas = [novedad(), novedad({ idnovedad_rrhh: 2, created_at: new Date('2026-11-01T15:00:00Z') })];
    assert.equal(R.filtrar(filas, R.parsearFiltros({ desde: '2026-11-05' }).filtros).length, 1);
    assert.equal(R.filtrar(filas, R.parsearFiltros({ desde: '2026-11-05', campoFecha: 'inicial' }).filtros).length, 2);
    assert.equal(R.filtrar(filas, R.parsearFiltros({ hasta: '2026-11-13', campoFecha: 'final' }).filtros).length, 0);
    // Sin fecha final no entra en un rango sobre la fecha final.
    assert.equal(R.filtrar([novedad({ fecha_final: null })], R.parsearFiltros({ desde: '2026-01-01', campoFecha: 'final' }).filtros).length, 0);
});

test('estado de los soportes: el expediente manda sobre los soportes', () => {
    assert.equal(R.estadoSoportes(novedad({ documentos_expediente: 1 })), 'expediente');
    assert.equal(R.estadoSoportes(novedad({ soportes_cargados: 1 })), 'completos');
    assert.equal(R.estadoSoportes(novedad()), 'pendientes');
    assert.equal(R.estadoSoportes(novedad({ soportes_requeridos: 0 })), 'no_requiere');
});

test('combina búsqueda, tipo, campaña y soportes', () => {
    const filas = [
        novedad(),
        novedad({ idnovedad_rrhh: 2, tipo_novedad_nombre: 'Suspensiones', campania_nombre: null }),
        novedad({ idnovedad_rrhh: 3, empleado_nombre: 'Azael Alcalá', empleado_identificacion: '2002', soportes_cargados: 1 })
    ];
    const f = (q) => R.filtrar(filas, R.parsearFiltros(q).filtros).map((n) => n.idnovedad_rrhh);
    assert.deepEqual(f({ q: 'azael' }), [3]);
    assert.deepEqual(f({ q: '1001' }), [1, 2]);
    assert.deepEqual(f({ tipos: 'Vacaciones' }), [1, 3]);
    assert.deepEqual(f({ campanias: 'Sin campaña' }), [2]);
    assert.deepEqual(f({ soportes: 'pendientes', tipos: 'Vacaciones' }), [1]);
});

test('el libro trae la hoja Novedades con fechas dd/mm/aaaa y la hoja Filtros', () => {
    const { filtros } = R.parsearFiltros({ desde: '2026-11-10', hasta: '2026-11-20' });
    const buffer = R.generarLibro(R.armarFilas([novedad()]), filtros, '20/11/2026 10:00', XLSX);
    const libro = XLSX.read(buffer, { type: 'buffer' });
    assert.deepEqual(libro.SheetNames, ['Novedades', 'Filtros']);
    const [fila] = XLSX.utils.sheet_to_json(libro.Sheets.Novedades, { raw: false });
    assert.equal(fila['Fecha De Registro'], '12/11/2026 10:00');
    assert.equal(fila['Fecha Inicial'], '10/11/2026');
    // Fechas reales (§60): número de serie con formato, no texto.
    const crudo = XLSX.utils.sheet_to_json(libro.Sheets.Novedades)[0];
    assert.equal(typeof crudo['Fecha Inicial'], 'number');
    assert.equal(fila['Soportes'], 'Soportes pendientes');
    const resumen = XLSX.utils.sheet_to_json(libro.Sheets.Filtros, { header: 1 });
    assert.deepEqual(resumen.find((r) => r[0] === 'Rango'), ['Rango', 'Fecha de registro del 10/11/2026 al 20/11/2026']);
    assert.equal(R.nombreArchivo(filtros, '2026-11-20'), 'novedades_registro_2026-11-10_a_2026-11-20.xlsx');
    assert.equal(R.nombreArchivo(R.parsearFiltros({}).filtros, '2026-11-20'), 'novedades_2026-11-20.xlsx');
});
