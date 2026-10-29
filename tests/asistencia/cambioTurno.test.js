const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ReglaAsistenciaError } = require('../../errors/AppError');
const {
    MAX_DIAS_CAMBIO_TURNO,
    assertFechasSolicitables,
    horarioNuevo,
    diasCambioHorario,
    diasIntercambio,
    resumenSolicitud,
    mensajes
} = require('../../domain/asistencia/cambioTurno');

const turno = (entrada, salida, extra = {}) => ({
    hora_entrada: entrada, hora_salida: salida, es_descanso: 0, minutos_almuerzo: 60,
    hora_almuerzo_inicio: null, tolerancia_entrada_min: 5, horario_plantilla_id: null, plantilla: null, ...extra
});

test('assertFechasSolicitables acepta hoy y días futuros', () => {
    assert.doesNotThrow(() => assertFechasSolicitables(['2026-10-29', '2026-10-30'], '2026-10-29'));
});

test('assertFechasSolicitables rechaza un día que ya pasó', () => {
    assert.throws(() => assertFechasSolicitables(['2026-10-28', '2026-10-29'], '2026-10-29'), ReglaAsistenciaError);
});

test('assertFechasSolicitables rechaza un rango vacío y uno de más de un mes', () => {
    assert.throws(() => assertFechasSolicitables([], '2026-10-29'), ReglaAsistenciaError);
    const muchas = Array.from({ length: MAX_DIAS_CAMBIO_TURNO + 1 }, (_, i) => `2026-11-${String((i % 28) + 1).padStart(2, '0')}`);
    assert.throws(() => assertFechasSolicitables(muchas, '2026-10-29'), ReglaAsistenciaError);
});

test('horarioNuevo con horas sueltas normaliza a HH:MM:SS', () => {
    const nuevo = horarioNuevo({ valores: { horaEntrada: '08:00', horaSalida: '17:00', minutosAlmuerzo: 30 } });
    assert.equal(nuevo.horaEntrada, '08:00:00');
    assert.equal(nuevo.horaSalida, '17:00:00');
    assert.equal(nuevo.minutosAlmuerzo, 30);
    assert.equal(nuevo.esDescanso, false);
});

test('horarioNuevo toma la plantilla', () => {
    const nuevo = horarioNuevo({ plantilla: { idhorario_plantilla: 7, ...turno('07:00:00', '16:00:00') } });
    assert.equal(nuevo.horarioPlantillaId, 7);
    assert.equal(nuevo.horaEntrada, '07:00:00');
});

test('horarioNuevo de descanso va en 00:00', () => {
    const nuevo = horarioNuevo({ esDescanso: true });
    assert.equal(nuevo.esDescanso, true);
    assert.equal(nuevo.horaEntrada, '00:00:00');
});

test('horarioNuevo rechaza sin horas y con la salida antes de la entrada', () => {
    assert.throws(() => horarioNuevo({ valores: {} }), ReglaAsistenciaError);
    assert.throws(() => horarioNuevo({ valores: { horaEntrada: '22:00', horaSalida: '06:00' } }), ReglaAsistenciaError);
});

test('diasCambioHorario guarda el horario anterior de cada día', () => {
    const nuevo = horarioNuevo({ valores: { horaEntrada: '10:00', horaSalida: '19:00' } });
    const actuales = new Map([['2026-10-30', turno('08:00:00', '17:00:00', { plantilla: 'Outbound 8-5' })]]);
    const dias = diasCambioHorario(5, ['2026-10-30', '2026-10-31'], nuevo, actuales);
    assert.equal(dias.length, 2);
    assert.equal(dias[0].anteriorHoraEntrada, '08:00:00');
    assert.equal(dias[0].anteriorPlantilla, 'Outbound 8-5');
    assert.equal(dias[1].anteriorHoraEntrada, null);
    assert.equal(dias[1].horaEntrada, '10:00:00');
});

test('diasIntercambio cruza los turnos', () => {
    const [a, b] = diasIntercambio(1, 2, '2026-10-30', turno('07:00:00', '16:00:00'), turno('14:00:00', '22:00:00'));
    assert.equal(a.usersCompanyId, 1);
    assert.equal(a.horaEntrada, '14:00:00');
    assert.equal(a.anteriorHoraEntrada, '07:00:00');
    assert.equal(b.horaEntrada, '07:00:00');
    assert.equal(b.anteriorHoraEntrada, '14:00:00');
});

test('diasIntercambio rechaza sin turno, misma persona o el mismo turno', () => {
    const t = turno('07:00:00', '16:00:00');
    assert.throws(() => diasIntercambio(1, 2, '2026-10-30', t, null), ReglaAsistenciaError);
    assert.throws(() => diasIntercambio(1, 1, '2026-10-30', t, t), ReglaAsistenciaError);
    assert.throws(() => diasIntercambio(1, 2, '2026-10-30', t, turno('07:00:00', '16:00:00')), ReglaAsistenciaError);
});

test('resumenSolicitud describe un cambio y un intercambio', () => {
    assert.equal(
        resumenSolicitud('cambio_horario', [{ empleado: 'Ana Pérez', fecha: '2026-10-31' }, { empleado: 'Ana Pérez', fecha: '2026-10-30' }]),
        'cambio de turno de Ana Pérez del 30/10 al 31/10'
    );
    assert.equal(
        resumenSolicitud('intercambio', [{ empleado: 'Ana Pérez', fecha: '2026-10-30' }, { empleado: 'Luis Gil', fecha: '2026-10-30' }]),
        'intercambio de turnos entre Ana Pérez y Luis Gil el 30/10'
    );
});

test('mensajes: rechazo con motivo y turno cambiado por día', () => {
    assert.equal(
        mensajes.rechazada('cambio de turno de Ana Pérez el 30/10', 'Kevin Buitrago', 'sin cobertura'),
        'Tu solicitud de cambio de turno de Ana Pérez el 30/10 fue rechazada por Kevin Buitrago. Motivo: sin cobertura'
    );
    assert.equal(
        mensajes.turnoCambiado([
            { fecha: '2026-10-31', es_descanso: 1, hora_entrada: '00:00:00', hora_salida: '00:00:00' },
            { fecha: '2026-10-30', es_descanso: 0, hora_entrada: '08:00:00', hora_salida: '17:00:00' }
        ]),
        'Tu turno cambió: 30/10 08:00–17:00, 31/10 descanso'
    );
});

test('mensajes se recortan a 255 caracteres', () => {
    const largo = mensajes.rechazada('cambio de turno', 'Jefe', 'x'.repeat(400));
    assert.equal(largo.length, 255);
    assert.ok(largo.endsWith('…'));
});

test('los nombres en mayúsculas salen con mayúscula inicial', () => {
    assert.equal(
        resumenSolicitud('cambio_horario', [{ empleado: 'MARÍA JOSÉ ÑÚÑEZ', fecha: '2026-10-30' }]),
        'cambio de turno de María José Ñúñez el 30/10'
    );
    assert.equal(mensajes.solicitada('NICOLE VALERIA CORREDOR', 'x'), 'Nicole Valeria Corredor solicita x');
});
