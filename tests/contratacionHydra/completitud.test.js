const { test } = require('node:test');
const assert = require('node:assert/strict');

const { evaluarCompletitud, hashSeccion } = require('../../domain/contratacionHydra/completitud');
const { CLAVES_SECCION } = require('../../domain/contratacionHydra/secciones');
const { datosEmpleadoVacio } = require('../../domain/contratacionHydra/mapearPayloadHydra');
const { datosEmpleadoCompletos } = require('./fixtures');

// Todas las secciones marcadas con el hash de su contenido actual.
function verificarTodo(datos) {
    return CLAVES_SECCION.map((seccion) => ({ seccion, hash_contenido: hashSeccion(datos, seccion) }));
}

function rutasConProblema(evaluacion, seccion) {
    return evaluacion.secciones[seccion].problemas.map((p) => p.ruta);
}

test('un borrador vacío reporta los obligatorios de personal, contrato y salario', () => {
    const { secciones, listo } = evaluarCompletitud(datosEmpleadoVacio());

    assert.equal(listo, false);
    assert.deepEqual(rutasConProblema({ secciones }, 'personal').sort(),
        ['numero_identificacion', 'primer_apellido', 'primer_nombre', 'tipo_identificacion_id']);
    assert.equal(secciones.contrato.problemas.length, 9);
    assert.deepEqual(rutasConProblema({ secciones }, 'salario'), ['salario.salario']);
});

test('las secciones sin obligatorios quedan completas aunque estén vacías', () => {
    const { secciones } = evaluarCompletitud(datosEmpleadoVacio());
    for (const clave of ['seguridad_social', 'cuenta_bancaria', 'direccion_contacto', 'dotacion']) {
        assert.equal(secciones[clave].completa, true, clave);
    }
});

test('con todos los obligatorios, todas las secciones están completas pero no listas sin verificar', () => {
    const { secciones, listo } = evaluarCompletitud(datosEmpleadoCompletos());
    assert.ok(Object.values(secciones).every((s) => s.completa));
    assert.ok(Object.values(secciones).every((s) => !s.verificada));
    assert.equal(listo, false);
});

test('completo y con todas las secciones verificadas → listo', () => {
    const datos = datosEmpleadoCompletos();
    assert.equal(evaluarCompletitud(datos, verificarTodo(datos)).listo, true);
});

test('editar una sección verificada la deja verificada pero NO vigente, y el candidato deja de estar listo', () => {
    const datos = datosEmpleadoCompletos();
    const verificaciones = verificarTodo(datos);
    const editado = datosEmpleadoCompletos({ 'salario.salario': 1600000 });

    const { secciones, listo } = evaluarCompletitud(editado, verificaciones);
    assert.equal(secciones.salario.verificada, true);
    assert.equal(secciones.salario.vigente, false);
    assert.equal(secciones.contrato.vigente, true);
    assert.equal(listo, false);
});

test('salario en cero o negativo no completa la sección', () => {
    const { secciones } = evaluarCompletitud(datosEmpleadoCompletos({ 'salario.salario': 0 }));
    assert.equal(secciones.salario.completa, false);
    assert.match(secciones.salario.problemas[0].mensaje, /mayor a cero/);
});

test('tarifa ARL fuera de 0-100 bloquea seguridad social', () => {
    const { secciones } = evaluarCompletitud(datosEmpleadoCompletos({ 'seguridad_social.tarifa_arl': 150 }));
    assert.equal(secciones.seguridad_social.completa, false);
});

test('cuenta bancaria a medias bloquea: UserCompany la descartaría en silencio', () => {
    const { secciones } = evaluarCompletitud(datosEmpleadoCompletos({ 'cuenta_bancaria.numero_cuenta': '123456' }));
    assert.equal(secciones.cuenta_bancaria.completa, false);
    assert.deepEqual(rutasConProblema({ secciones }, 'cuenta_bancaria').sort(),
        ['cuenta_bancaria.banco_id', 'cuenta_bancaria.tipo_cuenta_id']);
});

test('dirección sin tipo de dirección bloquea direccion_contacto', () => {
    const { secciones } = evaluarCompletitud(datosEmpleadoCompletos({ 'direccion.direccion': 'Cra 10 # 20-30' }));
    assert.deepEqual(rutasConProblema({ secciones }, 'direccion_contacto'), ['direccion.tipo_direccion_id']);
});

test('un valor de Hydra sin mapear bloquea mientras el campo siga vacío', () => {
    const sinMapear = [{ ruta: 'genero_id', catalogo: 'genero', valorHydra: 'no_binario' }];

    const vacio = evaluarCompletitud(datosEmpleadoCompletos(), [], { sinMapear });
    assert.equal(vacio.secciones.personal.completa, false);
    assert.match(vacio.secciones.personal.problemas[0].mensaje, /no_binario/);

    const resuelto = evaluarCompletitud(datosEmpleadoCompletos({ genero_id: 3 }), [], { sinMapear });
    assert.equal(resuelto.secciones.personal.completa, true);
});

test('un reintegro pendiente bloquea la sección personal', () => {
    const { secciones } = evaluarCompletitud(datosEmpleadoCompletos(), [], { reintegroPendiente: true });
    assert.equal(secciones.personal.completa, false);
});

test('una sección verificada que deja de estar completa impide que el candidato esté listo', () => {
    const datos = datosEmpleadoCompletos();
    const resultado = evaluarCompletitud(datos, verificarTodo(datos), { reintegroPendiente: true });
    assert.equal(resultado.secciones.personal.vigente, true);
    assert.equal(resultado.listo, false);
});

test('hashSeccion: 5 y "5" o "" y null producen el mismo hash', () => {
    const conNumero = datosEmpleadoCompletos({ 'salario.salario': 1423500, 'salario.bono_cafeteria': null });
    const conTexto = datosEmpleadoCompletos({ 'salario.salario': '1423500', 'salario.bono_cafeteria': '' });
    assert.equal(hashSeccion(conNumero, 'salario'), hashSeccion(conTexto, 'salario'));
});

test('hashSeccion: un cambio real cambia el hash, uno en otra sección no', () => {
    const base = datosEmpleadoCompletos();
    const otroSalario = datosEmpleadoCompletos({ 'salario.salario': 2000000 });
    assert.notEqual(hashSeccion(base, 'salario'), hashSeccion(otroSalario, 'salario'));
    assert.equal(hashSeccion(base, 'contrato'), hashSeccion(otroSalario, 'contrato'));
});

test('hashSeccion: una cédula "0123" no colisiona con "123"', () => {
    const a = datosEmpleadoCompletos({ numero_identificacion: '0123' });
    const b = datosEmpleadoCompletos({ numero_identificacion: '123' });
    assert.notEqual(hashSeccion(a, 'personal'), hashSeccion(b, 'personal'));
});

test('hashSeccion rechaza una sección desconocida', () => {
    assert.throws(() => hashSeccion({}, 'inventada'));
});
