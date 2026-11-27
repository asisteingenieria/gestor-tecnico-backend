const test = require('node:test');
const assert = require('node:assert/strict');
const { leerSolicitudes, planificar, filasPlantilla, errorDeRango } = require('../../domain/asistencia/horaExtraExcel');
const { validarLimites, minutosExtra } = require('../../domain/asistencia/limitesHoraExtra');

const fila = (extra = {}) => ({ Cedula: '1001', Nombre: 'ANA', Fecha: '2026-12-07', 'Hora inicio': '17:00', 'Hora fin': '19:00', Motivo: 'Cierre de mes', ...extra });

test('lee las filas con hora extra e ignora las vacías', () => {
    const r = leerSolicitudes([fila(), fila({ Fecha: '2026-12-08', 'Hora inicio': '', 'Hora fin': '', Motivo: '' })]);
    assert.equal(r.registros.length, 1);
    assert.equal(r.vacias, 1);
    assert.deepEqual({ ...r.registros[0], fila: 2 }, { fila: 2, cedula: '1001', nombre: 'ANA', fecha: '2026-12-07', horaInicio: '17:00', horaFin: '19:00', motivo: 'Cierre de mes' });
});

test('faltan columnas obligatorias', () => {
    const r = leerSolicitudes([{ Cedula: '1', Fecha: '2026-12-07' }]);
    assert.deepEqual(r.faltantes, ['inicio', 'fin', 'motivo']);
});

test('errores de fila: sin motivo, hora inválida, iguales y dos filas el mismo día', () => {
    const r = leerSolicitudes([
        fila({ Motivo: '' }),
        fila({ Cedula: '1002', 'Hora fin': '25:00' }),
        fila({ Cedula: '1003', 'Hora fin': '17:00' }),
        fila({ Cedula: '1004' }), fila({ Cedula: '1004', 'Hora inicio': '06:00', 'Hora fin': '07:00' })
    ]);
    assert.equal(r.registros.length, 0);
    assert.deepEqual(r.errores.map((e) => e.fila), [2, 3, 4, 5, 6]);
    assert.match(r.errores[0].motivo, /motivo/);
    assert.match(r.errores[3].motivo, /más de una hora extra/);
});

test('una hora fin menor que la de inicio cruza la medianoche y es válida', () => {
    const r = leerSolicitudes([fila({ 'Hora inicio': '22:00', 'Hora fin': '02:00' })]);
    assert.equal(r.errores.length, 0);
    assert.equal(r.registros[0].horaFin, '02:00');
});

test('planificar: fuera del equipo, antes del ingreso y ya pedida ese día', () => {
    const registros = [
        { fila: 2, cedula: '1', fecha: '2026-12-07' }, { fila: 3, cedula: '2', fecha: '2026-12-07' },
        { fila: 4, cedula: '3', fecha: '2026-12-01' }, { fila: 5, cedula: '4', fecha: '2026-12-07' }, { fila: 6, cedula: '5', fecha: '2026-12-07' }
    ];
    const equipo = new Map([
        ['1', { users_company_id: 1, nombre_propio: 'A' }], ['3', { users_company_id: 3, fecha_ingreso: '2026-12-05' }],
        ['4', { users_company_id: 4 }]
    ]);
    const yaPedidas = new Map([['4|2026-12-07', { estado: 'pendiente', hora_inicio: '17:00:00', hora_fin: '18:00:00' }]]);
    const r = planificar({ registros, equipo, cedulasRrhh: new Set(['2']), yaPedidas });
    assert.deepEqual(r.validas.map((v) => v.fila), [2]);
    assert.deepEqual(r.errores.map((e) => e.motivo), [
        'No es de tu equipo directo', 'Es anterior a su ingreso (05/12/2026)', 'Ya tiene una hora extra pendiente ese día (17:00-18:00)', 'Cédula sin ficha en RRHH'
    ]);
});

test('plantilla: una fila por persona y día desde su ingreso, con turno y lo ya pedido', () => {
    const filas = filasPlantilla({
        equipo: [{ users_company_id: 1, numero_identificacion: '1001', nombre_propio: 'ANA', fecha_ingreso: '2026-12-08' }],
        fechas: ['2026-12-07', '2026-12-08', '2026-12-09'],
        horarios: new Map([['1|2026-12-08', { hora_entrada: '08:00:00', hora_salida: '15:30:00' }], ['1|2026-12-09', { es_descanso: 1 }]]),
        yaPedidas: new Map([['1|2026-12-08', { estado: 'aprobada', hora_inicio: '15:30:00', hora_fin: '17:30:00' }]])
    });
    assert.deepEqual(filas.map((f) => [f.Fecha, f.Turno, f['Ya solicitada']]), [['2026-12-08', '08:00-15:30', 'Aprobada 15:30-17:30'], ['2026-12-09', 'Descanso', '']]);
    assert.equal(errorDeRango('2026-12-10', '2026-12-01', 1), 'La fecha final no puede ser anterior a la inicial');
});

