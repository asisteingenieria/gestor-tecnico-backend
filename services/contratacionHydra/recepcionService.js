const { createHash } = require('node:crypto');
const { AppError, NoEncontradoError, ValidacionError } = require('../../errors/AppError');
const loteRepo = require('../../repositories/contratacionHydra/loteRepository');
const candidatoRepo = require('../../repositories/contratacionHydra/candidatoRepository');
const verificacionRepo = require('../../repositories/contratacionHydra/verificacionRepository');
const empleadoRepo = require('../../repositories/contratacionHydra/empleadoRepository');
const peticionRepo = require('../../repositories/contratacionHydra/peticionEntranteRepository');
const documentoRepo = require('../../repositories/contratacionHydra/documentoRepository');
const { documentosContratacion } = require('../../middleware/uploadSoportesRrhh');
const { cargarResolver, evaluarCandidato, fechaDeNegocio, recalcularEstadoLote } = require('./evaluacionService');
const { enTransaccion } = require('./transaccion');
const { registrarEvento } = require('./examenesService');
const {
    mapearPayloadHydra,
    fusionarReenvioHydra,
    assertHydraPuedeActualizar,
    problemaDelArchivo,
    FORMATOS
} = require('../../domain/contratacionHydra');

// Recepción de lo que envía Hydra (conexionhydra.md §5.1). Todo caso de uso corre en una
// transacción, bloquea primero el lote y después el candidato (siempre en ese orden, para
// no generar deadlocks entre peticiones concurrentes) y deja registro de idempotencia en
// la misma transacción.

// Si la misma Idempotency-Key ya se procesó, devuelve la respuesta guardada sin volver a
// ejecutar nada. Si llega con otro cuerpo u otro endpoint, es un error de Hydra.
async function conIdempotencia(contexto, ejecutar) {
    const hashCuerpo = createHash('sha256').update(contexto.rawBody ?? Buffer.alloc(0)).digest('hex');

    const previa = await peticionRepo.findByIdempotencyKey(contexto.idempotencyKey);
    if (previa) {
        if (previa.hash_cuerpo !== hashCuerpo || previa.endpoint !== contexto.endpoint) {
            throw new AppError('La Idempotency-Key ya se usó con otra petición', 422, 'IDEMPOTENCY_KEY_REUTILIZADA');
        }
        return { status: previa.codigo_respuesta, body: previa.respuesta };
    }

    return enTransaccion(async (conn) => {
        const resultado = await ejecutar(conn);
        await peticionRepo.insertar({
            idempotencyKey: contexto.idempotencyKey,
            endpoint: contexto.endpoint,
            hashCuerpo,
            codigoRespuesta: resultado.status,
            respuesta: resultado.body,
            ipOrigen: contexto.ip
        }, conn);
        return resultado;
    });
}

function assertLoteAbierto(lote) {
    if (lote.estado === 'registrado' || lote.estado === 'cancelado') {
        throw new AppError(`El lote ${lote.lote_externo_id} está "${lote.estado}" y no admite cambios`, 409, 'LOTE_CERRADO');
    }
}

function filaParaGuardar({ loteId, payload, mapeo, datosEmpleado, estado, usersCompanyExistenteId, motivoDescarte }) {
    return {
        loteId,
        hydraCandidatoExternoId: payload.hydra_candidato_id,
        tipoIdentificacion: mapeo.resumen.tipoIdentificacion,
        numeroIdentificacion: mapeo.resumen.numeroIdentificacion,
        nombreCompleto: mapeo.resumen.nombreCompleto,
        cargoHydra: mapeo.resumen.cargoHydra,
        datosHydra: payload,
        versionHydra: payload.version,
        datosEmpleado,
        estado,
        usersCompanyExistenteId,
        motivoDescarte
    };
}

