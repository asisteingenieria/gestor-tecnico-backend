// Cruce de empleados del Gestor con los usuarios activos de Aware, por cédula. Lo usa la pestaña
// "Empleados activos" del técnico de inventario (GET /api/aware-agentes/cruce). Sin BD ni red: los
// empleados vienen de models/CruceAware.js y los agentes de VoxPro (services/voxproAwareClient.js).

const ROL_AGENTE_AWARE = 2; // en todas las instancias de Aware el rol 2 es el del agente (el 90% de los usuarios)

// Cédula comparable: solo dígitos y sin ceros a la izquierda. Si no tiene dígitos (en Claro WCB el
// user_id puede ser un login), se compara el texto en minúsculas.
function normalizarCedula(valor) {
    if (valor === null || valor === undefined) return '';
    const texto = String(valor).trim();
    const digitos = texto.replace(/\D/g, '');
    if (digitos) return digitos.replace(/^0+(?=\d)/, '');
    return texto.toLowerCase();
}

// Categorías del cruce:
//  - ambos:              activo en la compañía y activo en al menos un Aware.
//  - aware_sin_compania: activo en Aware, pero retirado de la compañía o sin ficha en el Gestor.
//  - compania_sin_aware: activo en la compañía y sin usuario activo en ningún Aware.
// Los retirados que tampoco están en Aware no aparecen: no hay nada que revisar.
function cruzar(empleados, agentes) {
    const porCedula = new Map();
    const fila = (cedula) => {
        if (!porCedula.has(cedula)) {
            porCedula.set(cedula, {
                cedula,
                nombre: '',
                estado_compania: 'no_registrado',
                campania_compania: null,
                cargo_compania: null,
                nombre_aware: '',
                aware: [],
            });
        }
        return porCedula.get(cedula);
    };

    for (const e of empleados) {
        const cedula = normalizarCedula(e.cedula);
        if (!cedula) continue;
        const f = fila(cedula);
        const estado = e.estado === 'activo' ? 'activo' : e.estado === 'retirado' ? 'retirado' : 'sin_contrato';
        // Si la cédula está repetida en el Gestor, manda la ficha activa.
        if (f.estado_compania === 'activo' && estado !== 'activo') continue;
        f.nombre = e.nombre || f.nombre;
        f.estado_compania = estado;
        f.campania_compania = e.campania || null;
        f.cargo_compania = e.cargo || null;
        f.users_company_id = e.id;
    }

    for (const a of agentes) {
        const cedula = normalizarCedula(a.cedula);
        if (!cedula) continue;
        const f = fila(cedula);
        if (!f.nombre_aware && a.nombre) f.nombre_aware = a.nombre;
        if (!f.aware.some((x) => x.folder === a.folder && x.rol_id === a.rol_id)) {
            f.aware.push({ folder: a.folder, campania: a.campania, rol_id: a.rol_id, es_agente: a.rol_id === ROL_AGENTE_AWARE });
        }
    }

    const filas = [];
    for (const f of porCedula.values()) {
        const enAware = f.aware.length > 0;
        if (f.estado_compania === 'activo') {
            f.categoria = enAware ? 'ambos' : 'compania_sin_aware';
        } else if (enAware) {
            f.categoria = 'aware_sin_compania';
        } else {
            continue;
        }
        f.nombre = f.nombre || f.nombre_aware;
        f.es_agente_aware = f.aware.some((x) => x.es_agente);
        filas.push(f);
    }
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }) || a.cedula.localeCompare(b.cedula));

    const resumen = {
        activos_compania: filas.filter((f) => f.estado_compania === 'activo').length,
        ambos: filas.filter((f) => f.categoria === 'ambos').length,
        aware_sin_compania: filas.filter((f) => f.categoria === 'aware_sin_compania').length,
        compania_sin_aware: filas.filter((f) => f.categoria === 'compania_sin_aware').length,
        activos_aware: filas.filter((f) => f.aware.length > 0).length,
    };
    return { filas, resumen };
}

module.exports = { normalizarCedula, cruzar, ROL_AGENTE_AWARE };
