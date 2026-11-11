const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    mapearColumnas,
    fechaDeCelda,
    minutosDeCelda,
    normalizarCedula,
    leerMalla,
    planificar
} = require('../../domain/asistencia/mallaHorarios');

// Serie de Excel del 2026-11-10 y horas como fracción de día, como las trae Mallas1.xlsx.
const SERIE_10_NOV = 46336;
const h = (hh, mm = 0) => (hh * 60 + mm) / 1440;
const fila = (extra = {}) => ({
    Cedula: '1000000001', Nombre: 'Persona Uno', Fecha: SERIE_10_NOV,
    Entrada: h(8), Salida: h(17), Tiempo_Almuerzo: h(0, 30),
    Entrada_Final: h(8), Salida_Final: h(17), Almuerzo_Final: h(0, 30), Novedad: null,
    ...extra
});

// --- Lectura de celdas ---

test('fechaDeCelda acepta la serie de Excel, ISO y día/mes/año', () => {
    assert.equal(fechaDeCelda(SERIE_10_NOV), '2026-11-10');
    assert.equal(fechaDeCelda(SERIE_10_NOV + 0.2), '2026-11-10');
    assert.equal(fechaDeCelda('2026-11-10'), '2026-11-10');
    assert.equal(fechaDeCelda('10/11/2026'), '2026-11-10');
    assert.equal(fechaDeCelda('31/02/2026'), null);
    assert.equal(fechaDeCelda(null), null);
});

test('minutosDeCelda acepta fracción de día, HH:MM y a. m./p. m.', () => {
    assert.equal(minutosDeCelda(h(8)), 480);
    assert.equal(minutosDeCelda(h(14, 30)), 870);
    assert.equal(minutosDeCelda(0), 0);
    assert.equal(minutosDeCelda('07:30'), 450);
    assert.equal(minutosDeCelda('2:30 p. m.'), 870);
    assert.equal(minutosDeCelda('12:00 a. m.'), 0);
    assert.equal(minutosDeCelda('25:00'), null);
    assert.equal(minutosDeCelda(''), null);
});

test('normalizarCedula limpia puntos y el .0 de Excel', () => {
    assert.equal(normalizarCedula('1.023.456.789'), '1023456789');
    assert.equal(normalizarCedula(1023456789), '1023456789');
    assert.equal(normalizarCedula('1023456789.0'), '1023456789');
    assert.equal(normalizarCedula('abc'), null);
});

test('mapearColumnas prefiere las columnas *_Final y reporta las obligatorias que faltan', () => {
    const { mapa, faltantes } = mapearColumnas(Object.keys(fila()));
    assert.equal(mapa.entrada, 'Entrada_Final');
    assert.equal(mapa.almuerzo, 'Almuerzo_Final');
    assert.deepEqual(faltantes, []);
    assert.equal(mapearColumnas(['CÉDULA', 'fecha', 'Entrada', 'Salida']).faltantes.length, 0);
    assert.deepEqual(mapearColumnas(['Cedula', 'Fecha']).faltantes, ['entrada', 'salida']);
});

// --- leerMalla ---

test('un turno normal: horas del *_Final y almuerzo como duración', () => {
    const { registros, errores } = leerMalla([fila({ Entrada_Final: h(9), Salida_Final: h(18) })]);
    assert.deepEqual(errores, []);
    assert.equal(registros.length, 1);
    assert.deepEqual(
        { ...registros[0] },
        { fila: 2, cedula: '1000000001', nombre: 'Persona Uno', fecha: '2026-11-10', novedad: null,
            esDescanso: false, horaEntrada: '09:00:00', horaSalida: '18:00:00', minutosAlmuerzo: 30, modalidad: null, notas: null }
    );
});

test('entrada 00:00 y las novedades de ausencia son descanso con la novedad en notas', () => {
    const { registros } = leerMalla([
        fila({ Entrada_Final: 0, Salida_Final: 0 }),
        fila({ Cedula: '1000000002', Novedad: 'Libre', Entrada_Final: 0, Salida_Final: 0 }),
        fila({ Cedula: '1000000003', Novedad: 'INC' }),
        fila({ Cedula: '1000000004', Novedad: 'VACACIONES' }),
        fila({ Cedula: '1000000005', Novedad: 'Turno ' })
    ]);
    assert.deepEqual(registros.map((r) => [r.esDescanso, r.notas]), [
        [true, 'Libre'], [true, 'Libre'], [true, 'INC'], [true, 'VACACIONES'], [false, null]
    ]);
    assert.equal(registros[2].horaEntrada, '00:00:00');
});

