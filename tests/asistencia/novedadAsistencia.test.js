const { test } = require('node:test');
const assert = require('node:assert/strict');

// Novedades de asistencia del coordinador: cambio de turno y libre (asistencia.md §86).
const { ReglaAsistenciaError } = require('../../errors/AppError');
const { diasLibre, resumenSolicitud, mensajes } = require('../../domain/asistencia/cambioTurno');
const { aprobadorDeNovedad } = require('../../domain/asistencia/aprobacionJerarquica');
const { resumenDeJornadas } = require('../../domain/asistencia/resumenMensual');

const COORDINADOR = 20;
const JEFE_OPERACIONES = 30;
const DIRECTOR = 40;

test('aprobadorDeNovedad: lo que pide el coordinador le llega al jefe de operaciones del empleado', () => {
    assert.equal(aprobadorDeNovedad({
        solicitanteId: COORDINADOR, gestorDelEmpleadoId: JEFE_OPERACIONES, gestorDelSolicitanteId: JEFE_OPERACIONES
    }), JEFE_OPERACIONES);
});

test('aprobadorDeNovedad: aunque el coordinador tenga otro jefe, aprueba quien gestiona al empleado', () => {
    assert.equal(aprobadorDeNovedad({
        solicitanteId: COORDINADOR, gestorDelEmpleadoId: JEFE_OPERACIONES, gestorDelSolicitanteId: DIRECTOR
    }), JEFE_OPERACIONES);
});

test('aprobadorDeNovedad: si pide el propio jefe de operaciones, aprueba su director (§51)', () => {
    assert.equal(aprobadorDeNovedad({
        solicitanteId: JEFE_OPERACIONES, gestorDelEmpleadoId: JEFE_OPERACIONES, gestorDelSolicitanteId: DIRECTOR
    }), DIRECTOR);
});

test('aprobadorDeNovedad: sin gestor del empleado ni del solicitante no hay aprobador', () => {
    assert.equal(aprobadorDeNovedad({ solicitanteId: COORDINADOR, gestorDelEmpleadoId: null, gestorDelSolicitanteId: null }), null);
});

const turno = (entrada, salida, extra = {}) => ({ hora_entrada: entrada, hora_salida: salida, es_descanso: 0, ...extra });

test('diasLibre: cada día queda como descanso y guarda el turno anterior', () => {
    const actuales = new Map([['2026-12-01', turno('08:00:00', '17:00:00')], ['2026-12-02', turno('09:00:00', '18:00:00')]]);
    const dias = diasLibre(7, ['2026-12-01', '2026-12-02'], actuales);
    assert.equal(dias.length, 2);
    assert.equal(dias[0].esDescanso, true);
    assert.equal(dias[0].horaEntrada, '00:00:00');
    assert.equal(dias[0].anteriorHoraEntrada, '08:00:00');
    assert.equal(dias[1].anteriorHoraSalida, '18:00:00');
});

test('diasLibre: salta los días que ya son de descanso en la malla', () => {
    const actuales = new Map([['2026-12-05', turno('08:00:00', '17:00:00')], ['2026-12-06', turno('00:00:00', '00:00:00', { es_descanso: 1 })]]);
    const dias = diasLibre(7, ['2026-12-05', '2026-12-06'], actuales);
    assert.deepEqual(dias.map((d) => d.fecha), ['2026-12-05']);
});

test('diasLibre: si todos los días ya son descanso, no hay nada que pedir', () => {
    const actuales = new Map([['2026-12-06', turno('00:00:00', '00:00:00', { es_descanso: 1 })]]);
    assert.throws(() => diasLibre(7, ['2026-12-06'], actuales), ReglaAsistenciaError);
});

test('diasLibre: un día sin horario asignado también se puede pedir libre', () => {
    const dias = diasLibre(7, ['2026-12-01'], new Map());
    assert.equal(dias.length, 1);
    assert.equal(dias[0].anteriorHoraEntrada, null);
});

test('resumenSolicitud y mensajes del libre', () => {
    const dias = [{ empleado: 'ANA MARÍA PÉREZ', fecha: '2026-12-01' }, { empleado: 'ANA MARÍA PÉREZ', fecha: '2026-12-02' }];
    assert.equal(resumenSolicitud('libre', dias), 'libre de Ana María Pérez del 01/12 al 02/12');
    assert.equal(mensajes.libreAprobado(dias), 'Tienes libre del 01/12 al 02/12');
    assert.equal(mensajes.libreAprobado([dias[0]]), 'Tienes libre el 01/12');
});

test('resumenDeJornadas: el día libre es un descanso marcado como libre, nunca ausencia', () => {
    const jornadas = [
        { fecha: '2026-12-01', estado: 'ausente', minutos_tarde: 0 },
        { fecha: '2026-12-02', estado: 'finalizada', minutos_tarde: 0, minutos_trabajados: 480 }
    ];
    const resumen = resumenDeJornadas(jornadas, new Map(), new Set(['2026-12-01', '2026-12-03']), new Set(['2026-12-01']));
    assert.equal(resumen.ausencias, 0);
    assert.equal(resumen.dias_descanso, 2);
    assert.equal(resumen.dias_libre, 1);
    const dia1 = resumen.dias.find((d) => d.fecha === '2026-12-01');
    const dia3 = resumen.dias.find((d) => d.fecha === '2026-12-03');
    assert.equal(dia1.estado, 'descanso');
    assert.equal(dia1.libre, true);
    assert.equal(dia3.estado, 'descanso');
    assert.equal(dia3.libre, undefined);
});
