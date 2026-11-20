const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { aSerial, fechasReales } = require('../../utils/excelFechas');

test('convierte dd/mm/aaaa, con hora y aaaa-mm-dd al serial de Excel', () => {
    assert.deepEqual(aSerial('01/11/2023'), { serial: 45231, conHora: false });
    assert.deepEqual(aSerial('2023-11-01'), { serial: 45231, conHora: false });
    assert.deepEqual(aSerial('19/11/2026 18:30'), { serial: 46345 + 0.7708333333333334, conHora: true });
    assert.equal(aSerial(''), null);
    assert.equal(aSerial('31/02/2026'), null);
    assert.equal(aSerial('Excel al 19/11/2026'), null);
});

test('las columnas "Fecha…" quedan como fecha real y el resto no cambia', () => {
    const ws = XLSX.utils.json_to_sheet([
        { Nombre: 'Ana', 'Fecha De Ingreso': '01/11/2023', 'FECHA DE ENVIO': '', 'Fecha De Registro': '19/11/2026 08:05', Nota: '01/11/2023' }
    ]);
    fechasReales(ws, XLSX);
    assert.equal(ws.B2.t, 'n');
    assert.equal(ws.B2.v, 45231);
    assert.equal(ws.B2.z, 'dd/mm/yyyy');
    assert.equal(ws.C2.t, 's');
    assert.equal(ws.D2.z, 'dd/mm/yyyy hh:mm');
    assert.equal(ws.E2.t, 's');

    const leido = XLSX.read(XLSX.write({ SheetNames: ['H'], Sheets: { H: ws } }, { type: 'buffer', bookType: 'xlsx' }), { cellDates: true });
    const celda = leido.Sheets.H.B2;
    assert.equal(celda.t, 'd');
    assert.equal(celda.v.toISOString().slice(0, 10), '2023-11-01');
});