test('se rechazan: turno que cruza la medianoche, cédula o fecha inválida, y días repetidos', () => {
    const { registros, errores } = leerMalla([
        fila({ Entrada_Final: h(7), Salida_Final: h(2, 30) }),
        fila({ Cedula: 'x' }),
        fila({ Cedula: '1000000009', Fecha: 'mañana' }),
        fila({ Cedula: '1000000007' }),
        fila({ Cedula: '1000000007', Entrada_Final: h(10) })
    ]);
    assert.equal(registros.length, 0);
    assert.deepEqual(errores.map((e) => e.fila), [2, 3, 4, 5, 6]);
    assert.match(errores[0].motivo, /medianoche/);
    assert.match(errores[3].motivo, /más de una fila/);
});

test('sin las columnas obligatorias no lee nada y dice cuáles faltan', () => {
    const r = leerMalla([{ Cedula: '1', Fecha: SERIE_10_NOV }]);
    assert.deepEqual(r.faltantes, ['entrada', 'salida']);
    assert.equal(r.registros.length, 0);
});

// --- planificar ---

test('planificar: equipo directo de hoy en adelante; pasados, ajenos e inexistentes se omiten', () => {
    const { registros } = leerMalla([
        fila(),                                                     // nuevo
        fila({ Fecha: SERIE_10_NOV + 1 }),                          // reemplaza
        fila({ Fecha: SERIE_10_NOV + 2 }),                          // igual
        fila({ Fecha: SERIE_10_NOV - 10 }),                         // pasado
        fila({ Cedula: '2000000000' }),                             // no a cargo
        fila({ Cedula: '3000000000' })                              // no existe
    ]);
    const equipo = new Map([['1000000001', { users_company_id: 7, nombre_propio: 'Persona Uno RRHH', centro_costo_id: 5 }]]);
    const existentes = new Map([
        ['7|2026-11-11', { hora_entrada: '07:00:00', hora_salida: '16:00:00', minutos_almuerzo: 30, es_descanso: 0 }],
        ['7|2026-11-12', { hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 30, es_descanso: 0 }]
    ]);
    const plantillas = [
        { idhorario_plantilla: 1, nombre: 'General 8-17', hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 30, centro_costo_id: null },
        { idhorario_plantilla: 2, nombre: 'CBAT 8-17', hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 30, centro_costo_id: 5 }
    ];
    const { filas, resumen } = planificar({
        registros, hoy: '2026-11-03', equipo, cedulasRrhh: new Set(['1000000001', '2000000000']), existentes, plantillas
    });
    assert.deepEqual(filas.map((f) => f.estado), ['nuevo', 'reemplaza', 'igual', 'pasado', 'no_a_cargo', 'no_encontrado']);
    // La plantilla del mismo centro de costo gana a la general.
    assert.equal(filas[0].plantilla, 'CBAT 8-17');
    assert.equal(filas[0].nombre_rrhh, 'Persona Uno RRHH');
    assert.deepEqual(filas[1].anterior, { hora_entrada: '07:00:00', hora_salida: '16:00:00', es_descanso: false, modalidad: null });
    assert.equal(resumen.a_aplicar, 2);
    assert.equal(resumen.personas, 1);
});

test('planificar: el día de hoy sí se aplica', () => {
    const { registros } = leerMalla([fila()]);
    const equipo = new Map([['1000000001', { users_company_id: 7 }]]);
    const { filas } = planificar({ registros, hoy: '2026-11-10', equipo, cedulasRrhh: new Set(), existentes: new Map() });
    assert.equal(filas[0].estado, 'nuevo');
});

// --- Plantilla 01_Mallas_Operacion (sin Novedad ni *_Final) ---

const filaOperacion = (extra = {}) => ({
    Fecha: SERIE_10_NOV, Nombre: 'Persona Uno', 'Cédulaplataforma': '1000000001', Login: '789', Cargo: 'Agente',
    'Campaña': 'T&T', Coordinador: 'Coord', 'Modelo Trabajo': 'Presencial', Ciudad: 'Bogota',
    Entrada: h(8), Salida: h(18), 'Tiempo de Almuerzo': h(0, 20),
    ...extra
});

test('plantilla de operación: reconoce Cédulaplataforma y Tiempo de Almuerzo', () => {
    const { faltantes, registros, errores } = leerMalla([filaOperacion()]);
    assert.deepEqual(faltantes, []);
    assert.deepEqual(errores, []);
    assert.equal(registros[0].cedula, '1000000001');
    assert.equal(registros[0].horaSalida, '18:00:00');
    assert.equal(registros[0].minutosAlmuerzo, 20);
});

