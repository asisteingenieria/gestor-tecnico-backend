const test = require('node:test');
const assert = require('node:assert/strict');
const { presentarRetiro, destinatariosAvisoRetiro, mensajeAvisoRetiro, errorFechaRetiroRm } = require('../../domain/asistencia/retirosEquipo');

test('retiro sin fecha de Red Maestra queda pendiente; con fecha, quién la registró', () => {
    const pendiente = presentarRetiro({ empleado_id: 5, empleado_nombre: 'Ana', fecha_retiro: new Date('2026-11-03T00:00:00Z') });
    assert.equal(pendiente.pendiente, true);
    assert.equal(pendiente.fecha_retiro, '2026-11-03');
    assert.equal(pendiente.retiro_rm_registrado_por, null);

    const hecho = presentarRetiro({ empleado_id: 5, fecha_retiro_rm: '2026-11-05', retiro_rm_por_ficha: 'Kevin', retiro_rm_por_usuario: 'Admin' });
    assert.equal(hecho.pendiente, false);
    assert.equal(hecho.fecha_retiro_rm, '2026-11-05');
    assert.equal(hecho.retiro_rm_registrado_por, 'Kevin', 'si lo registró un jefe, se muestra el jefe');
});

test('el aviso va a las tres líneas de mando sin repetir, sin vacíos y sin el retirado', () => {
    assert.deepEqual(destinatariosAvisoRetiro({ empleadoId: 9, jefeInmediatoId: 3, jefeAreaId: 4, gestorAsistenciaId: 3 }), [3, 4]);
    assert.deepEqual(destinatariosAvisoRetiro({ empleadoId: 9, jefeInmediatoId: null, jefeAreaId: 9, gestorAsistenciaId: null }), []);
});

test('mensaje del aviso con la fecha y dentro de 255 caracteres', () => {
    assert.equal(
        mensajeAvisoRetiro({ nombre: 'Ana Pérez', fechaRetiro: '2026-11-03' }),
        'RRHH retiró a Ana Pérez (retiro 2026-11-03). Registra su retiro en la Red Maestra.'
    );
    assert.ok(mensajeAvisoRetiro({ nombre: 'x'.repeat(400) }).length <= 255);
});

test('la fecha de retiro en la Red Maestra no puede ser futura ni anterior al ingreso; vacía se permite', () => {
    const ctx = { hoy: '2026-11-12', fechaIngreso: '2026-09-01' };
    assert.equal(errorFechaRetiroRm('2026-11-10', ctx), null);
    assert.equal(errorFechaRetiroRm(null, ctx), null);
    assert.match(errorFechaRetiroRm('2026-11-13', ctx), /futura/);
    assert.match(errorFechaRetiroRm('2026-08-31', ctx), /anterior al ingreso/);
});
