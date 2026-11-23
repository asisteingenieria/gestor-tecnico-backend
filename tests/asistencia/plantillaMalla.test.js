const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');

const { ENCABEZADOS, errorDeRango, filasPlantilla, novedadDeDescanso } = require('../../domain/asistencia/plantillaMalla');
const { leerMalla } = require('../../domain/asistencia/mallaHorarios');
const { agregarListas, insertarEnHoja } = require('../../utils/excelListas');

// Plantilla de cargue de la malla con el equipo del jefe (asistencia.md §75).

const equipo = [
    { users_company_id: 2, numero_identificacion: '9000000003', nombre_propio: 'Zuleta Ana', cargo: 'Agente', centro_costo: 'T&T', modalidad_contrato: 'Teletrabajo' },
    { users_company_id: 1, numero_identificacion: '9000000002', nombre_propio: 'Álvarez Luis', cargo: 'Agente', centro_costo: 'Claro', modalidad_contrato: 'Presencial' },
    { users_company_id: 3, numero_identificacion: '9000000004', nombre_propio: 'Mora Eva', cargo: 'Backoffice', centro_costo: 'Claro', modalidad_contrato: 'Híbrido' },
    { users_company_id: 4, numero_identificacion: null, nombre_propio: 'Sin cédula' }
];
const fechas = ['2026-11-24', '2026-11-25'];

test('una fila por persona y día, ordenada por nombre, con cargo y centro de costo', () => {
    const filas = filasPlantilla({ equipo, fechas });
    assert.equal(filas.length, 6);
    assert.deepEqual(Object.keys(filas[0]), ENCABEZADOS);
    assert.deepEqual(filas.map((f) => [f.Cedula, f.Fecha]).slice(0, 2), [['9000000002', '2026-11-24'], ['9000000002', '2026-11-25']]);
    assert.equal(filas[0].Cargo, 'Agente');
    assert.equal(filas[0]['Centro de costo'], 'Claro');
    // Modelo Trabajo del contrato: presencial / trabajo en casa; híbrido queda vacío para que lo diga el jefe.
    assert.equal(filas[0]['Modelo Trabajo'], 'Presencial');
    assert.equal(filas.find((f) => f.Cedula === '9000000003')['Modelo Trabajo'], 'Trabajo en casa');
    assert.equal(filas.find((f) => f.Cedula === '9000000004')['Modelo Trabajo'], '');
    assert.equal(filas[0].Entrada, '');
});

test('precarga el horario que ya tiene la persona, con su modalidad del día, y los descansos con su novedad', () => {
    const existentes = new Map([
        ['1|2026-11-24', { es_descanso: 0, hora_entrada: '07:00:00', hora_salida: '16:00:00', minutos_almuerzo: 60, modalidad: 'virtual' }],
        ['1|2026-11-25', { es_descanso: 1, hora_entrada: '00:00:00', hora_salida: '00:00:00', notas: 'Malla: VACACIONES' }]
    ]);
    const [lunes, martes] = filasPlantilla({ equipo, fechas, existentes });
    assert.deepEqual([lunes.Entrada, lunes.Salida, lunes.Almuerzo, lunes['Modelo Trabajo']], ['07:00', '16:00', '01:00', 'Trabajo en casa']);
    assert.deepEqual([martes.Entrada, martes.Novedad, martes['Modelo Trabajo']], ['', 'VACACIONES', '']);
});

test('novedad de un descanso a partir de sus notas', () => {
    assert.equal(novedadDeDescanso('Malla: INC'), 'INC');
    assert.equal(novedadDeDescanso('Libre'), 'DESCANSO');
    assert.equal(novedadDeDescanso('Malla: Descanso'), 'DESCANSO');
    assert.equal(novedadDeDescanso(null), 'DESCANSO');
    assert.equal(novedadDeDescanso('Suspensión'), 'SUSPENSION');
});

test('rango: de hoy en adelante, en orden y hasta 62 días', () => {
    assert.equal(errorDeRango('2026-11-24', '2026-11-30', '2026-11-24', 7), null);
    assert.match(errorDeRango('2026-11-23', '2026-11-30', '2026-11-24', 8), /pasados/);
    assert.match(errorDeRango('2026-11-30', '2026-11-24', '2026-11-24', 0), /anterior/);
    assert.match(errorDeRango('2026-11-24', '2027-02-28', '2026-11-24', 63), /62/);
});

test('la plantilla se vuelve a leer con la malla: lo diligenciado se carga y lo vacío se omite', () => {
    const filas = filasPlantilla({ equipo: equipo.slice(0, 2), fechas });
    // El jefe llena tres días (uno de descanso) y deja uno vacío; Excel guarda las horas como fracción de día.
    filas[0].Entrada = 8 / 24; filas[0].Salida = 17 / 24; filas[0].Almuerzo = 0.5 / 24;
    filas[1].Novedad = 'DESCANSO';
    filas[2].Entrada = '09:00'; filas[2].Salida = '18:00'; filas[2]['Modelo Trabajo'] = 'Trabajo en casa';
    const ws = XLSX.utils.json_to_sheet(filas, { header: ENCABEZADOS });
    const leidas = XLSX.utils.sheet_to_json(ws, { raw: true, defval: null });
    const { faltantes, registros, errores, sinDiligenciar } = leerMalla(leidas);
    assert.deepEqual(faltantes, []);
    assert.deepEqual(errores, []);
    assert.equal(sinDiligenciar, 1);
    assert.deepEqual(registros.map((r) => [r.cedula, r.fecha, r.esDescanso, r.horaEntrada, r.minutosAlmuerzo, r.modalidad ?? null]), [
        ['9000000002', '2026-11-24', false, '08:00:00', 30, 'presencial'],
        ['9000000002', '2026-11-25', true, '00:00:00', 0, null],
        ['9000000003', '2026-11-24', false, '09:00:00', 0, 'virtual']
    ]);
});

test('listas desplegables: van antes de ignoredErrors y el libro se sigue leyendo', () => {
    const xml = '<worksheet><sheetData/><ignoredErrors><ignoredError sqref="A1"/></ignoredErrors></worksheet>';
    const conListas = insertarEnHoja(xml, [{ rango: 'J2:J9', opciones: ['Presencial', 'Trabajo en casa'] }]);
    assert.ok(conListas.indexOf('<dataValidations') < conListas.indexOf('<ignoredErrors'));
    assert.match(conListas, /sqref="J2:J9"><formula1>&quot;Presencial,Trabajo en casa&quot;<\/formula1>/);

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Cedula', 'Modelo Trabajo'], ['1', 'Presencial']]), 'Malla');
    const buffer = agregarListas(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }), 1, [
        { rango: 'B2:B2', opciones: ['Presencial', 'Trabajo en casa'], titulo: 'Modelo', mensaje: 'Elige' }
    ]);
    const zip = XLSX.CFB.read(buffer, { type: 'buffer' });
    const hoja = zip.FileIndex[zip.FullPaths.findIndex((p) => p.endsWith('/xl/worksheets/sheet1.xml'))];
    assert.match(Buffer.from(hoja.content).toString(), /<dataValidation type="list"/);
    const releido = XLSX.read(buffer, { type: 'buffer' });
    assert.deepEqual(XLSX.utils.sheet_to_json(releido.Sheets.Malla), [{ Cedula: '1', 'Modelo Trabajo': 'Presencial' }]);
});