// Alta o reenvío de un candidato dentro de un lote ya bloqueado.
async function guardarCandidato(conn, lote, payload, resolver) {
    const opciones = { fechaIngresoSugerida: fechaDeNegocio(lote.fecha_ingreso_sugerida) };
    const mapeo = mapearPayloadHydra(payload, resolver, opciones);
    const existenteId = await empleadoRepo.findIdPorIdentificacion(
        mapeo.resumen.numeroIdentificacion, mapeo.datosEmpleado.tipo_identificacion_id, conn
    );
    const respuesta = (resultado, estado) => ({
        hydra_candidato_id: payload.hydra_candidato_id,
        resultado,
        estado,
        reintegro: existenteId != null
    });

    const actual = await candidatoRepo.findByExternoIdParaActualizar(payload.hydra_candidato_id, conn);

    if (!actual) {
        const nuevo = {
            estado: 'pendiente',
            datos_hydra: payload,
            datos_empleado: mapeo.datosEmpleado,
            users_company_existente_id: existenteId
        };
        const { estado } = evaluarCandidato({ candidato: nuevo, lote, resolver });
        await candidatoRepo.insertar(filaParaGuardar({
            loteId: lote.idhydra_lote, payload, mapeo,
            datosEmpleado: mapeo.datosEmpleado, estado, usersCompanyExistenteId: existenteId
        }), conn);
        return respuesta(existenteId ? 'reintegro_detectado' : 'creado', estado);
    }

    if (actual.hydra_lote_id !== lote.idhydra_lote) {
        return { ...respuesta('en_otro_lote', actual.estado), reintegro: actual.users_company_existente_id != null };
    }
    if (actual.estado === 'registrado') return respuesta('ya_registrado', actual.estado);
    if (payload.version <= actual.version_hydra) return respuesta('sin_cambios', actual.estado);

    assertHydraPuedeActualizar(actual.estado);

    const hydraAnterior = mapearPayloadHydra(actual.datos_hydra, resolver, opciones).datosEmpleado;
    const datosEmpleado = fusionarReenvioHydra(actual.datos_empleado, hydraAnterior, mapeo.datosEmpleado);
    // Si Hydra lo había cancelado y lo vuelve a enviar, el candidato vuelve al proceso.
    // Un descarte de RRHH, en cambio, se respeta (estadoCandidato no saca de terminales).
    const estadoBase = actual.estado === 'cancelado_hydra' ? 'pendiente' : actual.estado;
    const verificaciones = await verificacionRepo.findByCandidato(actual.idhydra_candidato, conn);
    const { estado } = evaluarCandidato({
        candidato: { ...actual, estado: estadoBase, datos_hydra: payload, datos_empleado: datosEmpleado, users_company_existente_id: existenteId },
        lote, resolver, verificaciones
    });

    await candidatoRepo.actualizarDesdeHydra(actual.idhydra_candidato, filaParaGuardar({
        loteId: lote.idhydra_lote, payload, mapeo, datosEmpleado, estado,
        usersCompanyExistenteId: existenteId,
        motivoDescarte: ['descartado', 'no_apto'].includes(estado) ? actual.motivo_descarte : null
    }), conn);
    return respuesta('actualizado', estado);
}

async function recibirLote(payload, contexto) {
    return conIdempotencia(contexto, async (conn) => {
        let lote = await loteRepo.findByExternoIdParaActualizar(payload.lote_externo_id, conn);
        const esNuevo = !lote;
        if (esNuevo) {
            try {
                await loteRepo.insertar({
                    loteExternoId: payload.lote_externo_id,
                    nombre: payload.nombre,
                    fechaIngresoSugerida: payload.fecha_ingreso_sugerida
                }, conn);
            } catch (error) {
                // Dos envíos simultáneos del mismo lote nuevo: el segundo choca con el UNIQUE.
                // Al reintentar encontrará el lote creado y seguirá el camino idempotente.
                if (error.code === 'ER_DUP_ENTRY') {
                    throw new AppError('El lote se está creando en otra petición; reintenta', 409, 'PETICION_CONCURRENTE');
                }
                throw error;
            }
            lote = await loteRepo.findByExternoIdParaActualizar(payload.lote_externo_id, conn);
        }
        assertLoteAbierto(lote);

        const resolver = await cargarResolver(conn);
        const candidatos = [];
        for (const candidato of payload.candidatos) {
            candidatos.push(await guardarCandidato(conn, lote, candidato, resolver));
        }
        const estado = await recalcularEstadoLote(lote, conn);

        return {
            status: esNuevo ? 201 : 200,
            body: {
                success: true,
                lote_id: lote.idhydra_lote,
                lote_externo_id: lote.lote_externo_id,
                estado,
                candidatos
            }
        };
    });
}

