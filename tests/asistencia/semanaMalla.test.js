const test = require('node:test');
const assert = require('node:assert/strict');
const { validarSemanas, rangoDeSemanas, lunesDe, minutosDelDia, textoHoras } = require('../../domain/asistencia/semanaMalla');

// Semana del lunes 7 al domingo 13 de diciembre de 2026.
const SEMANA = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-13'];
const MIN_42 = 42 * 60;

let fila = 2;
const turno = (fecha, entrada, salida, almuerzo = 30, extra = {}) => ({
    fila: fila++, users_company_id: 1, cedula: '100', nombre: 'ANA', fecha,
    esDescanso: false, horaEntrada: `${entrada}:00`, horaSalida: `${salida}:00`, minutosAlmuerzo: almuerzo, novedad: null, ...extra
});
const descanso = (fecha, novedad = 'DESCANSO') => ({
    fila: fila++, users_company_id: 1, cedula: '100', nombre: 'ANA', fecha,
    esDescanso: true, horaEntrada: '00:00:00', horaSalida: '00:00:00', minutosAlmuerzo: 0, novedad
});
// Seis días de 08:00-15:30 con 30 min de almuerzo = 7 h × 6 = 42 h, y el domingo descanso.
const semanaBien = () => [...SEMANA.slice(0, 6).map((f) => turno(f, '08:00', '15:30')), descanso(SEMANA[6])];
const validar = (filas, extra = {}) => validarSemanas({ filas, existentes: new Map(), minutosSemana: MIN_42, ...extra });

test('lunes de la semana y rango de semanas completas', () => {
    assert.equal(lunesDe('2026-12-13'), '2026-12-07');
    assert.equal(lunesDe('2026-12-07'), '2026-12-07');
    assert.equal(lunesDe('2026-12-01'), '2026-11-30');
    assert.deepEqual(rangoDeSemanas(['2026-12-01', '2026-12-31']), { desde: '2026-11-30', hasta: '2027-01-03' });
});

test('las horas del día no cuentan el almuerzo', () => {
    assert.equal(minutosDelDia({ esDescanso: false, horaEntrada: '08:00:00', horaSalida: '15:30:00', minutosAlmuerzo: 30 }), 420);
    assert.equal(minutosDelDia({ esDescanso: true, horaEntrada: '00:00:00', horaSalida: '00:00:00', minutosAlmuerzo: 0 }), 0);
    assert.equal(textoHoras(2490), '41 h 30 min');
});

test('42 h exactas con un descanso: sin desajustes', () => {
    const r = validar(semanaBien());
    assert.equal(r.desajustes.length, 0);
    assert.equal(r.sinValidar.length, 0);
});

test('menos de 42 h: desajuste con las filas de esa semana', () => {
    const filas = semanaBien();
    filas[0] = turno(SEMANA[0], '08:00', '15:00');
    const r = validar(filas);
    assert.equal(r.desajustes.length, 1);
    assert.equal(r.desajustes[0].horas, '41 h 30 min');
    assert.match(r.desajustes[0].problemas[0], /faltan 30 min/);
    assert.deepEqual(r.desajustes[0].filas, filas.map((f) => f.fila).sort((a, b) => a - b));
});

test('más de 42 h: desajuste', () => {
    const filas = semanaBien();
    filas[1] = turno(SEMANA[1], '08:00', '17:00');
    const r = validar(filas);
    assert.equal(r.desajustes.length, 1);
    assert.match(r.desajustes[0].problemas[0], /se pasa 1 h 30 min/);
});

test('sin día de descanso: desajuste aunque sume 42 h', () => {
    // Siete días de 6 h = 42 h, pero ninguno de descanso.
    const filas = SEMANA.map((f) => turno(f, '08:00', '14:00', 0));
    const r = validar(filas);
    assert.equal(r.desajustes.length, 1);
    assert.deepEqual(r.desajustes[0].problemas, ['No tiene ningún día de descanso en la semana']);
});

test('semana incompleta se completa con lo ya cargado', () => {
    const filas = semanaBien().slice(2); // el Excel empieza el miércoles
    const existentes = new Map(SEMANA.slice(0, 2).map((f) => [`1|${f}`, { es_descanso: 0, hora_entrada: '08:00:00', hora_salida: '15:30:00', minutos_almuerzo: 30, notas: null }]));
    assert.equal(validar(filas, { existentes }).desajustes.length, 0);
    // Lo ya cargado también cuenta para las horas: si el lunes cargado era corto, no cuadra.
    existentes.set(`1|${SEMANA[0]}`, { es_descanso: 0, hora_entrada: '08:00:00', hora_salida: '12:00:00', minutos_almuerzo: 0, notas: null });
    assert.equal(validar(filas, { existentes }).desajustes.length, 1);
});

test('semana incompleta sin nada cargado: no se valida y se avisa', () => {
    const r = validar(semanaBien().slice(2));
    assert.equal(r.desajustes.length, 0);
    assert.equal(r.sinValidar.length, 1);
    assert.match(r.sinValidar[0].motivo, /2 días sin horario/);
});

test('semana con vacaciones en la malla o novedad de RRHH: no se valida', () => {
    const conVacaciones = semanaBien();
    conVacaciones[0] = descanso(SEMANA[0], 'VACACIONES');
    let r = validar(conVacaciones);
    assert.equal(r.desajustes.length, 0);
    assert.match(r.sinValidar[0].motivo, /VACACIONES/);

    const corta = semanaBien();
    corta[0] = turno(SEMANA[0], '08:00', '10:00');
    r = validar(corta, { novedadesRrhh: [{ users_company_id: 1, tipo: 'Incapacidad', fecha_inicial: '2026-12-01', fecha_final: '2026-12-08' }] });
    assert.equal(r.desajustes.length, 0);
    assert.match(r.sinValidar[0].motivo, /Incapacidad/);
});

test('un libre aprobado ya cargado cuenta como descanso', () => {
    const filas = semanaBien().slice(0, 6);
    const existentes = new Map([[`1|${SEMANA[6]}`, { es_descanso: 1, es_libre: 1, hora_entrada: '00:00:00', hora_salida: '00:00:00', minutos_almuerzo: 0, notas: 'Libre' }]]);
    assert.equal(validar(filas, { existentes }).desajustes.length, 0);
});

test('cada semana se valida por separado', () => {
    const segunda = semanaBien().map((f) => ({ ...f, fila: fila++, fecha: new Date(new Date(`${f.fecha}T00:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10) }));
    segunda[0] = { ...segunda[0], horaSalida: '14:00:00' };
    const r = validar([...semanaBien(), ...segunda]);
    assert.equal(r.desajustes.length, 1);
    assert.equal(r.desajustes[0].semana_desde, '2026-12-14');
});
