const { test } = require('node:test');
const assert = require('node:assert/strict');

const { clasificarHoraExtra, totalMinutos, claseDominante, aMinutos } = require('../../domain/asistencia/clasificarHoraExtra');

const NOCHE_7PM = { inicio: '19:00', fin: '06:00' };
const NOCHE_9PM = { inicio: '21:00', fin: '06:00' };
const TURNO_DIA = { entrada: '08:00', salida: '17:00' };

// Convierte los tramos a un objeto { clase: minutos } para comparar cómodo.
const mapa = (tramos) => Object.fromEntries(tramos.map((t) => [t.clase, t.minutos]));

test('aMinutos parsea HH:MM y HH:MM:SS', () => {
    assert.equal(aMinutos('00:00'), 0);
    assert.equal(aMinutos('19:00'), 1140);
    assert.equal(aMinutos('06:30:00'), 390);
    assert.equal(aMinutos('24:00'), null);
    assert.equal(aMinutos('7:5'), null);
});

test('ordinario con turno: extra de tarde antes de las 7pm es toda diurna', () => {
    const t = clasificarHoraExtra({
        inicio: '17:00', fin: '19:00', turno: TURNO_DIA,
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { extras_diurnas: 120 });
});

test('ordinario con turno: extra que cruza las 7pm se parte en diurna + nocturna', () => {
    const t = clasificarHoraExtra({
        inicio: '18:00', fin: '21:00', turno: TURNO_DIA,
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { extras_diurnas: 60, extras_nocturnas: 120 });
});

test('umbral parametrizado: con ventana de las 9pm, 19:00-21:00 es todo diurno', () => {
    const t = clasificarHoraExtra({
        inicio: '19:00', fin: '21:00', turno: TURNO_DIA,
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_9PM
    });
    assert.deepEqual(mapa(t), { extras_diurnas: 120 });
});

test('turno nocturno: horas dentro del turno de noche son recargo, no extra', () => {
    const t = clasificarHoraExtra({
        inicio: '22:00', fin: '23:00', turno: { entrada: '22:00', salida: '06:00' },
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { recargo_nocturno: 60 });
});

test('sin turno asignado: todo cuenta como extra (día ordinario, diurno)', () => {
    const t = clasificarHoraExtra({
        inicio: '13:00', fin: '15:00', turno: null,
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { extras_diurnas: 120 });
});

test('día de descanso: aunque haya turno, todo es extra', () => {
    const t = clasificarHoraExtra({
        inicio: '08:00', fin: '10:00', turno: { ...TURNO_DIA, esDescanso: true },
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { extras_diurnas: 120 });
});

test('domingo/festivo sin turno: extra dominical/festiva', () => {
    const t = clasificarHoraExtra({
        inicio: '08:00', fin: '10:00', turno: null,
        dia0EsFestivo: true, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { extras_dominicales_festivas: 120 });
});

test('festivo dentro del turno: recargo dominical/festivo (90%)', () => {
    const t = clasificarHoraExtra({
        inicio: '08:00', fin: '10:00', turno: TURNO_DIA,
        dia0EsFestivo: true, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { dominicales_festivas: 120 });
});

test('cruce de medianoche hacia un festivo: parte ordinaria nocturna + parte festiva', () => {
    const t = clasificarHoraExtra({
        inicio: '23:00', fin: '01:00', turno: null,
        dia0EsFestivo: false, dia1EsFestivo: true, ventanaNocturna: NOCHE_7PM
    });
    assert.deepEqual(mapa(t), { extras_nocturnas: 60, extras_dominicales_festivas: 60 });
});

test('helpers: total y clase dominante', () => {
    const tramos = [{ clase: 'extras_diurnas', minutos: 60 }, { clase: 'extras_nocturnas', minutos: 120 }];
    assert.equal(totalMinutos(tramos), 180);
    assert.equal(claseDominante(tramos), 'extras_nocturnas');
    assert.equal(claseDominante([]), null);
});

test('franja inválida lanza error', () => {
    assert.throws(() => clasificarHoraExtra({
        inicio: 'xx', fin: '10:00', turno: null,
        dia0EsFestivo: false, dia1EsFestivo: false, ventanaNocturna: NOCHE_7PM
    }));
});
