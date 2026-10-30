const { NoEncontradoError } = require('../../errors/AppError');
const candidatoRepo = require('../../repositories/contratacionHydra/candidatoRepository');
const documentoRepo = require('../../repositories/contratacionHydra/documentoRepository');
const { documentosContratacion } = require('../../middleware/uploadSoportesRrhh');
const { resumenDocumentos, ordenarDocumentos } = require('../../domain/contratacionHydra');

// Documentos de contratación que llegaron de Hydra (migración 087, conexionhydra.md §15),
// vistos por RRHH: en el panel del candidato y, ya registrado, en la ficha del empleado.

// Lo que ve la UI: sin el nombre en disco.
function presentar(documento) {
    return {
        id: documento.id,
        tipo: documento.tipo,
        nombre: documento.nombre,
        nombre_original: documento.nombre_original,
        mime: documento.mime,
        tamano_bytes: documento.tamano_bytes,
        recibido_en: documento.recibido_en
    };
}

function armar(datosHydra, documentos) {
    return {
        ...resumenDocumentos(datosHydra, documentos.map((d) => d.tipo)),
        documentos: ordenarDocumentos(documentos).map(presentar)
    };
}

async function documentosDeCandidato(candidato) {
    return armar(candidato.datos_hydra, await documentoRepo.findByCandidato(candidato.idhydra_candidato));
}

// Para descargar: el documento tiene que ser de ese candidato (o de ese empleado).
function archivo(documento) {
    const ruta = documento && documentosContratacion.ruta(documento.archivo);
    if (!ruta) throw new NoEncontradoError('Documento no encontrado');
    return { ruta, mime: documento.mime, nombre_original: documento.nombre_original };
}

async function archivoDeCandidato(candidatoId, documentoId) {
    const documento = await documentoRepo.findById(documentoId);
    if (!documento || documento.hydra_candidato_id !== candidatoId) throw new NoEncontradoError('Documento no encontrado');
    return archivo(documento);
}

// La ficha tiene a lo sumo un candidato de Hydra (users_company_id lo fija el registro).
async function documentosDeEmpleado(usersCompanyId) {
    const filas = await documentoRepo.findByEmpleado(usersCompanyId);
    if (filas.length === 0) return { success: true, desde_hydra: false, documentos: [] };
    return {
        success: true,
        desde_hydra: true,
        lote_nombre: filas[0].lote_nombre,
        ...armar(filas[0].datos_hydra, filas.filter((f) => f.id != null))
    };
}

async function archivoDeEmpleado(usersCompanyId, documentoId) {
    const documento = await documentoRepo.findById(documentoId);
    const candidato = documento && await candidatoRepo.findById(documento.hydra_candidato_id);
    if (!candidato || candidato.users_company_id !== usersCompanyId) throw new NoEncontradoError('Documento no encontrado');
    return archivo(documento);
}

module.exports = {
    documentosDeCandidato,
    archivoDeCandidato,
    documentosDeEmpleado,
    archivoDeEmpleado
};
