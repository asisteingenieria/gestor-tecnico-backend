const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const {
    problemaDelArchivo,
    resumenDocumentos,
    ordenarDocumentos,
    MAX_BYTES_DOCUMENTO
} = require('../../domain/contratacionHydra/documentos');
const { validarDocumentoHydra, validarCandidatoHydra } = require('../../validators/integracionHydraSchemas');
const { payloadCandidato } = require('./fixtures');

// Documentos de contratación que envía Hydra (migración 087, conexionhydra.md §15).

const PDF = Buffer.from('%PDF-1.4\n% hoja de vida firmada\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');

function cuerpo(cambios = {}) {
    return {
        tipo: 'hoja_vida_firmada',
        nombre: 'Hoja de vida firmada',
        nombre_archivo: 'hoja-de-vida.pdf',
        mime_type: 'application/pdf',
        sha256: sha(PDF),
        contenido_base64: PDF.toString('base64'),
        ...cambios
    };
}
const req = (tipo = 'hoja_vida_firmada') => ({ params: { hydraCandidatoId: '4821', tipo } });

test('documento: el archivo correcto pasa', () => {
    assert.equal(problemaDelArchivo({ mime: 'application/pdf', contenido: PDF, sha256: sha(PDF), sha256Real: sha(PDF) }), null);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    assert.equal(problemaDelArchivo({ mime: 'image/png', contenido: png, sha256: sha(png), sha256Real: sha(png) }), null);
});

test('documento: rechaza hash distinto, contenido que no es del tipo, vacío, muy grande o formato no admitido', () => {
    assert.match(problemaDelArchivo({ mime: 'application/pdf', contenido: PDF, sha256: 'a'.repeat(64), sha256Real: sha(PDF) }), /hash/);
    const html = Buffer.from('<html>');
    assert.match(problemaDelArchivo({ mime: 'application/pdf', contenido: html, sha256: sha(html), sha256Real: sha(html) }), /no corresponde/);
    assert.match(problemaDelArchivo({ mime: 'application/pdf', contenido: Buffer.alloc(0), sha256: '', sha256Real: '' }), /vacío/);
    const grande = Buffer.alloc(MAX_BYTES_DOCUMENTO + 1);
    assert.match(problemaDelArchivo({ mime: 'application/pdf', contenido: grande, sha256: sha(grande), sha256Real: sha(grande) }), /máximo/);
    assert.match(problemaDelArchivo({ mime: 'text/html', contenido: PDF, sha256: sha(PDF), sha256Real: sha(PDF) }), /no admitido/);
});

test('validador de documento: estructura, tipo de la URL y base64', () => {
    assert.deepEqual(validarDocumentoHydra(cuerpo(), req()), []);
    assert.ok(validarDocumentoHydra(cuerpo(), req('otro_tipo')).some((e) => /no coincide/.test(e)));
    assert.ok(validarDocumentoHydra(cuerpo({ tipo: '../x' }), req('../x')).some((e) => /URL no es válido/.test(e)));
    assert.ok(validarDocumentoHydra(cuerpo({ mime_type: 'text/html' }), req()).some((e) => /mime_type/.test(e)));
    assert.ok(validarDocumentoHydra(cuerpo({ sha256: 'xyz' }), req()).some((e) => /sha256/.test(e)));
    assert.ok(validarDocumentoHydra(cuerpo({ contenido_base64: 'no es base64!' }), req()).some((e) => /base64/.test(e)));
    assert.ok(validarDocumentoHydra(cuerpo({ nombre: undefined }), req()).some((e) => /nombre/.test(e)));
});

test('validador de candidato: el bloque documentos es opcional y se valida si viene', () => {
    const conDocumentos = (documentos) => ({ ...payloadCandidato(), documentos });
    const r = { params: { hydraCandidatoId: '4821' } };
    assert.deepEqual(validarCandidatoHydra(payloadCandidato(), r), []);
    assert.deepEqual(validarCandidatoHydra(conDocumentos({
        firmados: ['hoja_vida_firmada', 'tratamiento_datos_firmado'],
        antecedentes_faltantes: ['ADRES'],
        nota_antecedentes: 'En trámite'
    }), r), []);
    assert.ok(validarCandidatoHydra(conDocumentos({ antecedentes_faltantes: 'ADRES' }), r).length > 0);
    assert.ok(validarCandidatoHydra(conDocumentos({ nota_antecedentes: 'x'.repeat(501) }), r).length > 0);
});

test('resumen: sin bloque documentos (candidato anterior a la 087) no exige nada', () => {
    assert.deepEqual(resumenDocumentos({}, []), {
        aplica: false, firmados_pendientes: [], antecedentes_faltantes: [], nota_antecedentes: null
    });
});

test('resumen: firmados que faltan, antecedentes faltantes y nota', () => {
    const datos = {
        documentos: {
            firmados: ['hoja_vida_firmada', 'tratamiento_datos_firmado'],
            antecedentes_faltantes: ['Procuraduría'],
            nota_antecedentes: 'La trae el lunes'
        }
    };
    assert.deepEqual(resumenDocumentos(datos, ['hoja_vida_firmada', 'antecedente_adres']), {
        aplica: true,
        firmados_pendientes: [{ tipo: 'tratamiento_datos_firmado', nombre: 'Tratamiento de datos firmado' }],
        antecedentes_faltantes: ['Procuraduría'],
        nota_antecedentes: 'La trae el lunes'
    });
    assert.deepEqual(resumenDocumentos(datos, ['hoja_vida_firmada', 'tratamiento_datos_firmado']).firmados_pendientes, []);
    assert.equal(resumenDocumentos({ documentos: { nota_antecedentes: '  ' } }, []).nota_antecedentes, null);
});

test('orden: firmados primero, luego antecedentes por nombre', () => {
    const docs = [
        { tipo: 'antecedente_procuraduria', nombre: 'Procuraduría' },
        { tipo: 'tratamiento_datos_firmado', nombre: 'Tratamiento de datos firmado' },
        { tipo: 'antecedente_adres', nombre: 'ADRES' },
        { tipo: 'hoja_vida_firmada', nombre: 'Hoja de vida firmada' }
    ];
    assert.deepEqual(ordenarDocumentos(docs).map((d) => d.tipo), [
        'hoja_vida_firmada', 'tratamiento_datos_firmado', 'antecedente_adres', 'antecedente_procuraduria'
    ]);
});
