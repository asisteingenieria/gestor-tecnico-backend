const { test } = require('node:test');
const assert = require('node:assert/strict');

const calcularJornada = require('../../domain/asistencia/calcularJornada');
const { assertPuedeIniciarPausa } = require('../../domain/asistencia/reglasJornada');
const {
    PARAMETROS_DEFECTO,
    normalizarCedula,
    normalizarFecha,
    normalizarHora,
    instantesDelRegistro,
    motivoRechazoHora,
    desconexionAbierta,
    decidirLogin,
    decidirLogout
} = require('../../domain/asistencia/asislock');
const { combinarFechaHora } = require('../../utils/fechaBogota');

const FECHA = '2026-10-13';
const HORARIO = {
    fecha: FECHA,
    hora_entrada: '08:00:00',
    hora_salida: '17:00:00',
    minutos_almuerzo: 60,
    hora_almuerzo_inicio: null,
    tolerancia_entrada_min: 5,
    es_descanso: 0
};
const PARAMETROS = { ...PARAMETROS_DEFECTO };

const h = (hhmmss) => combinarFechaHora(FECHA, hhmmss);
const ev = (tipo, hora, origen = 'asislock') => ({ tipo, ocurrido_en: h(hora), origen });

// --- Normalización de los campos de login_biometrico ---

test('normalizarFecha acepta ISO y día/mes/año, y rechaza fechas imposibles', () => {
    assert.equal(normalizarFecha('2026-10-13'), '2026-10-13');
    assert.equal(normalizarFecha('2026/10/13'), '2026-10-13');
    assert.equal(normalizarFecha('13/10/2026'), '2026-10-13');
    assert.equal(normalizarFecha('13-10-2026'), '2026-10-13');
    assert.equal(normalizarFecha('2026-10-13 08:00:00'), '2026-10-13');
    assert.equal(normalizarFecha('2026-02-30'), null);
    assert.equal(normalizarFecha('ayer'), null);
    assert.equal(normalizarFecha(null), null);
});

test('normalizarHora completa los segundos y rechaza horas inválidas', () => {
    assert.equal(normalizarHora('8:05'), '08:05:00');
    assert.equal(normalizarHora('17:00:30'), '17:00:30');
    assert.equal(normalizarHora('24:00:00'), null);
    assert.equal(normalizarHora('07:61'), null);
    assert.equal(normalizarHora(null), null);
});

test('normalizarCedula quita puntos, espacios y guiones', () => {
    assert.equal(normalizarCedula('1.023.456.789'), '1023456789');
    assert.equal(normalizarCedula(' 52 859 804 '), '52859804');
    assert.equal(normalizarCedula(80767085), '80767085');
    assert.equal(normalizarCedula('  '), null);
});

test('instantesDelRegistro interpreta la hora como Bogotá (UTC-5)', () => {
    const r = instantesDelRegistro({ fecha: '2026-10-13', hora_login: '07:58:00', hora_logout: '17:02:00' });
    assert.equal(r.fecha, '2026-10-13');
    assert.equal(r.login.toISOString(), '2026-10-13T12:58:00.000Z');
    assert.equal(r.logout.toISOString(), '2026-10-13T22:02:00.000Z');
});

test('instantesDelRegistro: logout menor que el login cae al día siguiente', () => {
    const r = instantesDelRegistro({ fecha: '2026-10-13', hora_login: '22:00:00', hora_logout: '01:30:00' });
    assert.equal(r.logout.toISOString(), '2026-10-14T06:30:00.000Z');
});

test('instantesDelRegistro: login solo (todavía conectado) deja logout en null', () => {
    const r = instantesDelRegistro({ fecha: '2026-10-13', hora_login: '08:00:00', hora_logout: null });
    assert.equal(r.logout, null);
});

test('motivoRechazoHora: futuro más allá de la tolerancia y avisos demasiado viejos', () => {
    const ahora = h('10:00:00');
    assert.equal(motivoRechazoHora(h('10:04:00'), ahora, PARAMETROS), null);
    assert.equal(motivoRechazoHora(h('10:06:00'), ahora, PARAMETROS), 'hora_futura');
    const hace4Dias = new Date(ahora.getTime() - 4 * 24 * 3600000);
    assert.equal(motivoRechazoHora(hace4Dias, ahora, PARAMETROS), 'demasiado_antiguo');
});

// --- Login ---

test('primer login del día = entrada', () => {
    const d = decidirLogin({ eventos: [], instante: h('07:58:00') });
    assert.deepEqual(d, { accion: 'entrada', eventos: ['entrada'], motivo: null });
});

test('login con la jornada ya en curso se ignora (ya_conectado)', () => {
    const d = decidirLogin({ eventos: [ev('entrada', '08:00:00')], instante: h('09:00:00') });
    assert.equal(d.accion, null);
    assert.equal(d.motivo, 'ya_conectado');
});

test('login anterior a una entrada manual registra la entrada del biométrico', () => {
    const d = decidirLogin({ eventos: [ev('entrada', '08:10:00', 'empleado')], instante: h('07:55:00') });
    assert.equal(d.accion, 'entrada');
});

test('login con desconexión abierta = reconexión', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '10:00:00')];
    const d = decidirLogin({ eventos, instante: h('10:20:00') });
    assert.deepEqual(d, { accion: 'reconexion', eventos: ['fin_desconexion'], motivo: null });
});

test('login anterior al inicio de la desconexión abierta se ignora (fuera_de_orden)', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '10:00:00')];
    assert.equal(decidirLogin({ eventos, instante: h('09:30:00') }).motivo, 'fuera_de_orden');
});

