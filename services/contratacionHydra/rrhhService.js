const { NoEncontradoError, ReglaContratacionError, ValidacionError } = require('../../errors/AppError');
const loteRepo = require('../../repositories/contratacionHydra/loteRepository');
const candidatoRepo = require('../../repositories/contratacionHydra/candidatoRepository');
const verificacionRepo = require('../../repositories/contratacionHydra/verificacionRepository');
const catalogoRepo = require('../../repositories/contratacionHydra/catalogoRepository');
const envioRepo = require('../../repositories/contratacionHydra/envioRepository');
const { cargarResolver, evaluarCandidato, fechaDeNegocio, recalcularEstadoLote } = require('./evaluacionService');
const { enTransaccion } = require('./transaccion');
const {
    SECCIONES,
    CATALOGOS,
    hashSeccion,
    aplicarCambiosSeccion,
    mapearPayloadHydra,
    completarCatalogoDesdeHydra,
    assertSeccionValida,
    assertCandidatoEditable,
    assertPuedeVerificar,
    assertPuedeDescartar
} = require('../../domain/contratacionHydra');

// Casos de uso de RRHH sobre el staging de contratación (conexionhydra.md §6 y §8):
// consultar lotes y candidatos, completar secciones, marcar el checkbox de verificación,
// descartar y administrar los mapeos de catálogo.
//
// Toda escritura bloquea primero el lote y luego el candidato (mismo orden que la
// recepción de Hydra), y recalcula estado de candidato y lote en la misma transacción.

// ---------------------------------------------------------------------------
// Presentación
// ---------------------------------------------------------------------------

// Estado visible de una sección (los chips de la UI):
//   completo       → sin problemas y con checkbox vigente
//   desactualizada → tenía checkbox, pero el contenido cambió después
//   pendiente      → cualquier otro caso
function estadoVisible(evaluacion) {
    if (evaluacion.completa && evaluacion.vigente) return 'completo';
    if (evaluacion.verificada && !evaluacion.vigente) return 'desactualizada';
    return 'pendiente';
}

function presentarSecciones(completitud, verificaciones) {
    return SECCIONES.map((seccion) => {
        const evaluacion = completitud.secciones[seccion.clave];
        const verificacion = verificaciones.find((v) => v.seccion === seccion.clave);
        return {
            clave: seccion.clave,
            nombre: seccion.nombre,
            estado: estadoVisible(evaluacion),
            completa: evaluacion.completa,
            verificada: evaluacion.verificada,
            vigente: evaluacion.vigente,
            problemas: evaluacion.problemas,
            verificado_por: verificacion?.verificado_por_nombre ?? null,
            verificado_en: verificacion?.verificado_en ?? null
        };
    });
}

function presentarCandidato(candidato, evaluacion, verificaciones) {
    const secciones = presentarSecciones(evaluacion.completitud, verificaciones);
    return {
        id: candidato.idhydra_candidato,
        hydra_candidato_id: candidato.hydra_candidato_externo_id,
        lote_id: candidato.hydra_lote_id,
        nombre_completo: candidato.nombre_completo,
        tipo_identificacion: candidato.tipo_identificacion,
        numero_identificacion: candidato.numero_identificacion,
        cargo_hydra: candidato.cargo_hydra,
        estado: candidato.estado,
        motivo_descarte: candidato.motivo_descarte,
        reintegro_users_company_id: candidato.users_company_existente_id,
        users_company_id: candidato.users_company_id,
        version_hydra: candidato.version_hydra,
        actualizado_en: candidato.updated_at,
        secciones_completas: secciones.filter((s) => s.estado === 'completo').length,
        total_secciones: secciones.length,
        secciones
    };
}

