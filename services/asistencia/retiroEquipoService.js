const retiroRepo = require('../../repositories/asistencia/retiroEquipoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const notificacionRepo = require('../../repositories/asistencia/notificacionAsistenciaRepository');
const notificacionService = require('./notificacionAsistenciaService');
const { presentarRetiro, destinatariosAvisoRetiro, mensajeAvisoRetiro, errorFechaRetiroRm } = require('../../domain/asistencia/retirosEquipo');
const { fechaLaboral } = require('../../utils/fechaBogota');
const { NoEncontradoError, ReglaAsistenciaError } = require('../../errors/AppError');

// Retiros del equipo para la Red Maestra de Claro (asistencia.md §59). Desde §61 lo ve y lo registra solo quien
// gestiona un equipo (canDirigirEquipo: jefe de área o gestor, como Kevin Buitrago); el coordinador no.
// El árbol sí sigue las tres líneas: el jefe ve también a los retirados de sus coordinadores.

// La raíz va en la lista: salen los retirados que la tenían a ella como jefe, aunque ya no estén en el árbol.
async function arbolDe(usersCompanyId) {
    return [usersCompanyId, ...(await equipoRepo.idsDelArbol(usersCompanyId))];
}

async function listar({ usersCompanyId, soloPendientes }) {
    const filas = await retiroRepo.listarDelArbol({
        idsArbol: await arbolDe(usersCompanyId), raizUsersCompanyId: usersCompanyId, soloPendientes
    });
    return filas.map(presentarRetiro);
}

async function pendientes({ usersCompanyId }) {
    const total = await retiroRepo.contarPendientesDelArbol({
        idsArbol: await arbolDe(usersCompanyId), raizUsersCompanyId: usersCompanyId
    });
    return { pendientes: total };
}

// `fecha` null borra la fecha (el retiro vuelve a quedar pendiente). Se guarda por la ficha del jefe
// (regla 16 de la arquitectura): el mismo jefe la ve igual entre con su usuario o con su cédula.
async function registrarRetiroRm({ usersCompanyId, empleadoId, fecha }) {
    const idsArbol = await arbolDe(usersCompanyId);
    const retiro = await retiroRepo.retiroDelArbol({ idsArbol, raizUsersCompanyId: usersCompanyId, empleadoId });
    if (!retiro) throw new NoEncontradoError('Retiro no encontrado en tu equipo');
    const error = errorFechaRetiroRm(fecha || null, { hoy: fechaLaboral(new Date()), fechaIngreso: retiro.fecha_ingreso });
    if (error) throw new ReglaAsistenciaError(error);
    await retiroRepo.guardarFechaRetiroRm({ empleadoId, fecha: fecha || null, porUsersCompanyId: usersCompanyId });
    const filas = await retiroRepo.listarDelArbol({ idsArbol, raizUsersCompanyId: usersCompanyId });
    return presentarRetiro(filas.find((f) => f.empleado_id === empleadoId));
}

// Aviso a la campana de los jefes cuando RRHH registra un retiro de Claro. Lo llama el controller de RRHH
// después de guardar el retiro; si no es de Claro o no tiene jefes, no hace nada.
async function avisarRetiro(empleadoId) {
    const contrato = await retiroRepo.contratoRetiradoParaAviso(empleadoId);
    if (!contrato) return { avisados: 0 };
    const destinatarios = destinatariosAvisoRetiro({
        empleadoId,
        jefeInmediatoId: contrato.jefe_inmediato_id,
        jefeAreaId: contrato.jefe_area_id,
        gestorAsistenciaId: contrato.gestor_asistencia_id
    });
    const mensaje = mensajeAvisoRetiro({ nombre: contrato.nombre, fechaRetiro: contrato.fecha_retiro });
    const notificaciones = destinatarios.map((id) => ({ usersCompanyId: id, tipo: 'retiro_empleado', mensaje }));
    await notificacionRepo.insertarVarias(notificaciones);
    notificacionService.avisarEnVivo(notificaciones);
    return { avisados: notificaciones.length };
}

module.exports = { listar, pendientes, registrarRetiroRm, avisarRetiro };