// Lote del candidato, bloqueado antes que el candidato (orden fijo: lote → candidato).
async function bloquearLoteDeCandidato(hydraCandidatoExternoId, conn) {
    const resumen = await candidatoRepo.findEstadoByExternoId(hydraCandidatoExternoId, conn);
    if (!resumen) throw new NoEncontradoError(`Gestor no tiene el candidato ${hydraCandidatoExternoId}`);
    return loteRepo.findByExternoIdParaActualizar(resumen.lote_externo_id, conn);
}

async function actualizarCandidato(payload, contexto) {
    return conIdempotencia(contexto, async (conn) => {
        const lote = await bloquearLoteDeCandidato(payload.hydra_candidato_id, conn);
        assertLoteAbierto(lote);
        const resolver = await cargarResolver(conn);
        const candidato = await guardarCandidato(conn, lote, payload, resolver);
        const estado = await recalcularEstadoLote(lote, conn);
        return { status: 200, body: { success: true, lote_estado: estado, candidato } };
    });
}

async function cancelarCandidato(hydraCandidatoExternoId, motivo, contexto) {
    return conIdempotencia(contexto, async (conn) => {
        const lote = await bloquearLoteDeCandidato(hydraCandidatoExternoId, conn);
        const actual = await candidatoRepo.findByExternoIdParaActualizar(hydraCandidatoExternoId, conn);
        assertHydraPuedeActualizar(actual.estado);

        // Un "no apto" de SST (089) ya está fuera del proceso: se conserva su motivo.
        if (actual.estado !== 'cancelado_hydra' && actual.estado !== 'no_apto') {
            await candidatoRepo.actualizarEstado(
                actual.idhydra_candidato, 'cancelado_hydra', motivo || 'Cancelado desde Hydra', conn
            );
        }
        const estado = await recalcularEstadoLote(lote, conn);
        return {
            status: 200,
            body: {
                success: true,
                lote_estado: estado,
                candidato: { hydra_candidato_id: hydraCandidatoExternoId, estado: 'cancelado_hydra' }
            }
        };
    });
}

// Selección (Hydra) decide si da continuidad a un candidato que no asistió a los exámenes
// médicos (migración 089, conexionhydra.md §16). Continuar → el examen queda "reagendado"
// y SST vuelve a marcar asistencia; no continuar → el candidato sale del proceso.
// Si SST ya volvió a marcar asistencia, no hay decisión pendiente: 409.
async function decidirContinuidad(hydraCandidatoExternoId, body, contexto) {
    return conIdempotencia(contexto, async (conn) => {
        const lote = await bloquearLoteDeCandidato(hydraCandidatoExternoId, conn);
        const candidato = await candidatoRepo.findByExternoIdParaActualizar(hydraCandidatoExternoId, conn);
        if (candidato.examen_estado !== 'no_asistio' || !['pendiente', 'listo'].includes(candidato.estado)) {
            throw new AppError(
                'El candidato no tiene una inasistencia a exámenes médicos pendiente de decisión',
                409, 'SIN_DECISION_PENDIENTE'
            );
        }
        const r = await registrarEvento(conn, {
            lote,
            candidato,
            evento: body.continuar ? 'continuidad' : 'no_continuidad',
            nota: body.nota,
            origen: 'hydra',
            usuarioHydra: body.decidido_por ?? null
        });
        return {
            status: 200,
            body: {
                success: true,
                lote_estado: r.loteEstado,
                candidato: { hydra_candidato_id: hydraCandidatoExternoId, estado: r.estado, examen_estado: r.examenEstado }
            }
        };
    });
}