function presentarDetalle(candidato, evaluacion, verificaciones) {
    return {
        ...presentarCandidato(candidato, evaluacion, verificaciones),
        datos_hydra: candidato.datos_hydra,
        datos_empleado: candidato.datos_empleado,
        sin_mapear: evaluacion.sinMapear
    };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

async function listarLotes({ estado }) {
    return { success: true, lotes: await loteRepo.findAll({ estado }) };
}

async function obtenerLote(id) {
    const lote = await loteRepo.findById(id);
    if (!lote) throw new NoEncontradoError('El lote no existe');

    const [candidatos, verificaciones, resolver] = await Promise.all([
        candidatoRepo.findByLote(id),
        verificacionRepo.findByLote(id),
        cargarResolver()
    ]);

    return {
        success: true,
        lote,
        candidatos: candidatos.map((candidato) => {
            const propias = verificaciones.filter((v) => v.hydra_candidato_id === candidato.idhydra_candidato);
            const evaluacion = evaluarCandidato({ candidato, lote, resolver, verificaciones: propias });
            return presentarCandidato(candidato, evaluacion, propias);
        })
    };
}

async function obtenerCandidato(id) {
    const candidato = await candidatoRepo.findById(id);
    if (!candidato) throw new NoEncontradoError('El candidato no existe');

    const [lote, verificaciones, resolver] = await Promise.all([
        loteRepo.findById(candidato.hydra_lote_id),
        verificacionRepo.findByCandidato(id),
        cargarResolver()
    ]);
    const evaluacion = evaluarCandidato({ candidato, lote, resolver, verificaciones });
    return { success: true, lote, candidato: presentarDetalle(candidato, evaluacion, verificaciones) };
}

// ---------------------------------------------------------------------------
// Escrituras sobre un candidato
// ---------------------------------------------------------------------------

// Bloquea lote → candidato y comprueba que el candidato admita cambios.
async function bloquearCandidatoEditable(id, conn) {
    const base = await candidatoRepo.findById(id, conn);
    if (!base) throw new NoEncontradoError('El candidato no existe');
    const lote = await loteRepo.findByIdParaActualizar(base.hydra_lote_id, conn);
    const candidato = await candidatoRepo.findByIdParaActualizar(id, conn);
    assertCandidatoEditable(candidato.estado);
    return { lote, candidato };
}

// Re-evalúa, guarda borrador + estado, recalcula el lote y arma la respuesta.
async function persistirYResponder(conn, lote, candidato, datosEmpleado) {
    const resolver = await cargarResolver(conn);
    const verificaciones = await verificacionRepo.findByCandidato(candidato.idhydra_candidato, conn);
    const actualizado = { ...candidato, datos_empleado: datosEmpleado };
    const evaluacion = evaluarCandidato({ candidato: actualizado, lote, resolver, verificaciones });

    await candidatoRepo.actualizarBorrador(candidato.idhydra_candidato, datosEmpleado, evaluacion.estado, conn);
    const loteEstado = await recalcularEstadoLote(lote, conn);

    return {
        success: true,
        lote_estado: loteEstado,
        candidato: presentarDetalle({ ...actualizado, estado: evaluacion.estado }, evaluacion, verificaciones)
    };
}

async function guardarSeccion({ id, seccion, cambios }) {
    assertSeccionValida(seccion);
    return enTransaccion(async (conn) => {
        const { lote, candidato } = await bloquearCandidatoEditable(id, conn);
        const { datos, errores } = aplicarCambiosSeccion(candidato.datos_empleado, seccion, cambios);
        if (errores.length > 0) throw new ValidacionError('Datos inválidos', errores);
        return persistirYResponder(conn, lote, candidato, datos);
    });
}

// El checkbox "Verificado" de una sección. Marcarlo guarda el hash del contenido actual;
// desmarcarlo borra la fila.
async function marcarVerificacion({ id, seccion, verificado, usuarioId }) {
    assertSeccionValida(seccion);
    return enTransaccion(async (conn) => {
        const { lote, candidato } = await bloquearCandidatoEditable(id, conn);

        if (verificado) {
            const resolver = await cargarResolver(conn);
            const verificaciones = await verificacionRepo.findByCandidato(id, conn);
            const { completitud } = evaluarCandidato({ candidato, lote, resolver, verificaciones });
            assertPuedeVerificar(completitud.secciones[seccion]);
            await verificacionRepo.guardar({
                candidatoId: id,
                seccion,
                hashContenido: hashSeccion(candidato.datos_empleado, seccion),
                usuarioId
            }, conn);
        } else {
            await verificacionRepo.eliminar(id, seccion, conn);
        }

        return persistirYResponder(conn, lote, candidato, candidato.datos_empleado);
    });
}

async function descartarCandidato({ id, motivo }) {
    return enTransaccion(async (conn) => {
        const base = await candidatoRepo.findById(id, conn);
        if (!base) throw new NoEncontradoError('El candidato no existe');
        const lote = await loteRepo.findByIdParaActualizar(base.hydra_lote_id, conn);
        const candidato = await candidatoRepo.findByIdParaActualizar(id, conn);
        assertPuedeDescartar(candidato.estado, motivo);

        await candidatoRepo.actualizarEstado(id, 'descartado', motivo.trim(), conn);
        // Aviso a Hydra por el outbox, en la misma transacción (conexionhydra.md §5.2).
        await envioRepo.insertar({
            tipo: 'candidato_descartado',
            hydraCandidatoExternoId: candidato.hydra_candidato_externo_id,
            payload: {
                hydra_candidato_id: candidato.hydra_candidato_externo_id,
                motivo: motivo.trim(),
                lote_externo_id: lote.lote_externo_id
            }
        }, conn);
        const loteEstado = await recalcularEstadoLote(lote, conn);
        return { success: true, lote_estado: loteEstado, candidato: { id, estado: 'descartado', motivo_descarte: motivo.trim() } };
    });
}

// ---------------------------------------------------------------------------
// Mapeos de catálogo
// ---------------------------------------------------------------------------

// Opciones de Gestor por catálogo, para el selector del modal "valor sin mapear".
async function opcionesCatalogos() {
    const catalogos = await catalogoRepo.findCatalogos(CATALOGOS);
    const opciones = {};
    for (const [catalogo, filas] of Object.entries(catalogos)) {
        opciones[catalogo] = filas
            .map((f) => ({ id: f.id, nombre: f.codigo ? `${f.codigo} — ${f.nombre}` : f.nombre }))
            .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    }
    return { success: true, catalogos: opciones };
}

async function listarMapeos() {
    const [mapeos, catalogos] = await Promise.all([
        catalogoRepo.findMapeosDetalle(),
        catalogoRepo.findCatalogos(CATALOGOS)
    ]);
    return {
        success: true,
        mapeos: mapeos.map((m) => ({
            ...m,
            nombre_gestor: catalogos[m.catalogo]?.find((f) => f.id === m.id_gestor)?.nombre ?? null
        }))
    };
}

/**
 * Guarda (o corrige) un mapeo y lo aplica en el acto a los candidatos abiertos que
 * tenían ese valor sin mapear: se completan solo los campos de ese catálogo que siguen
 * vacíos. Lo que RRHH ya eligió a mano no se toca.
 */
async function guardarMapeo({ catalogo, valorHydra, idGestor, usuarioId }) {
    if (!CATALOGOS.includes(catalogo)) {
        throw new ReglaContratacionError(`Catálogo desconocido: ${catalogo}`);
    }
    const filas = (await catalogoRepo.findCatalogos([catalogo]))[catalogo];
    if (!filas.some((f) => f.id === Number(idGestor))) {
        throw new ReglaContratacionError(`El valor ${idGestor} no existe en el catálogo ${catalogo} de Gestor`);
    }

    return enTransaccion(async (conn) => {
        await catalogoRepo.guardarMapeo({ catalogo, valorHydra: valorHydra.trim(), idGestor: Number(idGestor), usuarioId }, conn);
        const resolver = await cargarResolver(conn);

        let candidatosActualizados = 0;
        const lotes = await loteRepo.findAbiertosConCandidatosEditablesParaActualizar(conn);
        for (const lote of lotes) {
            const candidatos = await candidatoRepo.findEditablesByLoteParaActualizar(lote.idhydra_lote, conn);
            for (const candidato of candidatos) {
                const hydraMapeado = mapearPayloadHydra(candidato.datos_hydra, resolver, {
                    fechaIngresoSugerida: fechaDeNegocio(lote.fecha_ingreso_sugerida)
                }).datosEmpleado;
                const { datos, rutas } = completarCatalogoDesdeHydra(candidato.datos_empleado, hydraMapeado, catalogo);
                if (rutas.length === 0) continue;

                const verificaciones = await verificacionRepo.findByCandidato(candidato.idhydra_candidato, conn);
                const { estado } = evaluarCandidato({
                    candidato: { ...candidato, datos_empleado: datos }, lote, resolver, verificaciones
                });
                await candidatoRepo.actualizarBorrador(candidato.idhydra_candidato, datos, estado, conn);
                candidatosActualizados += 1;
            }
            await recalcularEstadoLote(lote, conn);
        }

        return {
            success: true,
            mapeo: { catalogo, valor_hydra: valorHydra.trim(), id_gestor: Number(idGestor) },
            candidatos_actualizados: candidatosActualizados
        };
    });
}

module.exports = {
    listarLotes,
    obtenerLote,
    obtenerCandidato,
    guardarSeccion,
    marcarVerificacion,
    descartarCandidato,
    opcionesCatalogos,
    listarMapeos,
    guardarMapeo
};
