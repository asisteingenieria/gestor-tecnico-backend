/**
 * Quién marca por AsisLock y quién no (asistencia.md §83). Puro, sin E/S.
 *
 * AsisLock (con sus estados Conectado, Break, Baño, Almuerzo, Capacitación y Desconectado) es de la
 * operación: agentes, coordinadores y backoffice de las campañas. El staff (técnicos, desarrolladores,
 * analistas, formadores, jefes, directores, administrativos…) no entra a AsisLock: marca por molinete
 * o por el portal, y en el monitor del equipo no tiene pausas que mostrar.
 *
 * Regla, en orden:
 *   1. Si hoy tiene registros de AsisLock, usa AsisLock (nunca se esconde un dato real).
 *   2. Centro de costo de staff (ADMINISTRATIVO, DIRECCION …, y los nombres anteriores a la 093) → no.
 *   3. Cargo de agente, asesor, coordinador o backoffice → sí. Jefe, director o gerente → no.
 *   4. Cualquier otro cargo → no.
 */

const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const CENTROS_STAFF = new Set(['ADMINISTRATIVO', 'ADMINISTRACION', 'STAFF', 'TECNOLOGIA', 'RECURSOS HUMANOS', 'WORKFORCE']);

function esCentroStaff(centroCosto) {
    const c = sinTildes(centroCosto);
    return CENTROS_STAFF.has(c) || c.startsWith('DIRECCION');
}

function esCargoOperativo(cargo) {
    const c = sinTildes(cargo);
    if (/\b(JEFE|DIRECTOR|GERENTE)\b/.test(c)) return false;
    return /COORDINADOR|BACK\s*OFFICE|\b(AGENTE|ASESOR)\b/.test(c);
}

function usaAsislock({ cargo, centroCosto, tieneAsislockHoy = false }) {
    if (tieneAsislockHoy) return true;
    if (esCentroStaff(centroCosto)) return false;
    return esCargoOperativo(cargo);
}

module.exports = { usaAsislock, esCentroStaff, esCargoOperativo };
