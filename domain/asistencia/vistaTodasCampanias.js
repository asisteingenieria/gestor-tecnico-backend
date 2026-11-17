// Cargos que, además de su equipo, consultan la asistencia de todas las campañas (asistencia.md §68).
// Es solo lectura: en vivo, histórico y trazabilidad. Gestionar (horarios, horas extra, correcciones)
// sigue siendo solo para su equipo. Se comparan sin tildes ni mayúsculas, como vienen del catálogo `cargo`.
const CARGOS_VISTA_TODAS_CAMPANIAS = ['DIRECTOR DE TECNOLOGIA'];

function normalizarCargo(cargo) {
    return String(cargo ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

function veTodasLasCampanias(cargo) {
    const normalizado = normalizarCargo(cargo);
    return normalizado !== '' && CARGOS_VISTA_TODAS_CAMPANIAS.includes(normalizado);
}

// Alcance pedido por la pantalla de Equipo: su equipo (por defecto), todas las campañas o una.
// `alcance` = 'todas' gana sobre `campania_id`.
function alcanceDeConsulta({ alcance, campaniaId } = {}) {
    if (alcance === 'todas') return { tipo: 'todas', campaniaId: null };
    if (campaniaId != null && campaniaId !== '') return { tipo: 'campania', campaniaId: Number(campaniaId) };
    return { tipo: 'equipo', campaniaId: null };
}

module.exports = { CARGOS_VISTA_TODAS_CAMPANIAS, normalizarCargo, veTodasLasCampanias, alcanceDeConsulta };
