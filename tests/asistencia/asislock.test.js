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
    llaveEvento,
    llaveSesion,
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

test('llaveEvento: con id usa el id; sin id, cédula + fecha + hora del evento normalizadas', () => {
    assert.equal(llaveEvento({ id: 39150, usuario: '1010', fecha: '2026-10-19', hora_login: '12:31:58' }, 'login'), 'id:39150');
    const sinId = { usuario: '1.010', fecha: '19/10/2026', hora_login: '7:05', hora_logout: '12:40:00' };
    assert.equal(llaveEvento(sinId, 'login'), 'cc:1010|2026-10-19|07:05:00');
    assert.equal(llaveEvento(sinId, 'logout'), 'cc:1010|2026-10-19|12:40:00');
    assert.equal(llaveEvento({ ...sinId, id: null }, 'login'), 'cc:1010|2026-10-19|07:05:00');
    // un dato que no se puede interpretar entra crudo, para que su reenvío dé la misma llave
    assert.equal(llaveEvento({ usuario: '1010', fecha: 'ayer', hora_login: '25:00' }, 'login'), 'cc:1010|ayer|25:00');
});

test('llaveSesion: sin id se identifica por la hora del login; un logout suelto lleva "-"', () => {
    assert.equal(llaveSesion({ id: 7, usuario: '1010', fecha: '2026-10-19', hora_logout: '12:40' }), 'id:7');
    assert.equal(llaveSesion({ usuario: '1010', fecha: '2026-10-19', hora_login: '12:31:58', hora_logout: '12:40' }), 'cc:1010|2026-10-19|12:31:58');
    assert.equal(llaveSesion({ usuario: '1010', fecha: '2026-10-19', hora_login: null, hora_logout: '12:40' }), 'cc:1010|2026-10-19|-|12:40:00');
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

// --- Resumen para las pantallas (conectado_biometrico: Presencial / Teletrabajo) ---
const { modalidadIngreso, resumenDelDia } = require('../../domain/asistencia/asislock');

const aviso = (evento, hora, extra = {}) => ({
    evento, ocurrido_en: h(hora), resultado: 'registrado', conectado_biometrico: null,
    ip_local: '10.0.0.1', ip_publica: '200.1.1.1', aplicativo: 'Asislock', ...extra
});

test('modalidadIngreso: Presencial / Teletrabajo sin importar mayúsculas; close y vacío no dicen nada', () => {
    assert.equal(modalidadIngreso('Presencial'), 'presencial');
    assert.equal(modalidadIngreso(' TELETRABAJO '), 'teletrabajo');
    assert.equal(modalidadIngreso('close'), null);
    assert.equal(modalidadIngreso(null), null);
});

test('resumenDelDia: sin avisos válidos devuelve null', () => {
    assert.equal(resumenDelDia([]), null);
    assert.equal(resumenDelDia([aviso('login', '08:00:00', { resultado: 'rechazado' })]), null);
});

test('resumenDelDia: el logout con close no borra cómo entró; queda desconectado', () => {
    const r = resumenDelDia([
        aviso('login', '08:00:00', { conectado_biometrico: 'Presencial' }),
        aviso('logout', '12:00:00', { conectado_biometrico: 'close', ip_local: '10.0.0.9' })
    ]);
    assert.equal(r.modalidad, 'presencial');
    assert.deepEqual(r.modalidades, ['presencial']);
    assert.equal(r.primer_login.toISOString(), h('08:00:00').toISOString());
    assert.equal(r.conectado, false);
    assert.equal(r.ultimo_evento.evento, 'logout');
    assert.equal(r.ip_local, '10.0.0.1', 'las IP son las del último login');
});

test('resumenDelDia: si cambia de modalidad en el día manda el último login y se listan las dos', () => {
    const r = resumenDelDia([
        aviso('login', '08:00:00', { conectado_biometrico: 'Teletrabajo' }),
        aviso('logout', '10:00:00', { conectado_biometrico: 'close' }),
        aviso('login', '11:00:00', { conectado_biometrico: 'Presencial', resultado: 'ignorado' })
    ]);
    assert.equal(r.modalidad, 'presencial');
    assert.deepEqual(r.modalidades, ['teletrabajo', 'presencial']);
    assert.equal(r.conectado, true);
});

// --- Estados de pausa que manda AsisLock en estado_conexion ---

test('estado Break abre la pausa de break', () => {
    const d = decidirLogin({ eventos: [ev('entrada', '08:00:00')], instante: h('10:00:00'), estado: 'Break' });
    assert.equal(d.accion, 'pausa_break');
    assert.deepEqual(d.eventos, ['inicio_break']);
});

test('estado Conectado después de una pausa la cierra', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_break', '10:00:00')];
    const d = decidirLogin({ eventos, instante: h('10:10:00'), estado: 'Conectado' });
    assert.deepEqual(d.eventos, ['fin_break']);
});

test('cambiar de una pausa a otra cierra la anterior y abre la nueva', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_bano', '10:00:00')];
    const d = decidirLogin({ eventos, instante: h('10:05:00'), estado: 'Almuerzo' });
    assert.deepEqual(d.eventos, ['fin_bano', 'inicio_almuerzo']);
});

test('repetir el mismo estado de pausa se ignora (ya_en_pausa)', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('inicio_bano', '10:00:00')];
    assert.equal(decidirLogin({ eventos, instante: h('10:02:00'), estado: 'Baño' }).motivo, 'ya_en_pausa');
});

test('Capacitación (con acento) se normaliza y abre inicio_capacitacion', () => {
    const d = decidirLogin({ eventos: [ev('entrada', '08:00:00')], instante: h('10:00:00'), estado: 'Capacitación' });
    assert.deepEqual(d.eventos, ['inicio_capacitacion']);
});

test('una pausa sin entrada previa se ignora (sin_entrada)', () => {
    assert.equal(decidirLogin({ eventos: [], instante: h('10:00:00'), estado: 'Break' }).motivo, 'sin_entrada');
});

// --- Reapertura por hora extra aprobada (fase 2) ---

const HE = (ini, fin) => ({ hora_inicio: ini, hora_fin: fin, minutos_aprobados: 120 });

test('login tras la salida, dentro de una hora extra aprobada, reabre como inicio_extra', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00')];
    const d = decidirLogin({ eventos, instante: h('19:03:00'), estado: 'Conectado', fecha: FECHA, horasExtraAprobadas: [HE('19:00:00', '21:00:00')] });
    assert.deepEqual(d, { accion: 'entrada_extra', eventos: ['inicio_extra'], motivo: null });
});

test('login tras la salida sin hora extra aprobada se ignora (jornada_finalizada)', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00')];
    assert.equal(decidirLogin({ eventos, instante: h('19:03:00'), estado: 'Conectado', fecha: FECHA, horasExtraAprobadas: [] }).motivo, 'jornada_finalizada');
});

test('login fuera de la franja de la hora extra aprobada se ignora', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00')];
    assert.equal(decidirLogin({ eventos, instante: h('22:30:00'), estado: 'Conectado', fecha: FECHA, horasExtraAprobadas: [HE('19:00:00', '21:00:00')] }).motivo, 'jornada_finalizada');
});

test('logout con la hora extra abierta la cierra (fin_extra)', () => {
    const eventos = [ev('entrada', '08:00:00'), ev('salida', '17:00:00'), ev('inicio_extra', '19:03:00')];
    const d = decidirLogout({ eventos, horario: HORARIO, instante: h('21:10:00'), parametros: PARAMETROS });
    assert.deepEqual(d, { accion: 'fin_extra', eventos: ['fin_extra'], motivo: null });
});
