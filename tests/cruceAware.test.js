const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizarCedula, cruzar } = require('../utils/cruceAware');

test('cédula comparable: puntos, espacios, ceros a la izquierda y logins', () => {
    assert.equal(normalizarCedula('1.023.456.789'), '1023456789');
    assert.equal(normalizarCedula(' 0052345678 '), '52345678');
    assert.equal(normalizarCedula(52345678), '52345678');
    assert.equal(normalizarCedula('JPerez'), 'jperez');
    assert.equal(normalizarCedula(null), '');
});

const empleados = [
    { id: 1, cedula: '1.000.001', nombre: 'Ana Activa', estado: 'activo', campania: 'Claro Hogar', cargo: 'Agente' },
    { id: 2, cedula: '1000002', nombre: 'Beto Sinaware', estado: 'activo', campania: 'Administrativo', cargo: 'Analista' },
    { id: 3, cedula: '1000003', nombre: 'Carla Retirada', estado: 'retirado' },
    { id: 4, cedula: '1000004', nombre: 'Dario Retirado Sin Aware', estado: 'retirado' },
];
const agentes = [
    { cedula: '1000001', nombre: 'ANA ACTIVA', rol_id: 2, folder: 'AWARE_4', campania: 'Claro Hogar (AWARE_4)' },
    { cedula: '1000001', nombre: 'ANA ACTIVA', rol_id: 2, folder: 'AWARE_8', campania: 'Claro TYT (AWARE_8)' },
    { cedula: '1000001', nombre: 'ANA ACTIVA', rol_id: 2, folder: 'AWARE_8', campania: 'Claro TYT (AWARE_8)' },
    { cedula: '1000003', nombre: 'CARLA RETIRADA', rol_id: 2, folder: 'AWARE_4', campania: 'Claro Hogar (AWARE_4)' },
    { cedula: '9999999', nombre: 'EXTERNO SIN FICHA', rol_id: 9, folder: 'AWARE_30', campania: 'LV / Obama (AWARE_30)' },
];

test('clasifica cada cédula en ambos, Aware sin compañía o compañía sin Aware', () => {
    const { filas } = cruzar(empleados, agentes);
    const por = Object.fromEntries(filas.map((f) => [f.cedula, f]));
    assert.equal(por['1000001'].categoria, 'ambos');
    assert.deepEqual(por['1000001'].aware.map((a) => a.folder), ['AWARE_4', 'AWARE_8']); // sin duplicados
    assert.equal(por['1000002'].categoria, 'compania_sin_aware');
    assert.equal(por['1000003'].categoria, 'aware_sin_compania');
    assert.equal(por['1000003'].estado_compania, 'retirado');
    assert.equal(por['9999999'].categoria, 'aware_sin_compania');
    assert.equal(por['9999999'].estado_compania, 'no_registrado');
    assert.equal(por['9999999'].nombre, 'EXTERNO SIN FICHA'); // sin ficha, el nombre sale de Aware
    assert.equal(por['9999999'].es_agente_aware, false);
    assert.equal(por['1000004'], undefined); // retirado y sin Aware: nada que revisar
});

test('el resumen cuenta cada categoría', () => {
    const { resumen } = cruzar(empleados, agentes);
    assert.deepEqual(resumen, { activos_compania: 2, ambos: 1, aware_sin_compania: 2, compania_sin_aware: 1, activos_aware: 3 });
});

test('si la cédula se repite en el Gestor, manda la ficha activa', () => {
    const { filas } = cruzar(
        [
            { id: 5, cedula: '5', nombre: 'Nueva', estado: 'activo' },
            { id: 6, cedula: '5', nombre: 'Vieja', estado: 'retirado' },
        ],
        [],
    );
    assert.equal(filas[0].estado_compania, 'activo');
    assert.equal(filas[0].users_company_id, 5);
});
