const { test } = require('node:test');
const assert = require('node:assert/strict');

const { aplicarCambiosSeccion, tipoDeCampo } = require('../../domain/contratacionHydra/edicionSeccion');
const {
    mapearPayloadHydra,
    completarCatalogoDesdeHydra,
    datosEmpleadoVacio
} = require('../../domain/contratacionHydra/mapearPayloadHydra');
const { payloadCandidato, resolverDesde, RESOLVER_COMPLETO, datosEmpleadoCompletos } = require('./fixtures');

test('tipoDeCampo deduce el tipo por convención de nombres', () => {
    assert.equal(tipoDeCampo('contrato.campania_id'), 'id');
    assert.equal(tipoDeCampo('contrato.fecha_ingreso'), 'fecha');
    assert.equal(tipoDeCampo('seguridad_social.eps_fecha_afiliacion'), 'fecha');
    assert.equal(tipoDeCampo('salario.salario'), 'numero');
    assert.equal(tipoDeCampo('contrato.aplica_dotacion'), 'booleano');
    assert.equal(tipoDeCampo('numero_identificacion'), 'texto');
    assert.equal(tipoDeCampo('cuenta_bancaria.numero_cuenta'), 'texto');
});

test('aplica solo los campos de la sección e ignora el resto', () => {
    const { datos, errores, aplicados } = aplicarCambiosSeccion(datosEmpleadoVacio(), 'salario', {
        salario: { salario: '1423500', bono_cafeteria: 50000 },
        contrato: { campania_id: 5 },
        primer_nombre: 'Intruso'
    });
    assert.deepEqual(errores, []);
    assert.deepEqual(aplicados.sort(), ['salario.bono_cafeteria', 'salario.salario']);
    assert.equal(datos.salario.salario, 1423500);
    assert.equal(datos.contrato.campania_id, null);
    assert.equal(datos.primer_nombre, null);
});

test('actualización parcial: lo que no viene en el cuerpo no se toca; null o "" vacían', () => {
    const base = datosEmpleadoCompletos({ 'contrato.piso': '3', 'contrato.observaciones': 'x' });
    const { datos } = aplicarCambiosSeccion(base, 'contrato', { contrato: { piso: '', observaciones: null } });
    assert.equal(datos.contrato.piso, null);
    assert.equal(datos.contrato.observaciones, null);
    assert.equal(datos.contrato.campania_id, 5);
});

test('normaliza IDs que llegan como string del formulario', () => {
    const { datos, errores } = aplicarCambiosSeccion(datosEmpleadoVacio(), 'contrato', { contrato: { area_id: '2' } });
    assert.deepEqual(errores, []);
    assert.equal(datos.contrato.area_id, 2);
});

test('rechaza tipos inválidos campo por campo, con la etiqueta en el mensaje', () => {
    const { errores } = aplicarCambiosSeccion(datosEmpleadoVacio(), 'contrato', {
        contrato: { area_id: 'abc', oleada_id: -1, fecha_ingreso: '2026-13-01', aplica_dotacion: 'si' }
    });
    assert.ok(errores.includes('Área debe ser un ID válido'));
    assert.ok(errores.includes('Oleada debe ser un ID válido'));
    assert.ok(errores.includes('Fecha de ingreso debe ser una fecha YYYY-MM-DD válida'));
    // aplica_dotacion pertenece a la sección dotacion: en "contrato" se ignora.
    assert.equal(errores.length, 3);
});

test('rechaza salario negativo y texto demasiado largo', () => {
    assert.deepEqual(
        aplicarCambiosSeccion(datosEmpleadoVacio(), 'salario', { salario: { salario: -5 } }).errores,
        ['Salario debe ser un número mayor o igual a cero']
    );
    assert.equal(
        aplicarCambiosSeccion(datosEmpleadoVacio(), 'contrato', { contrato: { observaciones: 'x'.repeat(256) } }).errores.length,
        1
    );
});

test('no muta el borrador de entrada', () => {
    const base = datosEmpleadoVacio();
    aplicarCambiosSeccion(base, 'salario', { salario: { salario: 100 } });
    assert.equal(base.salario.salario, null);
});

test('completarCatalogoDesdeHydra llena solo las rutas vacías de ese catálogo', () => {
    const payload = payloadCandidato();
    const sinGenero = resolverDesde({ tipo_identificacion: { CC: 1 } });
    const borrador = mapearPayloadHydra(payload, sinGenero).datosEmpleado;
    borrador.seguridad_social.eps_id = 77; // RRHH ya eligió la EPS a mano

    const conTodo = mapearPayloadHydra(payload, RESOLVER_COMPLETO).datosEmpleado;

    const genero = completarCatalogoDesdeHydra(borrador, conTodo, 'genero');
    assert.deepEqual(genero.rutas, ['genero_id']);
    assert.equal(genero.datos.genero_id, 2);
    assert.equal(genero.datos.estado_civil_id, null); // otro catálogo: no se toca

    const eps = completarCatalogoDesdeHydra(borrador, conTodo, 'eps');
    assert.deepEqual(eps.rutas, []);
    assert.equal(eps.datos.seguridad_social.eps_id, 77);

    const direccion = completarCatalogoDesdeHydra(borrador, conTodo, 'tipo_direccion');
    assert.deepEqual(direccion.rutas, ['direccion.tipo_direccion_id']);
});
