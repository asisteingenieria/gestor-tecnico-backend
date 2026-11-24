// Autenticación del intermediario del molinete y vigilancia de su contacto (asistencia.md §80-§80.1).
// node --test corre cada archivo en su propio proceso: la configuración se fija antes del require.
process.env.MOLINETE_API_KEY = 'clave-de-prueba-0123456789abcdef0123';
process.env.MOLINETE_IPS_PERMITIDAS = '200.1.2.3';
process.env.MOLINETE_SOLO_HTTPS = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const autenticarMolinete = require('../../middleware/autenticarMolinete');
const { crearVigilancia } = require('../../services/asistencia/molineteVigilancia');

function peticion({ clave = process.env.MOLINETE_API_KEY, ip = '200.1.2.3', secure = true } = {}) {
    return { ip, secure, method: 'GET', originalUrl: '/estado', get: (h) => (h === 'x-api-key' ? clave : undefined) };
}

function autenticar(req) {
    let resultado;
    const warn = console.warn;
    console.warn = () => {};
    try {
        autenticarMolinete(req, {}, (err) => { resultado = err ?? 'ok'; });
    } finally {
        console.warn = warn;
    }
    return resultado;
}

test('con clave, IP permitida y HTTPS pasa', () => {
    assert.equal(autenticar(peticion()), 'ok');
});

test('sin HTTPS, con clave equivocada o desde otra IP responde 401 genérico', () => {
    for (const req of [peticion({ secure: false }), peticion({ clave: 'otra' }), peticion({ clave: null }), peticion({ ip: '8.8.8.8' })]) {
        const err = autenticar(req);
        assert.equal(err.statusCode ?? err.status, 401);
        assert.equal(err.message, 'Credenciales inválidas');
    }
});

test('la IP mapeada a IPv6 se normaliza', () => {
    assert.equal(autenticar(peticion({ ip: '::ffff:200.1.2.3' })), 'ok');
});

function registro() {
    const lineas = { log: [], error: [] };
    return { lineas, registrar: { log: (m) => lineas.log.push(m), error: (m) => lineas.error.push(m) } };
}

test('la vigilancia no alerta antes del primer contacto', () => {
    let t = 0;
    const { lineas, registrar } = registro();
    const v = crearVigilancia({ alertaMin: 10, ahora: () => t, registrar });
    t = 60 * 60000;
    assert.equal(v.revisar(), false);
    assert.equal(lineas.error.length, 0);
});

test('alerta una sola vez tras el silencio y avisa cuando vuelve', () => {
    let t = 0;
    const { lineas, registrar } = registro();
    const v = crearVigilancia({ alertaMin: 10, ahora: () => t, registrar });
    v.contacto();
    t = 9 * 60000;
    assert.equal(v.revisar(), false);
    t = 11 * 60000;
    assert.equal(v.revisar(), true);
    t = 30 * 60000;
    assert.equal(v.revisar(), false, 'no repite la alerta');
    assert.equal(lineas.error.length, 1);
    v.contacto();
    assert.match(lineas.log[0], /volvió a reportar después de 30 min/);
    t = 45 * 60000;
    assert.equal(v.revisar(), true, 'vuelve a vigilar después de recuperarse');
});
