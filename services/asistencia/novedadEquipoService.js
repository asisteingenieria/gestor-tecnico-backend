const novedadEquipoRepo = require('../../repositories/asistencia/novedadEquipoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const { presentarNovedad } = require('../../domain/asistencia/novedadesEquipo');
const { fechaLaboral } = require('../../utils/fechaBogota');

// Historial de novedades del equipo (asistencia.md §56). Lo ve quien sea jefe inmediato (coordinador),
// jefe de área o gestor de alguien (canVerEquipo, §57): no hay rol, sale de RRHH en cada petición.
async function historial({ usersCompanyId, desde, hasta, empleadoId, tipoNovedadId }) {
    // La raíz va en la lista: salen las novedades de quien la tiene a ella como jefe inmediato o de área,
    // aunque ya se haya retirado (el árbol solo trae contratos activos).
    const idsArbol = [usersCompanyId, ...(await equipoRepo.idsDelArbol(usersCompanyId))];
    const filas = await novedadEquipoRepo.listarDelArbol({
        idsArbol, raizUsersCompanyId: usersCompanyId, desde, hasta, empleadoId, tipoNovedadId
    });
    const hoy = fechaLaboral(new Date());
    return filas.map((f) => presentarNovedad(f, hoy));
}

module.exports = { historial };
