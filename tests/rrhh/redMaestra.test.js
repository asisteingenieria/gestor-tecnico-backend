const test = require('node:test');
const assert = require('node:assert/strict');
const rm = require('../../utils/redMaestra');

// Encabezados y filas tal como vienen en "PLANTILLA RM EJEMPLO.xlsx" (fecha como serial de Excel).
const ENCABEZADOS = ['DOCUMENTO', 'CEDULA', 'NOMBRE COMPLETO', 'CAMPAÑA', 'NOVEDADES', 'ESTADO AGENTE', 'CARGO RM',
    'ESTADO RM', 'REQUERIMIENTO', 'FECHA DE ENVIO', 'OBSERVACIÓN ', 'ESTADO REQUERIMIENTO'];
const FILA_PPT = ['PPT', 1402568, 'GUEDEZ VASQUEZ ADRIANNYS YASULIN', 'T&T INBOUND', 'ASESOR ACTIVO EN OTRO ALIADO',
    'ACTIVO', 'NO TRAMITADO', 'INACTIVO RM', 'REQ000008079444', 46325, 'CAMBIO DE CAMPAÑA', 'FINALIZADA'];
const FILA_CC = ['CEDULA', 53042178, 'PEÑUELA DIANA PAOLA', 'WCB MOVIL', null, 'ACTIVO', 'WEB CALL BACK (IN)',
    'ACTIVO RM', 'REQ000005133510', 45492, 'CAMBIO CAMPAÑA', 'FINALIZADA'];

const OPCIONES = [
    { id: 3, campo: 'cargo_rm', valor: 'NO TRAMITADO' },
    { id: 5, campo: 'cargo_rm', valor: 'WEB CALL BACK (IN)' },
    { id: 6, campo: 'estado_rm', valor: 'ACTIVO RM' },
    { id: 7, campo: 'estado_rm', valor: 'INACTIVO RM' },
    { id: 9, campo: 'observacion', valor: 'CAMBIO DE CAMPAÑA' },
    { id: 13, campo: 'estado_requerimiento', valor: 'FINALIZADA' }
];

test('lee la plantilla por nombre de columna, con el encabezado "OBSERVACIÓN " con espacio', () => {
    const { faltantes, filas } = rm.leerFilas([ENCABEZADOS, FILA_PPT, [null, null, ''], FILA_CC]);
    assert.deepEqual(faltantes, []);
    assert.equal(filas.length, 2, 'la fila vacía se salta');
    assert.equal(filas[0].fila, 2);
    assert.equal(filas[1].fila, 4);
    assert.equal(filas[0].cedula, '1402568');
    assert.equal(filas[0].requerimiento, 'REQ000008079444');
    assert.equal(filas[0].fecha_envio, '2026-10-30');
    assert.equal(filas[1].fecha_envio, '2024-07-19');
    assert.equal(filas[1].observacion, 'CAMBIO CAMPAÑA');
    assert.equal(filas[1].novedades, null);
});

test('sin columna CEDULA el archivo no se puede cargar', () => {
    const { faltantes } = rm.leerFilas([['DOCUMENTO', 'NOMBRE']]);
    assert.deepEqual(faltantes, ['CEDULA']);
});

test('cédula comparable: con puntos, como número decimal o con espacios', () => {
    assert.equal(rm.normalizarCedula('52.859.804'), '52859804');
    assert.equal(rm.normalizarCedula('52859804.0'), '52859804');
    assert.equal(rm.normalizarCedula(' 1402568 '), '1402568');
    assert.equal(rm.normalizarCedula(''), null);
});

test('fechas: serial de Excel, dd/mm/aaaa, aaaa-mm-dd e inválidas', () => {
    assert.equal(rm.fechaISO(45796), '2025-05-19');
    assert.equal(rm.fechaISO('05/11/2026'), '2026-11-05');
    assert.equal(rm.fechaISO('2026-11-05'), '2026-11-05');
    assert.equal(rm.fechaISO('31/02/2026'), null);
    assert.equal(rm.fechaISO('mañana'), null);
});

test('homologa "CAMBIO CAMPAÑA" con "CAMBIO DE CAMPAÑA" y "web call back (in)" con su opción', () => {
    assert.equal(rm.claveOpcion('CAMBIO CAMPAÑA'), rm.claveOpcion('Cambio de campaña'));
    assert.equal(rm.claveOpcion('web call back (in)'), rm.claveOpcion('WEB CALL BACK (IN)'));
    assert.notEqual(rm.claveOpcion('ACTIVO RM'), rm.claveOpcion('INACTIVO RM'));
});

