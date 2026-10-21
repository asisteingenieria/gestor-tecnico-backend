const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
    contratoVigente,
    estaBloqueado,
    decidirValidacion,
    motivoClaveNuevaInvalida,
    cuerpoAviso
} = require('../../domain/asistencia/pantallaGris');

const AHORA = new Date('2026-10-21T15:00:00Z');
const POLITICA = { largoMinimoClave: 6 };
const usuario = (extra = {}) => ({ usuario: '1000930582', estado_contrato: 'activo', bloqueado_hasta: null, ...extra });

test('pantalla gris: sin contrato, retirado o inactivo no es vigente', () => {
    assert.equal(contratoVigente('activo'), true);
    assert.equal(contratoVigente('en_proceso'), true);
    assert.equal(contratoVigente('retirado'), false);
    assert.equal(contratoVigente('inactivo'), false);
    assert.equal(contratoVigente(null), false);
});

test('pantalla gris: el bloqueo vence a su hora', () => {
    assert.equal(estaBloqueado(null, AHORA), false);
    assert.equal(estaBloqueado(new Date('2026-10-21T15:10:00Z'), AHORA), true);
    assert.equal(estaBloqueado(new Date('2026-10-21T14:59:59Z'), AHORA), false);
});

test('pantalla gris: usuario inexistente y clave errada responden igual, pero solo la errada cuenta', () => {
    const inexistente = decidirValidacion({ usuario: null, claveCorrecta: false, ahora: AHORA });
    const errada = decidirValidacion({ usuario: usuario(), claveCorrecta: false, ahora: AHORA });
    assert.equal(inexistente.motivo, 'credenciales_invalidas');
    assert.equal(errada.motivo, 'credenciales_invalidas');
    assert.equal(inexistente.contarFallo, false);
    assert.equal(errada.contarFallo, true);
});

test('pantalla gris: bloqueado no entra ni con la clave correcta, y no suma fallos', () => {
    const d = decidirValidacion({ usuario: usuario({ bloqueado_hasta: new Date('2026-10-21T15:05:00Z') }), claveCorrecta: true, ahora: AHORA });
    assert.deepEqual(d, { valido: false, motivo: 'bloqueado', contarFallo: false, reiniciarFallos: false });
});

test('pantalla gris: retirado con la clave correcta → usuario_inactivo; vigente → válido', () => {
    const retirado = decidirValidacion({ usuario: usuario({ estado_contrato: 'retirado' }), claveCorrecta: true, ahora: AHORA });
    assert.equal(retirado.valido, false);
    assert.equal(retirado.motivo, 'usuario_inactivo');
    const ok = decidirValidacion({ usuario: usuario(), claveCorrecta: true, ahora: AHORA });
    assert.deepEqual(ok, { valido: true, motivo: null, contarFallo: false, reiniciarFallos: true });
});

test('pantalla gris: reglas de la clave nueva', () => {
    const ctx = { usuario: '1000930582', claveActual: '1000930582' };
    assert.equal(motivoClaveNuevaInvalida('abc', ctx, POLITICA), 'clave_corta');
    assert.equal(motivoClaveNuevaInvalida('1000930582', ctx, POLITICA), 'clave_igual_usuario');
    assert.equal(motivoClaveNuevaInvalida('Otra123', { usuario: '1', claveActual: 'Otra123' }, POLITICA), 'clave_igual_actual');
    assert.equal(motivoClaveNuevaInvalida('Nueva2026', ctx, POLITICA), null);
});

test('pantalla gris: el aviso a AsisLock no lleva clave y marca activo según el evento', () => {
    const datos = { usuario: 1000930582, nombre: 'Ana Pérez', usersCompanyId: 262 };
    const alta = cuerpoAviso('alta', datos, AHORA);
    assert.deepEqual(alta, {
        evento: 'alta', usuario: '1000930582', nombre: 'Ana Pérez', users_company_id: 262, activo: true,
        ocurrido_en: '2026-10-21T15:00:00.000Z'
    });
    assert.equal(cuerpoAviso('baja', datos, AHORA).activo, false);
    assert.equal(cuerpoAviso('reactivacion', datos, AHORA).activo, true);
    assert.ok(!Object.keys(alta).some((k) => /clave|password/i.test(k)));
});
