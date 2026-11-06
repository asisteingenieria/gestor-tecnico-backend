const test = require('node:test');
const assert = require('node:assert/strict');
const { aFecha, tipoNovedadDe, leerFila, fechasDeNombre, elegirDocumentos, INC } = require('../../utils/novedadesExcel');

test('convierte el serial de Excel y textos a fecha ISO', () => {
    assert.equal(aFecha(46237), '2026-08-03');
    assert.equal(aFecha('04/08/2026'), '2026-08-04');
    assert.equal(aFecha('2026-8-4'), '2026-08-04');
    assert.equal(aFecha(0), null);
    assert.equal(aFecha(''), null);
    assert.equal(aFecha('N/A'), null);
});

test('clasifica la incapacidad por origen, accidente y días', () => {
    assert.equal(tipoNovedadDe('INC', { origen: 'COMUN', dias: 2 }), INC.COMUN_CORTA);
    assert.equal(tipoNovedadDe('INC', { origen: 'COMUN', dias: 3 }), INC.COMUN_LARGA);
    assert.equal(tipoNovedadDe('INC', { origen: 'ACCIDENTE DE TRANSITO', dias: 1 }), INC.TRANSITO_CORTA);
    assert.equal(tipoNovedadDe('INC', { origen: null, accidenteTransito: true, dias: 10 }), INC.TRANSITO_LARGA);
    assert.equal(tipoNovedadDe('INC', { origen: 'ACCIDENTE DE TRABAJO', dias: 1 }), INC.TRABAJO);
    assert.equal(tipoNovedadDe('INC', { origen: null, dias: null }), INC.COMUN_LARGA);
});

test('las abreviaturas confirmadas van a su tipo del catálogo', () => {
    assert.equal(tipoNovedadDe('VACACIONES', {}), 'Vacaciones');
    assert.equal(tipoNovedadDe('SUSPENSION', {}), 'Suspensiones');
    assert.equal(tipoNovedadDe('LNR', {}), 'Licencia No remunerada');
    assert.equal(tipoNovedadDe('LR', {}), 'Licencia Remunerada');
    assert.equal(tipoNovedadDe('LM', {}), 'Licencia de Maternidad');
    assert.equal(tipoNovedadDe('LPL', {}), 'Licencia por luto');
    assert.equal(tipoNovedadDe('LP', {}), 'Licencia de paternidad');
    assert.equal(tipoNovedadDe('XYZ', {}), null);
});

test('lee una fila del Excel', () => {
    const f = leerFila({
        CEDULA: '1.023.456', Novedad: 'inc ', 'Origen de INC': 'COMUN', 'Accidente de transito': 'N/A',
        'Fecha Inicial': 46237, 'Fecha Final': 46238, 'Fecha Retorno': 46239, 'Total Dias': 2,
        'Fecha reportefecha reporte': 46236
    }, 5);
    assert.equal(f.cedula, '1023456');
    assert.equal(f.tipoNombre, INC.COMUN_CORTA);
    assert.equal(f.fechaInicial, '2026-08-03');
    assert.equal(f.fechaFinal, '2026-08-04');
    assert.equal(f.fechaReporte, '2026-08-02');
    assert.equal(f.accidenteTransito, false);
    assert.deepEqual(f.errores, []);
});

test('sin total de días lo calcula con las fechas; una fila incompleta trae errores', () => {
    const f = leerFila({ CEDULA: 1, Novedad: 'LR', 'Fecha Inicial': 46237, 'Fecha Final': 46239, 'Total Dias': null }, 2);
    assert.equal(f.totalDias, 3);
    const mala = leerFila({ CEDULA: '', Novedad: 'QQ', 'Fecha Inicial': null }, 3);
    assert.deepEqual(mala.errores, ['sin cédula', 'sin fecha inicial', 'tipo de novedad "QQ" no reconocido']);
});

test('lee las fechas del nombre del archivo', () => {
    assert.deepEqual(fechasDeNombre('01-10-2025 02-10-2025.pdf'), ['2025-10-01', '2025-10-02']);
    assert.deepEqual(fechasDeNombre('4-09-2025.pdf'), ['2025-09-04']);
    assert.deepEqual(fechasDeNombre('PEREZ JUAN.pdf'), []);
});

test('elige el documento por fecha inicial y carpeta del tipo', () => {
    const archivos = [
        { id: 1, subcarpeta: 'INC', nombre: '04-08-2026 05-08-2026.pdf' },
        { id: 2, subcarpeta: 'LNR', nombre: '04-08-2026.pdf' },
        { id: 3, subcarpeta: 'INC', nombre: '10-08-2026.pdf' },
        { id: 4, subcarpeta: null, nombre: '20-08-2026.pdf' }
    ];
    const inc = { abreviatura: 'INC', fechaInicial: '2026-08-04' };
    assert.deepEqual(elegirDocumentos(inc, archivos).elegidos.map(a => a.id), [1]);
    assert.deepEqual(elegirDocumentos(inc, archivos).descartados.map(a => a.id), [2]);
    assert.deepEqual(elegirDocumentos({ abreviatura: 'LNR', fechaInicial: '2026-08-04' }, archivos).elegidos.map(a => a.id), [2]);
    // Suelto en 6.NOVEDADES: sirve si no hay uno en la carpeta del tipo.
    assert.deepEqual(elegirDocumentos({ abreviatura: 'VACACIONES', fechaInicial: '2026-08-20' }, archivos).elegidos.map(a => a.id), [4]);
    // Carpeta de otro tipo: no se asocia.
    assert.deepEqual(elegirDocumentos({ abreviatura: 'SUSPENSION', fechaInicial: '2026-08-10' }, archivos).elegidos, []);
    // Un archivo ya usado no se da dos veces.
    assert.deepEqual(elegirDocumentos(inc, archivos, new Set([1])).elegidos, []);
});

test('luto: el documento puede estar en LDL o LR', () => {
    const archivos = [{ id: 7, subcarpeta: 'LDL', nombre: '01-09-2026.pdf' }];
    assert.deepEqual(elegirDocumentos({ abreviatura: 'LPL', fechaInicial: '2026-09-01' }, archivos).elegidos.map(a => a.id), [7]);
});
