const { test } = require('node:test');
const assert = require('node:assert/strict');

const calcularJornada = require('../../domain/asistencia/calcularJornada');
const {
    sentidoDeLector,
    departamentosDe,
    decidirMarcacion,
    salidaDeCierre,
    resumenDelDia
} = require('../../domain/asistencia/molinete');
const { combinarFechaHora, textoBogotaAInstante, instanteATextoBogota } = require('../../utils/fechaBogota');

const FECHA = '2026-11-03';
const HORARIO = {
    fecha: FECHA,
    hora_entrada: '08:00:00',
    hora_salida: '17:00:00',
    minutos_almuerzo: 60,
    hora_almuerzo_inicio: null,
    tolerancia_entrada_min: 0,
    es_descanso: 0
};
const PARAMETROS = { ...calcularJornada.PARAMETROS_DEFECTO, minutos_habilitar_salida: 10 };

const h = (hhmmss) => combinarFechaHora(FECHA, hhmmss);
const ev = (tipo, hora) => ({ tipo, ocurrido_en: h(hora), origen: 'molinete' });
const decidir = (eventos, hora, sentido, extra = {}) =>
    decidirMarcacion({ eventos, horario: HORARIO, instante: h(hora), sentido, fecha: FECHA, parametros: PARAMETROS, ...extra });

// --- Lectura de los datos del molinete ---

test('sentidoDeLector toma el sufijo -In / -Out del reader_name', () => {
    assert.equal(sentidoDeLector('10.255.255.249-1-In'), 'entrada');
    assert.equal(sentidoDeLector('10.255.255.252-2-Out'), 'salida');
    assert.equal(sentidoDeLector('Other'), 'desconocido');
    assert.equal(sentidoDeLector(null), 'desconocido');
});

test('departamentosDe normaliza la lista del parámetro y cae a los de defecto si está vacía', () => {
    assert.deepEqual(departamentosDe('staff, Administrativo ,TECNOLOGIA'), ['STAFF', 'ADMINISTRATIVO', 'TECNOLOGIA']);
    assert.deepEqual(departamentosDe(''), ['STAFF', 'ADMINISTRATIVO', 'TECNOLOGIA']);
    assert.deepEqual(departamentosDe(undefined), ['STAFF', 'ADMINISTRATIVO', 'TECNOLOGIA']);
});

test('la hora del molinete (Bogotá, sin zona) se convierte a UTC y de vuelta', () => {
    const instante = textoBogotaAInstante('2026-11-03 11:12:58');
    assert.equal(instante.toISOString(), '2026-11-03T16:12:58.000Z');
    assert.equal(instanteATextoBogota(instante), '2026-11-03 11:12:58.000');
    assert.equal(textoBogotaAInstante('2026-11-03 11:12:58.387').toISOString(), '2026-11-03T16:12:58.387Z');
    assert.equal(textoBogotaAInstante('03/11/2026 11:12'), null);
});

// --- Decisión por marcación ---

test('la primera marcación del día es la entrada, por cualquier lector', () => {
    assert.deepEqual(decidir([], '07:55:00', 'entrada'), { accion: 'entrada', eventos: ['entrada'], motivo: null });
    // La primera marcación real de la persona de STAFF revisada fue por un lector de salida.
    assert.deepEqual(decidir([], '06:34:07', 'salida'), { accion: 'entrada', eventos: ['entrada'], motivo: null });
});

test('una marcación anterior a la entrada registrada (equipo que entregó tarde) la adelanta', () => {
    const r = decidir([ev('entrada', '08:10:00')], '07:58:00', 'entrada');
    assert.equal(r.accion, 'entrada');
});

test('las marcaciones intermedias son cruces: no producen eventos ni descuentan', () => {
    const eventos = [ev('entrada', '07:55:00')];
    assert.deepEqual(decidir(eventos, '10:30:00', 'salida'), { accion: 'cruce', eventos: [], motivo: null });
    assert.deepEqual(decidir(eventos, '10:46:00', 'entrada'), { accion: 'cruce', eventos: [], motivo: null });
    // Una salida antes de la ventana (16:50) sigue siendo cruce.
    assert.equal(decidir(eventos, '16:49:59', 'salida').accion, 'cruce');
});