test('login con la jornada finalizada se ignora', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00')];
    assert.equal(decidirLogin({ eventos, instante: h('17:30:00') }).motivo, 'jornada_finalizada');
});

// --- Logout ---

test('logout antes de la ventana de salida = desconexión', () => {
    const d = decidirLogout({ eventos: [ev('entrada', '08:00:00')], horario: HORARIO, instante: h('11:00:00'), parametros: PARAMETROS });
    assert.deepEqual(d, { accion: 'desconexion', eventos: ['inicio_desconexion'], motivo: null });
});

test('logout dentro de la ventana de salida (10 min antes) = salida', () => {
    const d = decidirLogout({ eventos: [ev('entrada', '08:00:00')], horario: HORARIO, instante: h('16:52:00'), parametros: PARAMETROS });
    assert.deepEqual(d, { accion: 'salida', eventos: ['salida'], motivo: null });
});

test('logout después de la hora de salida = salida', () => {
    const d = decidirLogout({ eventos: [ev('entrada', '08:00:00')], horario: HORARIO, instante: h('17:40:00'), parametros: PARAMETROS });
    assert.equal(d.accion, 'salida');
});

test('logout sin horario asignado = desconexión (la cierra el cierre del día)', () => {
    const d = decidirLogout({ eventos: [ev('entrada', '08:00:00')], horario: null, instante: h('17:00:00'), parametros: PARAMETROS });
    assert.equal(d.accion, 'desconexion');
});

test('logout con una pausa de baño abierta la cierra antes de desconectar', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_bano', '10:00:00', 'empleado')];
    const d = decidirLogout({ eventos, horario: HORARIO, instante: h('10:05:00'), parametros: PARAMETROS });
    assert.deepEqual(d.eventos, ['fin_bano', 'inicio_desconexion']);
});

test('logout sin entrada, repetido o anterior al último evento se ignora', () => {
    assert.equal(decidirLogout({ eventos: [], horario: HORARIO, instante: h('11:00:00'), parametros: PARAMETROS }).motivo, 'sin_entrada');
    const desconectado = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '10:00:00')];
    assert.equal(decidirLogout({ eventos: desconectado, horario: HORARIO, instante: h('10:30:00'), parametros: PARAMETROS }).motivo, 'ya_desconectado');
    const conPausa = [ev('entrada', '08:00:00'), ev('inicio_bano', '10:00:00', 'empleado'), ev('fin_bano', '10:10:00', 'empleado')];
    assert.equal(decidirLogout({ eventos: conPausa, horario: HORARIO, instante: h('10:05:00'), parametros: PARAMETROS }).motivo, 'fuera_de_orden');
    const cerrada = [ev('entrada', '08:00:00'), ev('salida', '17:00:00')];
    assert.equal(decidirLogout({ eventos: cerrada, horario: HORARIO, instante: h('17:05:00'), parametros: PARAMETROS }).motivo, 'jornada_finalizada');
});

// --- Cálculo de la jornada con desconexiones ---

test('una desconexión cerrada no cuenta como tiempo laborado', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '10:00:00'), ev('fin_desconexion', '10:30:00')];
    const r = calcularJornada(eventos, HORARIO, h('12:00:00'));
    assert.equal(r.minutosTrabajados, 4 * 60 - 30);
    assert.equal(r.minutosDesconexion, 30);
    assert.equal(r.estado, 'en_curso');
    assert.equal(r.desconexionActiva, null);
});

test('una desconexión abierta pone la jornada en pausa y congela el contador', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '10:00:00')];
    const r = calcularJornada(eventos, HORARIO, h('10:45:00'));
    assert.equal(r.estado, 'en_pausa');
    assert.equal(r.minutosTrabajados, 120);
    assert.equal(r.minutosDesconexion, 45);
    assert.equal(r.desconexionActiva.minutosTranscurridos, 45);
    assert.equal(r.pausaActiva, null);
});

test('salida en el mismo instante del logout (cierre del día) no suma desconexión', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '15:00:00'), ev('salida', '15:00:00')];
    const r = calcularJornada(eventos, HORARIO, h('23:30:00'));
    assert.equal(r.estado, 'finalizada');
    assert.equal(r.minutosTrabajados, 7 * 60);
    assert.equal(r.minutosDesconexion, 0);
    assert.equal(r.minutosSalidaAnticipada, 120);
    assert.ok(!r.alertas.includes('sin_marcar_salida'));
    assert.equal(desconexionAbierta(eventos.slice(0, 2)).toISOString(), h('15:00:00').toISOString());
});

test('desconexiones y pausas se descuentan juntas', () => {
    const eventos = [
        ev('entrada', '08:00:00'),
        ev('inicio_almuerzo', '12:00:00', 'empleado'), ev('fin_almuerzo', '13:00:00', 'empleado'),
        ev('inicio_desconexion', '15:00:00'), ev('fin_desconexion', '15:20:00'),
        ev('salida', '17:00:00')
    ];
    const r = calcularJornada(eventos, HORARIO, h('18:00:00'));
    assert.equal(r.minutosTrabajados, 9 * 60 - 60 - 20);
});

test('no se puede iniciar una pausa en Gestor estando desconectado de AsisLock', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_desconexion', '10:00:00')];
    const r = calcularJornada(eventos, HORARIO, h('10:05:00'));
    assert.throws(() => assertPuedeIniciarPausa(r, 'bano'), /desconectado de AsisLock/);
});