// Un documento del candidato (migración 087, conexionhydra.md §15): uno por tipo; un
// reenvío lo reemplaza. Se acepta en cualquier estado del candidato y del lote, también
// ya registrado: el documento queda en su ficha.
//
// El archivo se escribe dentro de la transacción y se borra si algo falla; el anterior
// se borra solo después del commit.
async function recibirDocumento(hydraCandidatoExternoId, body, contexto) {
    const contenido = Buffer.from(body.contenido_base64, 'base64');
    const sha256 = createHash('sha256').update(contenido).digest('hex');
    const problema = problemaDelArchivo({ mime: body.mime_type, contenido, sha256: body.sha256, sha256Real: sha256 });
    if (problema) throw new ValidacionError('Documento inválido', [problema]);

    let archivoNuevo = null;
    try {
        const resultado = await conIdempotencia(contexto, async (conn) => {
            await bloquearLoteDeCandidato(hydraCandidatoExternoId, conn);
            const candidato = await candidatoRepo.findByExternoIdParaActualizar(hydraCandidatoExternoId, conn);
            const anterior = await documentoRepo.findByCandidatoYTipoParaActualizar(candidato.idhydra_candidato, body.tipo, conn);
            const respuesta = (status, resultadoDocumento) => ({
                status,
                body: {
                    success: true,
                    documento: { hydra_candidato_id: hydraCandidatoExternoId, tipo: body.tipo, resultado: resultadoDocumento }
                }
            });

            // Mismo contenido (p. ej. "reenviar" en Hydra): no se reescribe el archivo.
            if (anterior?.sha256 === sha256) return respuesta(200, 'sin_cambios');

            archivoNuevo = await documentosContratacion.guardar(contenido, FORMATOS[body.mime_type].extension);
            await documentoRepo.guardar({
                hydraCandidatoId: candidato.idhydra_candidato,
                tipo: body.tipo,
                nombre: body.nombre,
                nombreOriginal: body.nombre_archivo,
                mime: body.mime_type,
                tamanoBytes: contenido.length,
                sha256,
                archivo: archivoNuevo
            }, conn);
            return { ...respuesta(anterior ? 200 : 201, anterior ? 'reemplazado' : 'creado'), archivoAnterior: anterior?.archivo };
        });

        if (resultado.archivoAnterior) documentosContratacion.borrar(resultado.archivoAnterior);
        return { status: resultado.status, body: resultado.body };
    } catch (error) {
        if (archivoNuevo) documentosContratacion.borrar(archivoNuevo);
        throw error;
    }
}

async function consultarCandidato(hydraCandidatoExternoId) {
    const resumen = await candidatoRepo.findEstadoByExternoId(hydraCandidatoExternoId);
    if (!resumen) throw new NoEncontradoError(`Gestor no tiene el candidato ${hydraCandidatoExternoId}`);
    return {
        success: true,
        candidato: {
            hydra_candidato_id: resumen.hydra_candidato_externo_id,
            estado: resumen.estado,
            motivo_descarte: resumen.motivo_descarte,
            users_company_id: resumen.users_company_id,
            version: resumen.version_hydra,
            actualizado_en: resumen.updated_at,
            lote_externo_id: resumen.lote_externo_id,
            lote_estado: resumen.lote_estado
        }
    };
}

module.exports = { recibirLote, actualizarCandidato, cancelarCandidato, decidirContinuidad, recibirDocumento, consultarCandidato };
