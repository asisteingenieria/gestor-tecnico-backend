// Validación estructural del contrato Hydra → Gestor (conexionhydra.md §5.1).
//
// `middleware/validar.js` solo valida campos planos; el payload de Hydra trae objetos
// anidados y un arreglo de candidatos, así que aquí cada validador es una función pura
// `(body) → errores[]` que usa middleware/validarCuerpo.js.
//
// Solo se valida forma y tipos. Que un catálogo exista en Gestor NO es un error de
// validación: un valor desconocido queda "sin mapear" y lo resuelve RRHH.
// Campos que el contrato no conoce se ignoran (Hydra puede agregar campos sin romper).

const { maxCandidatosPorLote } = require('../config/integracionHydra');
const { TIPO_DOCUMENTO, SHA256, FORMATOS } = require('../domain/contratacionHydra/documentos');

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMERO_IDENTIFICACION = /^[A-Za-z0-9-]{3,20}$/;

function esObjeto(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fechaReal(v) {
    if (typeof v !== 'string' || !FECHA.test(v)) return false;
    const fecha = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(v);
}

function crearVerificador(errores, prefijo) {
    const ruta = (campo) => (prefijo ? `${prefijo}.${campo}` : campo);
    const presente = (v) => v !== undefined && v !== null && v !== '';

    return {
        texto(campo, valor, { requerido = false, max } = {}) {
            if (!presente(valor)) {
                if (requerido) errores.push(`${ruta(campo)} es requerido`);
                return;
            }
            if (typeof valor !== 'string') return errores.push(`${ruta(campo)} debe ser texto`);
            if (max && valor.length > max) errores.push(`${ruta(campo)} supera ${max} caracteres`);
        },
        enteroPositivo(campo, valor, { requerido = false } = {}) {
            if (!presente(valor)) {
                if (requerido) errores.push(`${ruta(campo)} es requerido`);
                return;
            }
            if (!Number.isInteger(valor) || valor <= 0) errores.push(`${ruta(campo)} debe ser un entero positivo`);
        },
        fecha(campo, valor, { requerido = false } = {}) {
            if (!presente(valor)) {
                if (requerido) errores.push(`${ruta(campo)} es requerido`);
                return;
            }
            if (!fechaReal(valor)) errores.push(`${ruta(campo)} debe ser una fecha YYYY-MM-DD válida`);
        },
        objeto(campo, valor, { requerido = false } = {}) {
            if (valor === undefined || valor === null) {
                if (requerido) errores.push(`${ruta(campo)} es requerido`);
                return false;
            }
            if (!esObjeto(valor)) {
                errores.push(`${ruta(campo)} debe ser un objeto`);
                return false;
            }
            return true;
        },
        patron(campo, valor, regex, mensaje) {
            if (typeof valor === 'string' && valor !== '' && !regex.test(valor)) errores.push(`${ruta(campo)} ${mensaje}`);
        }
    };
}

function validarCandidato(c, prefijo, errores) {
    const v = crearVerificador(errores, prefijo);
    if (!esObjeto(c)) {
        errores.push(`${prefijo} debe ser un objeto`);
        return;
    }

    v.enteroPositivo('hydra_candidato_id', c.hydra_candidato_id, { requerido: true });
    v.enteroPositivo('version', c.version, { requerido: true });

    if (v.objeto('identificacion', c.identificacion, { requerido: true })) {
        v.texto('identificacion.tipo', c.identificacion.tipo, { requerido: true, max: 10 });
        v.texto('identificacion.numero', c.identificacion.numero, { requerido: true, max: 20 });
        v.patron('identificacion.numero', c.identificacion.numero, NUMERO_IDENTIFICACION,
            'solo admite letras, números y guiones (3 a 20)');
    }

    if (v.objeto('nombres', c.nombres, { requerido: true })) {
        v.texto('nombres.primer_nombre', c.nombres.primer_nombre, { requerido: true, max: 100 });
        v.texto('nombres.segundo_nombre', c.nombres.segundo_nombre, { max: 100 });
        v.texto('nombres.primer_apellido', c.nombres.primer_apellido, { requerido: true, max: 100 });
        v.texto('nombres.segundo_apellido', c.nombres.segundo_apellido, { max: 100 });
    }

    if (v.objeto('contacto', c.contacto)) {
        v.texto('contacto.email', c.contacto.email, { max: 255 });
        v.patron('contacto.email', c.contacto.email, EMAIL, 'no es un email válido');
        v.texto('contacto.celular', c.contacto.celular, { max: 20 });
    }

    if (v.objeto('personal', c.personal)) {
        v.fecha('personal.fecha_nacimiento', c.personal.fecha_nacimiento);
        for (const campo of ['genero', 'estado_civil', 'grupo_sanguineo']) {
            v.texto(`personal.${campo}`, c.personal[campo], { max: 150 });
        }
    }

    if (v.objeto('seguridad_social', c.seguridad_social)) {
        v.texto('seguridad_social.eps', c.seguridad_social.eps, { max: 150 });
        v.texto('seguridad_social.afp', c.seguridad_social.afp, { max: 150 });
    }

    if (v.objeto('direccion', c.direccion)) {
        v.texto('direccion.direccion', c.direccion.direccion, { max: 255 });
        v.texto('direccion.barrio', c.direccion.barrio, { max: 100 });
    }

    if (v.objeto('contacto_emergencia', c.contacto_emergencia)) {
        v.texto('contacto_emergencia.nombre', c.contacto_emergencia.nombre, { max: 100 });
        v.texto('contacto_emergencia.telefono', c.contacto_emergencia.telefono, { max: 20 });
        v.texto('contacto_emergencia.parentesco', c.contacto_emergencia.parentesco, { max: 150 });
    }

    if (v.objeto('dotacion', c.dotacion)) {
        v.texto('dotacion.talla_camisa', c.dotacion.talla_camisa, { max: 10 });
    }

    if (v.objeto('proceso', c.proceso)) {
        v.texto('proceso.cliente', c.proceso.cliente, { max: 150 });
        v.texto('proceso.cargo', c.proceso.cargo, { max: 150 });
    }

    if (v.objeto('consentimiento', c.consentimiento)) {
        v.fecha('consentimiento.fecha', c.consentimiento.fecha);
    }

    // Migración 087: qué documentos firmados vienen y qué antecedentes faltan. Los
    // archivos llegan después, cada uno por PUT /candidatos/:id/documentos/:tipo.
    if (v.objeto('documentos', c.documentos)) {
        for (const campo of ['firmados', 'antecedentes_faltantes']) {
            const lista = c.documentos[campo];
            if (lista === undefined || lista === null) continue;
            if (!Array.isArray(lista) || lista.length > 20 || lista.some((x) => typeof x !== 'string' || x.length > 120)) {
                errores.push(`${prefijo}.documentos.${campo} debe ser una lista de textos`);
            }
        }
        v.texto('documentos.nota_antecedentes', c.documentos.nota_antecedentes, { max: 500 });
    }
}

function validarLoteHydra(body) {
    const errores = [];
    if (!esObjeto(body)) return ['El cuerpo debe ser un objeto JSON'];

    const v = crearVerificador(errores, '');
    v.texto('lote_externo_id', body.lote_externo_id, { requerido: true, max: 64 });
    v.texto('nombre', body.nombre, { requerido: true, max: 150 });
    v.fecha('fecha_ingreso_sugerida', body.fecha_ingreso_sugerida);

    if (!Array.isArray(body.candidatos) || body.candidatos.length === 0) {
        errores.push('candidatos debe ser un arreglo con al menos un candidato');
        return errores;
    }
    if (body.candidatos.length > maxCandidatosPorLote) {
        errores.push(`Un lote admite máximo ${maxCandidatosPorLote} candidatos (llegaron ${body.candidatos.length})`);
        return errores;
    }

    body.candidatos.forEach((c, i) => validarCandidato(c, `candidatos[${i}]`, errores));

    const ids = body.candidatos.map((c) => c?.hydra_candidato_id).filter(Number.isInteger);
    const repetidos = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (repetidos.length > 0) errores.push(`hydra_candidato_id repetido dentro del lote: ${repetidos.join(', ')}`);

    return errores;
}

// PUT /candidatos/:hydraCandidatoId — el cuerpo es un candidato suelto, y su id debe
// coincidir con el de la URL.
function validarCandidatoHydra(body, req) {
    const errores = [];
    validarCandidato(body, 'candidato', errores);
    if (esObjeto(body) && String(body.hydra_candidato_id) !== String(req.params.hydraCandidatoId)) {
        errores.push('candidato.hydra_candidato_id no coincide con el de la URL');
    }
    return errores;
}

function validarCancelacionHydra(body) {
    const errores = [];
    if (body !== undefined && !esObjeto(body)) return ['El cuerpo debe ser un objeto JSON'];
    crearVerificador(errores, '').texto('motivo', body?.motivo, { max: 255 });
    return errores;
}

// POST /candidatos/:hydraCandidatoId/examenes/continuidad — decisión de selección sobre
// un candidato que no asistió a los exámenes médicos (migración 089).
function validarContinuidadHydra(body) {
    const errores = [];
    if (!esObjeto(body)) return ['El cuerpo debe ser un objeto JSON'];
    if (typeof body.continuar !== 'boolean') errores.push('continuar debe ser true o false');
    const v = crearVerificador(errores, '');
    v.texto('nota', body.nota, { max: 1000 });
    v.texto('decidido_por', body.decidido_por, { max: 150 });
    return errores;
}

// PUT /candidatos/:hydraCandidatoId/documentos/:tipo — un archivo en base64. El hash y
// el contenido real se comprueban en la recepción, después de decodificar.
function validarDocumentoHydra(body, req) {
    const errores = [];
    if (!esObjeto(body)) return ['El cuerpo debe ser un objeto JSON'];
    const v = crearVerificador(errores, '');

    if (!TIPO_DOCUMENTO.test(req.params.tipo ?? '')) errores.push('El tipo de documento de la URL no es válido');
    if (body.tipo !== req.params.tipo) errores.push('tipo no coincide con el de la URL');
    v.texto('nombre', body.nombre, { requerido: true, max: 120 });
    v.texto('nombre_archivo', body.nombre_archivo, { requerido: true, max: 255 });
    v.texto('mime_type', body.mime_type, { requerido: true, max: 100 });
    if (typeof body.mime_type === 'string' && !FORMATOS[body.mime_type]) {
        errores.push('mime_type debe ser application/pdf, image/jpeg o image/png');
    }
    v.texto('sha256', body.sha256, { requerido: true });
    v.patron('sha256', body.sha256, SHA256, 'debe ser el SHA-256 en hexadecimal (64 caracteres)');
    v.texto('contenido_base64', body.contenido_base64, { requerido: true });
    v.patron('contenido_base64', body.contenido_base64, /^[A-Za-z0-9+/]*={0,2}$/, 'no es base64 válido');
    return errores;
}

const hydraCandidatoIdParamSchema = {
    params: { hydraCandidatoId: { requerido: true, tipo: 'entero' } }
};

module.exports = {
    validarLoteHydra,
    validarCandidatoHydra,
    validarCancelacionHydra,
    validarContinuidadHydra,
    validarDocumentoHydra,
    hydraCandidatoIdParamSchema
};