test('plantilla de operación: la novedad escrita en Entrada es descanso; Entrada vacía es error', () => {
    const { registros, errores } = leerMalla([
        filaOperacion({ Entrada: 'inc', Salida: null }),
        filaOperacion({ 'Cédulaplataforma': '1000000002', Entrada: ' Vacaciones ', Salida: '' }),
        filaOperacion({ 'Cédulaplataforma': '1000000003', Entrada: 0, Salida: 0 }),
        filaOperacion({ 'Cédulaplataforma': '1000000004', Entrada: null }),
        filaOperacion({ 'Cédulaplataforma': '1000000005', Entrada: 'turno raro' })
    ]);
    assert.deepEqual(registros.map((r) => [r.cedula, r.esDescanso, r.notas]), [
        ['1000000001', true, 'INC'], ['1000000002', true, 'VACACIONES'], ['1000000003', true, 'Libre']
    ]);
    assert.deepEqual(errores.map((e) => e.fila), [5, 6]);
    assert.match(errores[0].motivo, /entrada/i);
});

test('planificar: los turnos sin plantilla igual generan una plantilla nueva por turno distinto', () => {
    const { registros } = leerMalla([
        filaOperacion(),
        filaOperacion({ Fecha: SERIE_10_NOV + 1 }),
        filaOperacion({ Fecha: SERIE_10_NOV + 2, Entrada: h(7), Salida: h(16), 'Tiempo de Almuerzo': h(1) }),
        filaOperacion({ Fecha: SERIE_10_NOV + 3, Entrada: h(9), Salida: h(13), 'Tiempo de Almuerzo': 0 }),
        filaOperacion({ Fecha: SERIE_10_NOV + 4, Entrada: 'LIBRE' }),
        filaOperacion({ Fecha: SERIE_10_NOV - 10, Entrada: h(6), Salida: h(14) })   // pasado: no crea plantilla
    ]);
    const equipo = new Map([['1000000001', { users_company_id: 7, centro_costo_id: 5 }]]);
    const plantillas = [{ idhorario_plantilla: 9, nombre: 'Mañana', hora_entrada: '07:00:00', hora_salida: '16:00:00', minutos_almuerzo: 60, centro_costo_id: null }];
    const { filas, plantillasNuevas } = planificar({ registros, hoy: '2026-11-03', equipo, cedulasRrhh: new Set(), existentes: new Map(), plantillas });
    assert.deepEqual(plantillasNuevas.map((p) => p.nombre), ['Malla 08:00-18:00 · 20 min almuerzo', 'Malla 09:00-13:00']);
    assert.equal(filas[0].plantillaNueva, filas[1].plantillaNueva);
    assert.equal(filas[2].plantilla, 'Mañana');
    assert.equal(filas[2].plantillaNueva, null);
    assert.equal(filas[4].plantillaNueva, null);
});

test('Modelo Trabajo da la modalidad del día; un cambio solo de modalidad reemplaza (§58)', () => {
    const { registros } = leerMalla([
        fila({ Modelo_Trabajo: 'Presencial' }),
        fila({ Fecha: SERIE_10_NOV + 1, Modelo_Trabajo: 'Teletrabajo' }),
        fila({ Fecha: SERIE_10_NOV + 2, Modelo_Trabajo: 'Híbrido' }),
        fila({ Fecha: SERIE_10_NOV + 3, Modelo_Trabajo: 'Teletrabajo', Entrada_Final: 'LIBRE' })
    ]);
    assert.deepEqual(registros.map((r) => r.modalidad ?? null), ['presencial', 'virtual', null, null]);

    const equipo = new Map([['1000000001', { users_company_id: 7, nombre_propio: 'Persona Uno', centro_costo_id: null }]]);
    const mismoTurno = { hora_entrada: '08:00:00', hora_salida: '17:00:00', minutos_almuerzo: 30, es_descanso: 0 };
    const existentes = new Map([
        ['7|2026-11-10', { ...mismoTurno, modalidad: 'presencial' }],
        ['7|2026-11-11', { ...mismoTurno, modalidad: 'presencial' }],
        ['7|2026-11-12', { ...mismoTurno, modalidad: 'virtual' }]
    ]);
    const { filas } = planificar({ registros, hoy: '2026-11-03', equipo, cedulasRrhh: new Set(), existentes });
    // Igual / cambia a virtual / sin dato en la malla conserva lo que tiene / descanso nuevo.
    assert.deepEqual(filas.map((f) => f.estado), ['igual', 'reemplaza', 'igual', 'nuevo']);
});
