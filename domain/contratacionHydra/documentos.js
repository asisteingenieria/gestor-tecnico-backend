// Documentos de contratación que envía Hydra (migración 087, conexionhydra.md §15).
//
// Hydra manda la hoja de vida y el tratamiento de datos firmados (obligatorios) y los
// soportes de antecedentes que tenga cargados; si falta alguno, en el payload del
// candidato viene la nota de Contratación (`datos_hydra.documentos`).
//
// Puro: sin base de datos ni disco. Lo usan la recepción (validar el archivo) y RRHH
// (qué falta antes de registrar).

const TIPOS_FIRMADOS = Object.freeze({
    hoja_vida_firmada: 'Hoja de vida firmada',
    tratamiento_datos_firmado: 'Tratamiento de datos firmado'
});

// Tipo = código de Hydra (`antecedente_<codigo>` para los antecedentes). Se usa en la URL
// y en la BD, nunca como ruta de disco.
const TIPO_DOCUMENTO = /^[a-z0-9_]{3,40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_BYTES_DOCUMENTO = 10 * 1024 * 1024;

// Formatos que acepta Hydra para los soportes, con su firma de archivo: el mime lo
// declara el emisor, pero el contenido tiene que coincidir.
const FORMATOS = Object.freeze({
    'application/pdf': { extension: '.pdf', firma: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
    'image/jpeg': { extension: '.jpg', firma: [0xff, 0xd8, 0xff] },
    'image/png': { extension: '.png', firma: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }
});

function empiezaCon(contenido, firma) {
    return contenido.length >= firma.length && firma.every((byte, i) => contenido[i] === byte);
}

// Error legible si el archivo no es aceptable, o null. `sha256` es el que declaró Hydra;
// `sha256Real`, el calculado sobre lo recibido.
function problemaDelArchivo({ mime, contenido, sha256, sha256Real }) {
    const formato = FORMATOS[mime];
    if (!formato) return `Formato no admitido: ${mime} (solo PDF, JPG o PNG)`;
    if (!contenido || contenido.length === 0) return 'El documento llegó vacío';
    if (contenido.length > MAX_BYTES_DOCUMENTO) {
        return `El documento supera el máximo de ${MAX_BYTES_DOCUMENTO / 1024 / 1024} MB`;
    }
    if (sha256 !== sha256Real) return 'El documento llegó incompleto o alterado (el hash no coincide)';
    if (!empiezaCon(contenido, formato.firma)) return `El contenido no corresponde a un archivo ${mime}`;
    return null;
}

// Lo que dice Hydra de los documentos del candidato y lo que de verdad llegó:
//   - firmados_pendientes: obligatorios que todavía no se reciben;
//   - antecedentes_faltantes / nota_antecedentes: lo que Contratación avisó al enviar.
// Un candidato enviado antes de esta integración no trae `documentos`: no se le exige nada.
function resumenDocumentos(datosHydra, tiposRecibidos) {
    const info = datosHydra?.documentos;
    if (!info || typeof info !== 'object') {
        return { aplica: false, firmados_pendientes: [], antecedentes_faltantes: [], nota_antecedentes: null };
    }
    const recibidos = new Set(tiposRecibidos);
    const esperados = Array.isArray(info.firmados) ? info.firmados : Object.keys(TIPOS_FIRMADOS);
    return {
        aplica: true,
        firmados_pendientes: esperados
            .filter((tipo) => !recibidos.has(tipo))
            .map((tipo) => ({ tipo, nombre: TIPOS_FIRMADOS[tipo] ?? tipo })),
        antecedentes_faltantes: Array.isArray(info.antecedentes_faltantes) ? info.antecedentes_faltantes : [],
        nota_antecedentes: typeof info.nota_antecedentes === 'string' && info.nota_antecedentes.trim() !== ''
            ? info.nota_antecedentes
            : null
    };
}

// Firmados primero (en su orden), después los antecedentes por nombre.
function ordenarDocumentos(documentos) {
    const orden = Object.keys(TIPOS_FIRMADOS);
    const posicion = (d) => {
        const i = orden.indexOf(d.tipo);
        return i === -1 ? orden.length : i;
    };
    return [...documentos].sort((a, b) => posicion(a) - posicion(b) || a.nombre.localeCompare(b.nombre, 'es'));
}

module.exports = {
    TIPOS_FIRMADOS,
    TIPO_DOCUMENTO,
    SHA256,
    MAX_BYTES_DOCUMENTO,
    FORMATOS,
    problemaDelArchivo,
    resumenDocumentos,
    ordenarDocumentos
};