test('una salida por lector de salida desde la ventana de salida cierra la jornada', () => {
    const eventos = [ev('entrada', '07:55:00')];
    assert.deepEqual(decidir(eventos, '16:50:00', 'salida'), { accion: 'salida', eventos: ['salida'], motivo: null });
    assert.deepEqual(decidir(eventos, '17:20:00', 'salida'), { accion: 'salida', eventos: ['salida'], motivo: null });
    // Por un lector de entrada no cierra.
    assert.equal(decidir(eventos, '17:20:00', 'entrada').accion, 'cruce');
});

test('sin horario o en día de descanso la salida no se cierra en vivo: la pone el cierre del día', () => {
    const eventos = [ev('entrada', '07:55:00')];
    assert.equal(decidir(eventos, '18:00:00', 'salida', { horario: null }).accion, 'cruce');
    assert.equal(decidir(eventos, '18:00:00', 'salida', { horario: { ...HORARIO, es_descanso: 1 } }).accion, 'cruce');
});

test('después de la salida se ignora, salvo en la franja de una hora extra aprobada', () => {
    const cerrada = [ev('entrada', '07:55:00'), ev('salida', '17:05:00')];
    assert.deepEqual(decidir(cerrada, '19:00:00', 'entrada'), { accion: null, eventos: [], motivo: 'jornada_finalizada' });

    const horasExtraAprobadas = [{ hora_inicio: '18:00:00', hora_fin: '20:00:00' }];
    assert.deepEqual(
        decidir(cerrada, '18:02:00', 'entrada', { horasExtraAprobadas }),
        { accion: 'entrada_extra', eventos: ['inicio_extra'], motivo: null }
    );
    const enExtra = [...cerrada, ev('inicio_extra', '18:02:00')];
    assert.equal(decidir(enExtra, '19:00:00', 'entrada', { horasExtraAprobadas }).accion, 'cruce');
    assert.deepEqual(
        decidir(enExtra, '20:01:00', 'salida', { horasExtraAprobadas }),
        { accion: 'fin_extra', eventos: ['fin_extra'], motivo: null }
    );
});

test('los cruces intermedios no descuentan tiempo trabajado', () => {
    // Solo entrada y salida llegan a jornada_evento; el cálculo da el día completo.
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00')];
    const estado = calcularJornada(eventos, HORARIO, h('20:00:00'), [], PARAMETROS);
    assert.equal(estado.minutosTrabajados, 9 * 60);
    assert.equal(estado.minutosTarde, 0);
});

// --- Cierre del día y resumen ---

test('salidaDeCierre toma la última marcación válida posterior a la entrada', () => {
    const marcaciones = [
        { ocurrido_en: h('08:00:00'), resultado: 'registrado' },
        { ocurrido_en: h('12:00:00'), resultado: 'registrado' },
        { ocurrido_en: h('15:30:00'), resultado: 'registrado' },
        { ocurrido_en: h('16:00:00'), resultado: 'rechazado' }
    ];
    assert.deepEqual(salidaDeCierre(marcaciones, h('08:00:00')), h('15:30:00'));
    assert.equal(salidaDeCierre([{ ocurrido_en: h('08:00:00'), resultado: 'registrado' }], h('08:00:00')), null);
});

test('resumenDelDia cuenta las marcaciones, los cruces y el último sentido', () => {
    const r = resumenDelDia([
        { ocurrido_en: 'a', sentido: 'entrada', accion: 'entrada', resultado: 'registrado' },
        { ocurrido_en: 'b', sentido: 'salida', accion: 'cruce', resultado: 'registrado' },
        { ocurrido_en: 'c', sentido: 'entrada', accion: 'cruce', resultado: 'registrado' },
        { ocurrido_en: 'd', sentido: 'salida', accion: 'salida', resultado: 'registrado' },
        { ocurrido_en: 'e', sentido: 'entrada', accion: null, resultado: 'rechazado' }
    ]);
    assert.deepEqual(r, {
        total: 4,
        cruces_intermedios: 2,
        primera: 'a',
        ultima: { ocurrido_en: 'd', sentido: 'salida' },
        entradas: 2,
        salidas: 2
    });
    assert.equal(resumenDelDia([]), null);
});
