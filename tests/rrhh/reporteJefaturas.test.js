const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { armarReporteJefaturas, generarLibro, esDirector } = require('../../utils/reporteJefaturas');

const jefe = (prefijo, id, nombre, cargo, estado = 'activo') => ({
    [`${prefijo}_id`]: id, [`${prefijo}_cedula`]: String(id), [`${prefijo}_nombre`]: nombre,
    [`${prefijo}_cargo`]: cargo, [`${prefijo}_estado`]: estado
});

const empleado = (extra = {}) => ({
    id: 100, cedula: '1000', nombre: 'Ana Pérez', cargo: 'AGENTE CALL CENTER', campania: 'T&T',
    centro_costo: 'CBAT OUTBOUND', estado_contrato: 'activo', fecha_ingreso: new Date('2026-01-15T00:00:00Z'),
    ...extra
});

test('sube el horario el jefe de área cuando no hay gestor de asistencia', () => {
    const { empleados } = armarReporteJefaturas([empleado({
        ...jefe('ji', 2, 'Coordinadora', 'COORDINADOR CALL'),
        ...jefe('ja', 3, 'Kevin', 'JEFE DE OPERACIONES'),
        ...jefe('da', 4, 'Nelson', 'DIRECTOR DE OPERACIONES')
    })]);
    assert.equal(empleados[0]['SUBE EL HORARIO'], 'Kevin');
    assert.equal(empleados[0]['Sube por'], 'Jefe de área');
    assert.equal(empleados[0]['Alertas'], '');
    assert.equal(empleados[0]['Fecha ingreso'], '2026-01-15');
});

test('el gestor de asistencia tiene prioridad sobre el jefe de área', () => {
    const { empleados } = armarReporteJefaturas([empleado({
        ...jefe('ji', 2, 'Coordinadora', 'COORDINADOR CALL'),
        ...jefe('ja', 3, 'German', 'GERENTE'),
        ...jefe('ga', 5, 'Geraldin', 'COORDINADORA ADMINISTRATIVA')
    })]);
    assert.equal(empleados[0]['SUBE EL HORARIO'], 'Geraldin');
    assert.equal(empleados[0]['Sube por'], 'Gestor de asistencia');
});

test('alerta cuando le sube el horario un director y cuando el jefe inmediato no está vigente', () => {
    const { empleados } = armarReporteJefaturas([empleado({
        ...jefe('ji', 2, 'Azael', 'COORDINADOR CALL', 'terminado'),
        ...jefe('ja', 4, 'Nelson', 'DIRECTOR DE OPERACIONES')
    })]);
    assert.match(empleados[0]['Alertas'], /director/);
    assert.match(empleados[0]['Alertas'], /Jefe inmediato no vigente/);
});

test('alerta cuando nadie puede subirle el horario ni tiene jefe inmediato', () => {
    const { empleados, porQuienSube } = armarReporteJefaturas([empleado()]);
    assert.equal(empleados[0]['SUBE EL HORARIO'], '');
    assert.match(empleados[0]['Alertas'], /Nadie puede subirle/);
    assert.match(empleados[0]['Alertas'], /Sin jefe inmediato/);
    assert.equal(porQuienSube[0]['SUBE EL HORARIO'], '(nadie)');
});

test('alerta cuando se sube el horario a sí mismo', () => {
    const { empleados } = armarReporteJefaturas([empleado({ ...jefe('ja', 100, 'Ana Pérez', 'JEFE DE OPERACIONES') })]);
    assert.match(empleados[0]['Alertas'], /a sí mismo/);
});

test('el resumen agrupa por quien sube, cuenta empleados y marca a los directores', () => {
    const k = jefe('ja', 3, 'Kevin', 'JEFE DE OPERACIONES');
    const n = jefe('ja', 4, 'Nelson', 'DIRECTOR DE OPERACIONES');
    const { porQuienSube } = armarReporteJefaturas([
        empleado({ id: 1, ...k }), empleado({ id: 2, ...k, campania: 'CLARO' }), empleado({ id: 3, ...n })
    ]);
    assert.deepEqual(porQuienSube.map((g) => [g['SUBE EL HORARIO'], g['Empleados'], g['Es director']]),
        [['Kevin', 2, ''], ['Nelson', 1, 'Sí']]);
    assert.equal(porQuienSube[0]['Campañas'], 'CLARO, T&T');
});

test('esDirector reconoce los cargos que empiezan por DIRECTOR', () => {
    assert.equal(esDirector('DIRECTOR DE OPERACIONES'), true);
    assert.equal(esDirector('director de formacion'), true);
    assert.equal(esDirector('JEFE DE OPERACIONES'), false);
    assert.equal(esDirector(null), false);
});

test('generarLibro escribe las dos hojas', () => {
    const datos = armarReporteJefaturas([empleado({ ...jefe('ja', 3, 'Kevin', 'JEFE DE OPERACIONES') })]);
    const libro = XLSX.read(generarLibro(datos, XLSX), { type: 'buffer' });
    assert.deepEqual(libro.SheetNames, ['Empleados', 'Por quien sube']);
    const filas = XLSX.utils.sheet_to_json(libro.Sheets.Empleados);
    assert.equal(filas[0]['SUBE EL HORARIO'], 'Kevin');
});
