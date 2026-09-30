const { test } = require('node:test');
const assert = require('node:assert/strict');

const calcularJornada = require('../../domain/asistencia/calcularJornada');
const { combinarFechaHora } = require('../../utils/fechaBogota');

const FECHA = '2026-09-15';
const HORARIO = {
    fecha: FECHA,
    hora_entrada: '08:00:00',
    hora_salida: '17:00:00',
    minutos_almuerzo: 60,
    hora_almuerzo_inicio: '12:30:00',
    tolerancia_entrada_min: 5
};

function horaDia(hhmmss) {
    return combinarFechaHora(FECHA, hhmmss);
}

function evento(tipo, hora) {
    return { tipo, ocurrido_en: horaDia(hora) };
}

test('sin evento entrada -> pendiente, todo en cero', () => {
    const resultado = calcularJornada([], HORARIO, horaDia('09:00:00'));
    assert.equal(resultado.estado, 'pendiente');
    assert.equal(resultado.minutosTrabajados, 0);
    assert.equal(resultado.puedeMarcarSalida, false);
});

test('jornada en curso sin pausas, entrada puntual', () => {
    const eventos = [evento('entrada', '08:00:00')];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('10:00:00'));
    assert.equal(resultado.estado, 'en_curso');
    assert.equal(resultado.minutosTrabajados, 120);
    assert.equal(resultado.minutosTarde, 0);
    assert.deepEqual(resultado.alertas, []);
});

test('llegada tarde más allá de la tolerancia', () => {
    // tolerancia 5 min; entrada 15 min tarde -> minutosTarde = 15 - 5 = 10
    const eventos = [evento('entrada', '08:15:00')];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('09:15:00'));
    assert.equal(resultado.minutosTarde, 10);
    assert.ok(resultado.alertas.includes('llegada_tarde'));
});

test('pausa de baño sin cerrar queda activa y se descuenta hasta `ahora`', () => {
    const eventos = [evento('entrada', '08:00:00'), evento('inicio_bano', '10:00:00')];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('10:20:00'));
    assert.equal(resultado.estado, 'en_pausa');
    assert.equal(resultado.pausaActiva.tipo, 'bano');
    assert.equal(resultado.pausaActiva.minutosTranscurridos, 20);
    // bruto 140 min - 20 min de pausa = 120
    assert.equal(resultado.minutosTrabajados, 120);
});

test('doble pausa: bano cerrado, luego almuerzo, ambos se acumulan por separado', () => {
    const eventos = [
        evento('entrada', '08:00:00'),
        evento('inicio_bano', '09:00:00'),
        evento('fin_bano', '09:10:00'),
        evento('inicio_almuerzo', '12:30:00'),
        evento('fin_almuerzo', '13:30:00')
    ];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('14:00:00'));
    assert.equal(resultado.minutosPausaBano, 10);
    assert.equal(resultado.minutosPausaAlmuerzo, 60);
    assert.equal(resultado.pausaActiva, null);
});

test('salida anticipada dentro de la ventana permitida', () => {
    const eventos = [evento('entrada', '08:00:00'), evento('salida', '16:55:00')];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('16:55:00'));
    assert.equal(resultado.estado, 'finalizada');
    assert.equal(resultado.minutosSalidaAnticipada, 5);
});

test('excedente sin hora extra aprobada no cuenta como extra y alerta', () => {
    const eventos = [evento('entrada', '08:00:00'), evento('salida', '17:30:00')];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('17:30:00'), []);
    assert.equal(resultado.minutosExtra, 0);
    assert.ok(resultado.alertas.includes('extra_sin_aprobar'));
});

test('excedente con hora extra aprobada cuenta hasta el tope aprobado', () => {
    const eventos = [evento('entrada', '08:00:00'), evento('salida', '17:30:00')];
    const aprobadas = [{ fecha: FECHA, minutos_aprobados: 20 }];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('17:30:00'), aprobadas);
    assert.equal(resultado.minutosExtra, 20);
    assert.ok(!resultado.alertas.includes('extra_sin_aprobar'));
});

test('baño excedido por pausa individual dispara alerta', () => {
    const eventos = [
        evento('entrada', '08:00:00'),
        evento('inicio_bano', '09:00:00'),
        evento('fin_bano', '09:20:00') // 20 min > límite de 15 por pausa
    ];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('10:00:00'));
    assert.ok(resultado.alertas.includes('bano_excedido'));
});

test('almuerzo fuera de horario programado dispara alerta con la desviación', () => {
    const eventos = [
        evento('entrada', '08:00:00'),
        evento('inicio_almuerzo', '12:50:00'), // 20 min tarde vs 12:30, umbral 15
        evento('fin_almuerzo', '13:50:00')
    ];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('14:00:00'));
    assert.equal(resultado.desviacionAlmuerzoMin, 20);
    assert.ok(resultado.alertas.includes('almuerzo_fuera_de_horario'));
});

test('sin horario asignado no bloquea la salida', () => {
    const eventos = [evento('entrada', '08:00:00')];
    const resultado = calcularJornada(eventos, null, horaDia('09:00:00'));
    assert.equal(resultado.puedeMarcarSalida, true);
    assert.equal(resultado.segundosParaHabilitarSalida, 0);
    assert.equal(resultado.minutosTarde, 0);
});

test('una salida de origen sistema (cierre automático) levanta la alerta sin_marcar_salida', () => {
    const eventos = [
        evento('entrada', '08:00:00'),
        { tipo: 'salida', ocurrido_en: horaDia('17:00:00'), origen: 'sistema' }
    ];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('20:00:00'));
    assert.ok(resultado.alertas.includes('sin_marcar_salida'));
});

test('una salida marcada por el propio empleado no levanta sin_marcar_salida', () => {
    const eventos = [
        evento('entrada', '08:00:00'),
        { tipo: 'salida', ocurrido_en: horaDia('17:00:00'), origen: 'empleado' }
    ];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('20:00:00'));
    assert.ok(!resultado.alertas.includes('sin_marcar_salida'));
});

test('un evento posterior a la salida (p. ej. una corrección manual mal ubicada) no genera minutos negativos', () => {
    const eventos = [
        evento('entrada', '08:00:00'),
        evento('salida', '17:00:00'),
        evento('inicio_bano', '17:05:00') // posterior a `fin`, no debería contarse
    ];
    const resultado = calcularJornada(eventos, HORARIO, horaDia('17:10:00'));
    assert.equal(resultado.minutosPausaBano, 0);
    assert.ok(resultado.minutosTrabajados >= 0);
});

test('puedeMarcarSalida se habilita dentro de la ventana de minutos_habilitar_salida', () => {
    const eventos = [evento('entrada', '08:00:00')];
    const lejos = calcularJornada(eventos, HORARIO, horaDia('16:30:00'));
    const cerca = calcularJornada(eventos, HORARIO, horaDia('16:52:00'));
    assert.equal(lejos.puedeMarcarSalida, false);
    assert.equal(cerca.puedeMarcarSalida, true);
});