test('resuelve cédulas y listas, y marca los valores nuevos una sola vez', () => {
    const { filas } = rm.leerFilas([ENCABEZADOS, FILA_PPT, FILA_CC, ['CEDULA', '999', 'X', '', '', 'ACTIVO', 'VACACIONES']]);
    const empleados = [
        { id: 10, cedula: '1402568', nombre: 'Adriannys', es_claro_vigente: 1 },
        { id: 11, cedula: '53.042.178', nombre: 'Diana', es_claro_vigente: 0 }
    ];
    const r = rm.resolverFilas(filas, empleados, OPCIONES);
    const [ppt, cc, desconocido] = r.filas;

    assert.equal(ppt.users_company_id, 10);
    assert.deepEqual(ppt.errores, []);
    assert.equal(ppt.ids.cargo_rm.id, 3);
    assert.equal(ppt.ids.estado_rm.id, 7);
    assert.equal(ppt.ids.observacion.id, 9);

    assert.equal(cc.users_company_id, 11, 'encuentra la cédula escrita con puntos en el Gestor');
    assert.equal(cc.ids.observacion.id, 9, 'CAMBIO CAMPAÑA = CAMBIO DE CAMPAÑA');
    assert.ok(cc.advertencias.some((a) => a.includes('No es un empleado vigente de Claro')));

    assert.equal(desconocido.users_company_id, null);
    assert.ok(desconocido.errores[0].includes('no está registrada'));
    assert.deepEqual(desconocido.ids.cargo_rm, { nuevo: 'VACACIONES' });
    assert.deepEqual(r.opciones_nuevas, [{ campo: 'cargo_rm', valor: 'VACACIONES' }]);
    assert.equal(desconocido.ids.estado_agente, undefined, 'la columna ESTADO AGENTE del Excel se ignora');
});

test('sin número de requerimiento no se cargan sus datos y se avisa', () => {
    const { filas } = rm.leerFilas([ENCABEZADOS, ['CEDULA', 1402568, '', '', '', '', '', '', '', 46325, 'INGRESO', 'PENDIENTE']]);
    const r = rm.resolverFilas(filas, [{ id: 10, cedula: '1402568', es_claro_vigente: 1 }], OPCIONES);
    assert.equal(r.filas[0].ids.observacion, undefined);
    assert.deepEqual(r.opciones_nuevas, [], 'no crea opciones de un requerimiento que no se va a cargar');
    assert.ok(r.filas[0].advertencias.some((a) => a.includes('Sin número de requerimiento')));
});

test('descarga: CC sale como CEDULA y la fecha como dd/mm/aaaa', () => {
    const [fila] = rm.filasExport([{
        tipo_documento: 'CC', cedula: '53042178', nombre: 'PEÑUELA DIANA PAOLA', campania: 'MOVIL',
        centro_costo: 'CBAM WEB CALL BACK', usuario_ssff: 'dpenuela', estado_rm: 'ACTIVO RM',
        req_numero: 'REQ000005133510', req_fecha_envio: '2024-07-19', estado_contrato: 'activo'
    }]);
    assert.equal(fila.DOCUMENTO, 'CEDULA');
    assert.equal(fila['FECHA DE ENVIO'], '19/07/2024');
    assert.equal(fila['CENTRO DE COSTO'], 'CBAM WEB CALL BACK');
    assert.equal(rm.documentoRM('PPT'), 'PPT');
});

test('el libro generado se vuelve a leer con la misma lectura del cargue', () => {
    const XLSX = require('xlsx');
    const buffer = rm.generarLibro([{
        tipo_documento: 'PPT', cedula: '1402568', nombre: 'GUEDEZ', estado_rm: 'INACTIVO RM',
        req_numero: 'REQ1', req_fecha_envio: '2026-10-30', req_observacion: 'CAMBIO DE CAMPAÑA'
    }], [{ cedula: '1402568', nombre: 'GUEDEZ', numero: 'REQ1', fecha_envio: '2026-10-30' }]);
    const leido = rm.parsearArchivo(buffer, XLSX);
    assert.equal(leido.hoja, 'Red Maestra');
    assert.equal(leido.filas[0].cedula, '1402568');
    assert.equal(leido.filas[0].fecha_envio, '2026-10-30');
    assert.equal(leido.filas[0].estado_rm, 'INACTIVO RM');
});

test('tipo de personal por cargo: agentes, coordinadores, backoffice y otros', () => {
    assert.equal(rm.tipoPersonal('AGENTE CALL CENTER'), 'agente');
    assert.equal(rm.tipoPersonal('Agente'), 'agente');
    assert.equal(rm.tipoPersonal('COORDINADOR CALL'), 'coordinador');
    assert.equal(rm.tipoPersonal('COORDINADOR BACKOFFICE PE'), 'coordinador');
    assert.equal(rm.tipoPersonal('BACKOFFICE'), 'backoffice');
    assert.equal(rm.tipoPersonal('BACKOFFICE PE'), 'backoffice');
    assert.equal(rm.tipoPersonal('JEFE DE BACKOFFICE'), 'otro');
    assert.equal(rm.tipoPersonal('ANALISTA DE CALIDAD'), 'otro');
    assert.equal(rm.tipoPersonal(null), 'otro');
});

test('el estado agente sale del estado del contrato en RRHH', () => {
    assert.equal(rm.estadoAgente('activo'), 'ACTIVO');
    assert.equal(rm.estadoAgente('periodo_prueba'), 'ACTIVO');
    assert.equal(rm.estadoAgente('suspendido'), 'ACTIVO');
    assert.equal(rm.estadoAgente('retirado'), 'RETIRADO');
    assert.equal(rm.estadoAgente('inactivo'), 'RETIRADO');
    assert.equal(rm.estadoAgente(null), null);
});