// --- Límites legales (§91.1) ---
const extra = (minutos, clase = 'extras_diurnas') => [{ clase, minutos }];
const sol = (fecha, minutos, extraP = {}) => ({ fila: 2, users_company_id: 1, cedula: '1', nombre: 'ANA', fecha, tramos: extra(minutos), ...extraP });
const LIM = { maxDiariosMin: 120, maxSemanalesMin: 720 };

test('los recargos dentro del turno no cuentan como hora extra', () => {
    assert.equal(minutosExtra([{ clase: 'recargo_nocturno', minutos: 300 }, { clase: 'extras_nocturnas', minutos: 60 }]), 60);
});

test('más de 2 h extra en un día es error; 2 h exactas no', () => {
    assert.equal(validarLimites({ solicitudes: [sol('2026-12-07', 120)], ...LIM }).errores.length, 0);
    const r = validarLimites({ solicitudes: [sol('2026-12-07', 150)], ...LIM });
    assert.match(r.errores[0].motivo, /2 h 30 min de hora extra en el día: el máximo legal es 2 h diarias/);
});

test('más de 12 h extra en la semana, contando las ya pedidas, es error de las filas de esa semana', () => {
    const existentes = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'].map((f) => ({ users_company_id: 1, fecha: f, tramos: extra(120) }));
    // 10 h ya pedidas + 2 h = 12 h: pasa. + 2 h 30 min no, pero eso ya es error diario; con 2 h y otra de 1 h, 13 h.
    assert.equal(validarLimites({ solicitudes: [sol('2026-12-12', 120)], existentes, ...LIM }).errores.length, 0);
    const r = validarLimites({ solicitudes: [sol('2026-12-12', 120, { fila: 5 }), sol('2026-12-13', 60, { fila: 6 })], existentes, ...LIM });
    assert.deepEqual(r.errores.map((e) => e.fila), [5, 6]);
    assert.match(r.errores[0].motivo, /suma 13 h de hora extra con las ya pedidas: el máximo legal es 12 h semanales/);
    // Otra semana no se mezcla.
    assert.equal(validarLimites({ solicitudes: [sol('2026-12-14', 120)], existentes, ...LIM }).errores.length, 0);
});

test('3 domingos trabajados en el mes es aviso de trabajo dominical habitual, no error', () => {
    const horarios = [{ users_company_id: 1, fecha: '2026-12-06', es_descanso: 0 }, { users_company_id: 1, fecha: '2026-12-13', es_descanso: 0 }];
    const r = validarLimites({ solicitudes: [sol('2026-12-20', 60, { tramos: extra(60, 'extras_dominicales_festivas') })], horarios, ...LIM });
    assert.equal(r.errores.length, 0);
    assert.equal(r.avisos.length, 1);
    assert.equal(r.avisos[0].domingos, 3);
    // Con 2 domingos no avisa; y un descanso el domingo no cuenta.
    const dos = validarLimites({ solicitudes: [sol('2026-12-20', 60)], horarios: [horarios[0], { ...horarios[1], es_descanso: 1 }], ...LIM });
    assert.equal(dos.avisos.length, 0);
});

// --- Novedades (§91.2) ---
const { novedadesPorDia } = require('../../domain/asistencia/horaExtraExcel');
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('novedades por día: RRHH dentro del rango, votación no bloquea y cambios de turno pendientes sí', () => {
    const mapa = novedadesPorDia({
        novedadesRrhh: [
            { users_company_id: 1, tipo: 'Vacaciones', fecha_inicial: '2026-11-20', fecha_final: '2026-11-28' },
            { users_company_id: 2, tipo: 'Horas de votación', fecha_inicial: '2026-11-27', fecha_final: null }
        ],
        cambiosPendientes: [{ users_company_id: 3, fecha: '2026-11-27', tipo: 'libre' }],
        desde: '2026-11-26', hasta: '2026-11-27', sumarDias
    });
    assert.deepEqual([...mapa.keys()].sort(), ['1|2026-11-26', '1|2026-11-27', '2|2026-11-27', '3|2026-11-27']);
    assert.deepEqual(mapa.get('1|2026-11-27'), [{ texto: 'Vacaciones (20/11/2026 al 28/11/2026)', bloquea: true }]);
    assert.equal(mapa.get('2|2026-11-27')[0].bloquea, false);
    assert.deepEqual(mapa.get('3|2026-11-27'), [{ texto: 'Libre pendiente', bloquea: true }]);

    const equipo = new Map([['1', { users_company_id: 1 }], ['2', { users_company_id: 2 }], ['3', { users_company_id: 3 }]]);
    const registros = ['1', '2', '3'].map((c, i) => ({ fila: i + 2, cedula: c, fecha: '2026-11-27' }));
    const r = planificar({ registros, equipo, novedades: mapa });
    assert.deepEqual(r.validas.map((v) => v.cedula), ['2']);
    assert.match(r.errores[0].motivo, /Tiene novedad ese día: Vacaciones/);
    assert.match(r.errores[1].motivo, /Libre pendiente/);

    const filas = filasPlantilla({ equipo: [{ users_company_id: 1, numero_identificacion: '1' }], fechas: ['2026-11-27'], novedades: mapa });
    assert.equal(filas[0].Novedad, 'Vacaciones (20/11/2026 al 28/11/2026)');
});
