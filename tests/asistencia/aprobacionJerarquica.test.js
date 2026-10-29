const { test } = require('node:test');
const assert = require('node:assert/strict');

const { ReglaAsistenciaError } = require('../../errors/AppError');
const { assertAprobador, mensajesHoraExtra } = require('../../domain/asistencia/aprobacionJerarquica');

test('assertAprobador acepta un director distinto del jefe que solicita', () => {
    assert.doesNotThrow(() => assertAprobador(25, 21));
});

test('assertAprobador rechaza cuando el jefe no tiene quien lo apruebe', () => {
    assert.throws(() => assertAprobador(25, null), ReglaAsistenciaError);
    assert.throws(() => assertAprobador(25, undefined), ReglaAsistenciaError);
});

test('assertAprobador rechaza cuando la ficha se gestiona a sí misma', () => {
    assert.throws(() => assertAprobador(190, 190), /jefe que apruebe/);
});

test('mensaje de solicitud nombra a la persona o cuenta cuántas son', () => {
    assert.equal(
        mensajesHoraExtra.solicitada('KEVIN BUITRAGO', ['ANA PÉREZ'], '2026-10-30', '18:00:00', '20:00:00'),
        'Kevin Buitrago solicita horas extra para Ana Pérez el 30/10 de 18:00 a 20:00'
    );
    assert.equal(
        mensajesHoraExtra.solicitada('KEVIN BUITRAGO', ['ANA', 'LUIS', 'EVA'], '2026-10-30', '18:00', '20:00'),
        'Kevin Buitrago solicita horas extra para 3 personas el 30/10 de 18:00 a 20:00'
    );
});

test('mensajes de respuesta: aprobada, rechazada con y sin motivo, y aviso al empleado', () => {
    assert.equal(mensajesHoraExtra.aprobada('ANA PÉREZ', '2026-10-30', 'NELSON ACERO'), 'Las horas extra de Ana Pérez del 30/10 fueron aprobadas por Nelson Acero');
    assert.equal(
        mensajesHoraExtra.rechazada('ANA PÉREZ', '2026-10-30', 'NELSON ACERO', 'Sin presupuesto'),
        'Las horas extra de Ana Pérez del 30/10 fueron rechazadas por Nelson Acero. Motivo: Sin presupuesto'
    );
    assert.equal(mensajesHoraExtra.rechazada('ANA PÉREZ', '2026-10-30', 'NELSON ACERO', null), 'Las horas extra de Ana Pérez del 30/10 fueron rechazadas por Nelson Acero');
    assert.equal(mensajesHoraExtra.paraEmpleado('2026-10-30', '18:00:00', '20:00:00'), 'Tienes horas extra aprobadas el 30/10 de 18:00 a 20:00');
});

test('los mensajes no pasan de 255 caracteres', () => {
    const largo = mensajesHoraExtra.rechazada('ANA', '2026-10-30', 'NELSON', 'x'.repeat(400));
    assert.equal(largo.length, 255);
    assert.ok(largo.endsWith('…'));
});
