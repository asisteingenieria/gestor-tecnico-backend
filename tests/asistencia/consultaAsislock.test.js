const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizarModalidad,
    modalidadDeContrato,
    modalidadDelDia,
    fechasDelRango,
    horarioParaAsislock,
    estadosDelDia
} = require('../../domain/asistencia/consultaAsislock');
const { combinarFechaHora } = require('../../utils/fechaBogota');

test('normalizarModalidad: presencial y las formas de virtual; híbrido y desconocido = null', () => {
    assert.equal(normalizarModalidad('Presencial'), 'presencial');
    assert.equal(normalizarModalidad(' PRESENCIAL '), 'presencial');
    assert.equal(normalizarModalidad('Teletrabajo'), 'virtual');
    assert.equal(normalizarModalidad('Remoto'), 'virtual');
    assert.equal(normalizarModalidad('TRABAJO EN CASA'), 'virtual');
    assert.equal(normalizarModalidad('virtual'), 'virtual');
    assert.equal(normalizarModalidad('Híbrido'), null);
    assert.equal(normalizarModalidad(''), null);
    assert.equal(normalizarModalidad(null), null);
});

test('modalidadDeContrato distingue híbrido', () => {
    assert.equal(modalidadDeContrato('Presencial'), 'presencial');
    assert.equal(modalidadDeContrato('Remoto'), 'virtual');
    assert.equal(modalidadDeContrato('Híbrido'), 'hibrido');
    assert.equal(modalidadDeContrato(null), null);
});

test('modalidadDelDia: manda la del horario; si no, la del contrato; híbrido sin dato = null', () => {
    assert.deepEqual(modalidadDelDia({ modalidad: 'virtual' }, 'presencial'), { modalidad: 'virtual', modalidad_origen: 'horario' });
    assert.deepEqual(modalidadDelDia({ modalidad: null }, 'presencial'), { modalidad: 'presencial', modalidad_origen: 'contrato' });
    assert.deepEqual(modalidadDelDia(null, 'virtual'), { modalidad: 'virtual', modalidad_origen: 'contrato' });
    assert.deepEqual(modalidadDelDia(null, 'hibrido'), { modalidad: null, modalidad_origen: null });
});

test('fechasDelRango incluye ambos extremos y cruza el mes', () => {
    assert.deepEqual(fechasDelRango('2026-11-29', '2026-12-02'), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
    assert.deepEqual(fechasDelRango('2026-11-11', '2026-11-11'), ['2026-11-11']);
});

test('horarioParaAsislock: un día por fecha, con turno, descanso o sin horario', () => {
    const dias = horarioParaAsislock({
        desde: '2026-11-11',
        hasta: '2026-11-13',
        modalidadContrato: 'presencial',
        horarios: [
            { fecha: new Date('2026-11-11T00:00:00Z'), hora_entrada: '08:00:00', hora_salida: '17:00:00', hora_almuerzo_inicio: null, minutos_almuerzo: 60, es_descanso: 0, modalidad: 'virtual', plantilla: 'Turno 8-17', notas: 'Malla' },
            { fecha: '2026-11-12', hora_entrada: '00:00:00', hora_salida: '00:00:00', minutos_almuerzo: 0, es_descanso: 1, modalidad: null, plantilla: null, notas: 'Malla: Libre' }
        ]
    });
    assert.equal(dias.length, 3);
    assert.deepEqual(dias[0], {
        fecha: '2026-11-11', tiene_horario: true, es_descanso: false, hora_entrada: '08:00:00', hora_salida: '17:00:00',
        hora_almuerzo_inicio: null, minutos_almuerzo: 60, plantilla: 'Turno 8-17', notas: 'Malla',
        modalidad: 'virtual', modalidad_origen: 'horario'
    });
    assert.equal(dias[1].es_descanso, true);
    assert.equal(dias[1].hora_entrada, null);
    assert.equal(dias[1].modalidad, 'presencial');
    assert.equal(dias[2].tiene_horario, false);
    assert.equal(dias[2].modalidad_origen, 'contrato');
});

test('estadosDelDia: línea de estados en hora de Bogotá y estado actual', () => {
    const ev = (tipo, hora, origen = 'asislock') => ({ tipo, ocurrido_en: combinarFechaHora('2026-11-11', hora), origen });
    const { estado_actual: actual, estados } = estadosDelDia([
        ev('inicio_break', '10:00:00'),
        ev('entrada', '08:01:30'),
        ev('fin_break', '10:15:00'),
        ev('inicio_bano', '11:00:00', 'empleado'),
        ev('fin_bano', '11:05:00', 'empleado'),
        ev('inicio_desconexion', '12:00:00'),
        ev('fin_desconexion', '12:10:00'),
        ev('inicio_almuerzo', '13:00:00')
    ], { estado: 'en_pausa' });
    assert.deepEqual(estados.map((e) => e.estado), ['conectado', 'break', 'conectado', 'bano', 'conectado', 'desconectado', 'conectado', 'almuerzo']);
    assert.equal(estados[0].hora, '08:01:30');
    assert.equal(estados[0].desde, '2026-11-11T13:01:30.000Z');
    assert.deepEqual(actual, { estado: 'almuerzo', desde: '2026-11-11T18:00:00.000Z', hora: '13:00:00', origen: 'asislock' });
});

test('estadosDelDia: sin eventos es sin_entrada, o ausente si la jornada quedó ausente; salida y extra', () => {
    assert.equal(estadosDelDia([], null).estado_actual.estado, 'sin_entrada');
    assert.equal(estadosDelDia([], { estado: 'ausente' }).estado_actual.estado, 'ausente');
    const ev = (tipo, hora) => ({ tipo, ocurrido_en: combinarFechaHora('2026-11-11', hora), origen: 'molinete' });
    const { estados } = estadosDelDia([ev('entrada', '08:00:00'), ev('salida', '17:00:00'), ev('inicio_extra', '19:00:00'), ev('fin_extra', '21:00:00')], null);
    assert.deepEqual(estados.map((e) => e.estado), ['conectado', 'finalizado', 'hora_extra', 'finalizado']);
});
