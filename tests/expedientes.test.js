const test = require('node:test');
const assert = require('node:assert/strict');
const {
    clasificarCarpeta, subtipoNovedad, nombreCarpetaEmpleado, claveSinOrden, ubicarArchivo
} = require('../utils/expedientes');

test('reconoce las seis carpetas sin importar número, espacios ni tildes', () => {
    assert.equal(clasificarCarpeta('1.SELECCION'), 'seleccion');
    assert.equal(clasificarCarpeta('1. SELECCIÓN'), 'seleccion');
    assert.equal(clasificarCarpeta('2. DOCUMENTOS'), 'documentos');
    assert.equal(clasificarCarpeta('2. DOCUMENTACIÓN'), 'documentos');
    assert.equal(clasificarCarpeta('3.CONTRATOS'), 'contrato');
    assert.equal(clasificarCarpeta('6. SST'), 'sst');
    assert.equal(clasificarCarpeta('4.RELACIONES LABORALES'), 'relaciones_laborales');
    assert.equal(clasificarCarpeta('4.NOVEDADES'), 'novedades');
    assert.equal(clasificarCarpeta('5.NOVEDAD'), 'novedades');
    assert.equal(clasificarCarpeta('1.NOVEDADES'), 'novedades');
    assert.equal(clasificarCarpeta('FOTOS'), null);
});

test('tolera los errores de escritura vistos en la carpeta compartida', () => {
    assert.equal(clasificarCarpeta('2.DOCUEMENTOS'), 'documentos');
    assert.equal(clasificarCarpeta('2.DOCUMETNOS'), 'documentos');
    assert.equal(clasificarCarpeta('3.CONTARTO'), 'contrato');
    assert.equal(clasificarCarpeta('4.RELACION LABORALES'), 'relaciones_laborales');
    assert.equal(subtipoNovedad('DIA FAMILIA'), 'DIA DE LA FAMILIA');
    assert.equal(subtipoNovedad('DIA DE LA FAMALIA'), 'DIA DE LA FAMILIA');
    assert.equal(subtipoNovedad('TELE TRABAJO'), 'TELETRABAJO');
    assert.equal(subtipoNovedad('OTROSI'), 'OTRO SI');
    assert.equal(subtipoNovedad('INCLUCION DE BENEFICIARIO'), 'INCLUSION DE BENEFICIARIO');
    assert.equal(subtipoNovedad('LAMADO DE ATENCION'), 'LLAMADO DE ATENCION');
    assert.equal(subtipoNovedad('TRASLADO DE EPS'), 'TRASLADO EPS');
});

test('las carpetas de novedades quedan con su abreviatura', () => {
    assert.equal(subtipoNovedad('INC'), 'INC');
    assert.equal(subtipoNovedad('INCAPACIDAD'), 'INC');
    assert.equal(subtipoNovedad('Incapacidades'), 'INC');
    assert.equal(subtipoNovedad('LICENCIA NO REMUNERADA'), 'LNR');
    assert.equal(subtipoNovedad('LR'), 'LR');
    assert.equal(subtipoNovedad('VACACIONES'), 'VACACIONES');
    assert.equal(subtipoNovedad('Suspensión'), 'SUSPENSION');
    assert.equal(subtipoNovedad('DIA DE LA FAMILIA'), 'DIA DE LA FAMILIA');
});

test('nombre de carpeta del empleado: apellidos y nombres, sin tildes', () => {
    assert.equal(nombreCarpetaEmpleado({
        primer_nombre: 'Karen', segundo_nombre: 'Stefany', primer_apellido: 'Barragán', segundo_apellido: 'Sánchez'
    }), 'BARRAGAN SANCHEZ KAREN STEFANY');
    assert.equal(nombreCarpetaEmpleado({ primer_nombre: 'Ana', primer_apellido: 'Díaz' }), 'DIAZ ANA');
    assert.equal(claveSinOrden('KAREN STEFANY BARRAGAN SANCHEZ'), claveSinOrden('BARRAGAN SANCHEZ KAREN STEFANY'));
});

