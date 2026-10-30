const db = require('../../config/db');
const { NoEncontradoError, ReglaContratacionError } = require('../../errors/AppError');
const loteRepo = require('../../repositories/contratacionHydra/loteRepository');
const candidatoRepo = require('../../repositories/contratacionHydra/candidatoRepository');
const verificacionRepo = require('../../repositories/contratacionHydra/verificacionRepository');
const empleadoRepo = require('../../repositories/contratacionHydra/empleadoRepository');
const envioRepo = require('../../repositories/contratacionHydra/envioRepository');
const documentoRepo = require('../../repositories/contratacionHydra/documentoRepository');
const { cargarResolver, evaluarCandidato } = require('./evaluacionService');
const { validarObligatorios } = require('../../utils/validarEmpleado');
const { assertLoteRegistrable, resumenDocumentos } = require('../../domain/contratacionHydra');

// Registro de un lote como empleados (conexionhydra.md §7): todo o nada, en una sola
// transacción, con simulación previa.
//
// En simulación se hace EXACTAMENTE lo mismo (incluidos los INSERT reales, que es lo
// único que detecta un ID de catálogo inexistente o una campaña borrada) y al final se
// hace ROLLBACK. Ante cualquier problema se recorren igual todos los candidatos para
// devolver la lista completa de errores de una vez, no de a uno por intento.

// Traduce los errores de MySQL/UserCompany a algo que RRHH pueda corregir.
function mensajeDeError(error) {
    if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
        const columna = /FOREIGN KEY \(`([^`]+)`\)/.exec(error.sqlMessage ?? '')?.[1];
        return `Un valor elegido no existe en el catálogo de Gestor${columna ? ` (${columna})` : ''}`;
    }
    if (error.code === 'ER_TRUNCATED_WRONG_VALUE' || error.code === 'ER_WRONG_VALUE') {
        return 'Hay un valor con formato inválido (revisa fechas y números)';
    }
    if (error.code === 'ER_DATA_TOO_LONG') {
        return 'Hay un texto más largo de lo que admite Gestor';
    }
    if (error.sqlMessage) return 'Error de base de datos al crear el empleado';
    return error.message;
}

async function registrarLote({ loteId, simular, usuarioId }) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Bloqueo lote → candidatos: dos clics o dos usuarios no pueden registrar a la vez;
        // el segundo espera y luego encuentra el lote 'registrado'.
        const lote = await loteRepo.findByIdParaActualizar(loteId, conn);
        if (!lote) throw new NoEncontradoError('El lote no existe');
        const candidatos = await candidatoRepo.findByLoteParaActualizar(loteId, conn);
        assertLoteRegistrable(lote.estado, candidatos.map((c) => c.estado));

        const resolver = await cargarResolver(conn);
        const verificaciones = await verificacionRepo.findByLote(loteId, conn);
        const documentos = await documentoRepo.findTiposByLote(loteId, conn);
        const aRegistrar = candidatos.filter((c) => c.estado === 'listo');

        const errores = [];
        const registrados = [];
        for (const candidato of aRegistrar) {
            const etiqueta = `${candidato.nombre_completo} (${candidato.numero_identificacion})`;

            // No se confía en el estado guardado: se recalcula todo con los datos actuales.
            const propias = verificaciones.filter((v) => v.hydra_candidato_id === candidato.idhydra_candidato);
            const { completitud } = evaluarCandidato({ candidato, lote, resolver, verificaciones: propias });
            if (!completitud.listo) {
                errores.push(`${etiqueta}: tiene secciones pendientes o desactualizadas`);
                continue;
            }
            // Hoja de vida y tratamiento de datos firmados (migración 087): Hydra los manda
            // después del lote; hasta que lleguen, no se registra.
            const tipos = documentos.filter((d) => d.hydra_candidato_id === candidato.idhydra_candidato).map((d) => d.tipo);
            const { firmados_pendientes: pendientes } = resumenDocumentos(candidato.datos_hydra, tipos);
            if (pendientes.length > 0) {
                errores.push(`${etiqueta}: todavía no llega de Hydra ${pendientes.map((p) => p.nombre.toLowerCase()).join(' ni ')}`);
                continue;
            }
            const errorObligatorios = validarObligatorios(candidato.datos_empleado);
            if (errorObligatorios) {
                errores.push(`${etiqueta}: ${errorObligatorios}`);
                continue;
            }
            const existente = await empleadoRepo.findIdPorIdentificacion(
                candidato.numero_identificacion, candidato.datos_empleado.tipo_identificacion_id, conn
            );
            if (existente) {
                errores.push(`${etiqueta}: ya existe como empleado (id ${existente}); descártalo y gestiónalo como reintegro`);
                continue;
            }

            let usersCompanyId;
            try {
                usersCompanyId = await empleadoRepo.crear(candidato.datos_empleado, conn);
            } catch (error) {
                // Un error de sentencia en InnoDB solo revierte esa sentencia: la
                // transacción sigue viva y se puede seguir validando a los demás.
                errores.push(`${etiqueta}: ${mensajeDeError(error)}`);
                continue;
            }

            await candidatoRepo.marcarRegistrado(candidato.idhydra_candidato, usersCompanyId, conn);
            await envioRepo.insertar({
                tipo: 'candidato_registrado',
                hydraCandidatoExternoId: candidato.hydra_candidato_externo_id,
                payload: {
                    hydra_candidato_id: candidato.hydra_candidato_externo_id,
                    users_company_id: usersCompanyId,
                    fecha_ingreso: candidato.datos_empleado.contrato.fecha_ingreso,
                    lote_externo_id: lote.lote_externo_id
                }
            }, conn);
            registrados.push({
                id: candidato.idhydra_candidato,
                hydra_candidato_id: candidato.hydra_candidato_externo_id,
                nombre_completo: candidato.nombre_completo,
                users_company_id: usersCompanyId
            });
        }

        if (errores.length > 0) {
            const error = new ReglaContratacionError(
                `No se puede registrar el lote: ${errores.length} candidato(s) con problemas. No se registró a nadie.`
            );
            error.detalles = errores;
            throw error;
        }

        await loteRepo.marcarRegistrado(loteId, usuarioId, conn);

        if (simular) {
            await conn.rollback();
            // Los IDs no se devuelven: con el ROLLBACK no quedan asignados.
            return {
                success: true,
                simulacion: true,
                message: `Simulación correcta: se registrarían ${registrados.length} empleado(s)`,
                empleados: registrados.map(({ users_company_id, ...resto }) => resto)
            };
        }

        await conn.commit();
        return {
            success: true,
            simulacion: false,
            message: `Se registraron ${registrados.length} empleado(s)`,
            empleados: registrados
        };
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

module.exports = { registrarLote };