test('ubica cada archivo en su carpeta normalizada', () => {
    assert.deepEqual(ubicarArchivo(['3. CONTRATO', 'contrato.pdf']),
        { categoria: 'contrato', subtipo: null, partes: ['3.CONTRATO', 'contrato.pdf'] });
    assert.deepEqual(ubicarArchivo(['4.NOVEDADES', 'INCAPACIDADES', '02-10-2025.pdf']),
        { categoria: 'novedades', subtipo: 'INC', partes: ['6.NOVEDADES', 'INC', '02-10-2025.pdf'] });
    // Un archivo suelto en NOVEDADES, sin subcarpeta, se queda en NOVEDADES.
    assert.deepEqual(ubicarArchivo(['5.NOVEDADES', 'x.pdf']),
        { categoria: 'novedades', subtipo: null, partes: ['6.NOVEDADES', 'x.pdf'] });
    // Suelto en la carpeta del empleado o en una carpeta desconocida: se copia igual, en OTROS.
    assert.deepEqual(ubicarArchivo(['hoja.pdf']), { categoria: null, partes: ['OTROS', 'hoja.pdf'] });
    assert.deepEqual(ubicarArchivo(['6.RETIRO', 'a.pdf']), { categoria: null, partes: ['OTROS', '6.RETIRO', 'a.pdf'] });
    // Otrosí y compromiso sueltos en la raíz del empleado: a contrato y relaciones laborales.
    assert.equal(ubicarArchivo(['OTRO SI', 'a.pdf']).categoria, 'contrato');
    assert.equal(ubicarArchivo(['5.COMPROMISO', 'a.pdf']).categoria, 'relaciones_laborales');
    // Dentro de NOVEDADES, "OTRO SI" sigue siendo una novedad.
    assert.deepEqual(ubicarArchivo(['4.NOVEDADES', 'OTROSI', 'a.pdf']).partes, ['6.NOVEDADES', 'OTRO SI', 'a.pdf']);
});

const { indexarFichas, asociarCarpeta, carpetaExpediente } = require('../utils/expedientes');
const { rutaSegura, nombreArchivoSeguro, RAIZ } = require('../utils/expedienteDisco');

const FICHAS = [
    { id: 1, cedula: '111', primer_nombre: 'Karen', segundo_nombre: 'Stefany', primer_apellido: 'Barragán', segundo_apellido: 'Sánchez' },
    { id: 2, cedula: '222', primer_nombre: 'Valentia', primer_apellido: 'Duarte', segundo_apellido: 'Gonzalez' },
    { id: 3, cedula: '333', primer_nombre: 'Juan', primer_apellido: 'Perez' },
    { id: 4, cedula: '444', primer_nombre: 'Juan', primer_apellido: 'Perez' }
];

test('asocia la carpeta a su ficha: exacto, otro orden, mal escrita, ambigua o sin ficha', () => {
    const idx = indexarFichas(FICHAS);
    assert.deepEqual([asociarCarpeta('BARRAGAN SANCHEZ KAREN STEFANY', idx).ficha.id, asociarCarpeta('BARRAGAN SANCHEZ KAREN STEFANY', idx).tipo], [1, 'exacto']);
    assert.equal(asociarCarpeta('KAREN STEFANY BARRAGÁN SÁNCHEZ', idx).tipo, 'sin_orden');
    const mal = asociarCarpeta('DUARTE GONZALEZ VALENTINA', idx);
    assert.equal(mal.tipo, 'aproximado');
    assert.equal(mal.ficha.id, 2);
    assert.equal(asociarCarpeta('PEREZ JUAN', idx).tipo, 'ambiguo');
    assert.equal(asociarCarpeta('OSORIO GRISALES JHONATAN', idx).tipo, 'sin_coincidencia');
});

test('carpeta del expediente de un empleado nuevo: año de ingreso y nombre', () => {
    assert.equal(carpetaExpediente(FICHAS[0], '2026-11-03'), '2026/BARRAGAN SANCHEZ KAREN STEFANY');
    assert.match(carpetaExpediente(FICHAS[2], null), /^\d{4}\/PEREZ JUAN$/);
});

test('las rutas del expediente no salen de storage/expedientes y los nombres se sanean', () => {
    assert.ok(rutaSegura('2026/PEREZ JUAN/1.SELECCION/a.pdf').startsWith(RAIZ));
    assert.equal(rutaSegura('../../.env'), null);
    assert.equal(rutaSegura('2026/../../x'), null);
    assert.equal(nombreArchivoSeguro('../../etc/passwd'), 'passwd');
    assert.equal(nombreArchivoSeguro('inc: 1/2?.pdf'), '2_.pdf');
    assert.equal(nombreArchivoSeguro('Incapacidad 02-10.pdf'), 'Incapacidad 02-10.pdf');
});
