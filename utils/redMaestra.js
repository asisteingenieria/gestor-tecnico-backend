/**
 * Red Maestra (RM) de Claro — reglas puras del módulo (claude/modulo recursoshumanos.md §52).
 *
 * - Lectura de la plantilla en Excel ("PLANTILLA RM EJEMPLO"): columnas por NOMBRE, no por posición.
 *   De la plantilla solo se toman la CÉDULA (llave) y los campos que ingresa el admin; DOCUMENTO,
 *   NOMBRE COMPLETO y CAMPAÑA salen de la ficha de RRHH y se ignoran al cargar.
 * - Homologación de los valores de las listas: "CAMBIO CAMPAÑA" = "CAMBIO DE CAMPAÑA".
 * - Armado del libro de descarga (mismas columnas de la plantilla + centro de costo y usuario SSFF).
 *
 * Sin base de datos: lo usa models/RedMaestra.js y lo prueban tests/rrhh/redMaestra.test.js.
 */

/** Listas desplegables (red_maestra_opcion.campo) con su etiqueta y la tabla donde viven. */
const CAMPOS_OPCION = {
    estado_agente: { etiqueta: 'Estado agente', nivel: 'ficha' },
    cargo_rm: { etiqueta: 'Cargo RM', nivel: 'ficha' },
    estado_rm: { etiqueta: 'Estado RM', nivel: 'ficha' },
    observacion: { etiqueta: 'Observación', nivel: 'requerimiento' },
    estado_requerimiento: { etiqueta: 'Estado requerimiento', nivel: 'requerimiento' }
};

/** Columnas de la plantilla → clave interna. Los encabezados se comparan normalizados. */
const COLUMNAS = {
    documento: ['documento', 'tipo documento', 'tipo de documento'],
    cedula: ['cedula', 'numero documento', 'numero de documento', 'identificacion'],
    nombre: ['nombre completo', 'nombre'],
    campania: ['campana'],
    novedades: ['novedades', 'novedad'],
    estado_agente: ['estado agente'],
    cargo_rm: ['cargo rm'],
    estado_rm: ['estado rm'],
    requerimiento: ['requerimiento', 'numero requerimiento', 'req'],
    fecha_envio: ['fecha de envio', 'fecha envio'],
    observacion: ['observacion', 'observaciones'],
    estado_requerimiento: ['estado requerimiento', 'estado del requerimiento']
};

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

function normalizarEncabezado(s) {
    return sinTildes(s ?? '').toLowerCase().replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Texto de una celda o null si está vacía. */
function texto(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s === '' ? null : s;
}

/** Cédula comparable: sin puntos, comas ni espacios, en mayúsculas ("52.859.804" → "52859804"). */
function normalizarCedula(v) {
    const s = texto(v);
    if (!s) return null;
    // Una celda numérica puede llegar como "52859804.0": se quita el decimal antes de limpiar puntos.
    if (/^\d+\.0+$/.test(s)) return s.split('.')[0];
    return s.replace(/[.,\s-]/g, '').toUpperCase();
}

const PALABRAS_VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'EN']);

/**
 * Llave para homologar un valor de lista: sin tildes, mayúsculas, sin signos ni palabras vacías.
 * "Cambio campaña" y "CAMBIO DE CAMPAÑA" dan la misma llave; "WEB CALL BACK (IN)" → "WEB CALL BACK IN".
 */
function claveOpcion(v) {
    const s = texto(v);
    if (!s) return '';
    return sinTildes(s).toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .split(' ')
        .filter((p) => p && !PALABRAS_VACIAS.has(p))
        .join(' ');
}

/** Valor tal como se guarda en la lista cuando el cargue trae uno nuevo. */
const valorOpcion = (v) => texto(v)?.toUpperCase() ?? null;

/** Fecha de una celda (serial de Excel, Date, dd/mm/aaaa o aaaa-mm-dd) → 'YYYY-MM-DD' o null. */
function fechaISO(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
        if (!Number.isFinite(v) || v < 1) return null;
        // Serial de Excel (sistema 1900): día 0 = 1899-12-30. Se calcula en UTC para no correr el día.
        const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
        return new Date(ms).toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return valida(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return valida(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    if (/^\d+(\.\d+)?$/.test(s)) return fechaISO(Number(s));
    return null;
}

function valida(iso) {
    const d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Ubica cada columna conocida en la fila de encabezados. */
function detectarColumnas(encabezados) {
    const col = {};
    (encabezados || []).forEach((h, i) => {
        const n = normalizarEncabezado(h);
        if (!n) return;
        for (const [clave, alias] of Object.entries(COLUMNAS)) {
            if (col[clave] === undefined && alias.includes(n)) col[clave] = i;
        }
    });
    return col;
}

/**
 * Lee las filas crudas de la hoja (array de arrays, fila 0 = encabezados).
 * Devuelve { columnas, faltantes, filas: [{ fila, cedula, documento, nombre, novedades, estado_agente,
 * cargo_rm, estado_rm, requerimiento, fecha_envio, fecha_envio_texto, observacion, estado_requerimiento }] }.
 */
function leerFilas(filasCrudas) {
    const columnas = detectarColumnas(filasCrudas[0]);
    const faltantes = columnas.cedula === undefined ? ['CEDULA'] : [];
    const filas = [];
    const celda = (cruda, clave) => (columnas[clave] === undefined ? null : cruda[columnas[clave]]);
    for (let i = 1; i < filasCrudas.length; i++) {
        const cruda = filasCrudas[i] || [];
        if (cruda.every((v) => v === null || v === undefined || String(v).trim() === '')) continue;
        const fechaCruda = celda(cruda, 'fecha_envio');
        filas.push({
            fila: i + 1,
            cedula: normalizarCedula(celda(cruda, 'cedula')),
            documento: texto(celda(cruda, 'documento')),
            nombre: texto(celda(cruda, 'nombre')),
            novedades: texto(celda(cruda, 'novedades')),
            estado_agente: texto(celda(cruda, 'estado_agente')),
            cargo_rm: texto(celda(cruda, 'cargo_rm')),
            estado_rm: texto(celda(cruda, 'estado_rm')),
            requerimiento: texto(celda(cruda, 'requerimiento'))?.toUpperCase() ?? null,
            fecha_envio: fechaISO(fechaCruda),
            fecha_envio_texto: texto(fechaCruda),
            observacion: texto(celda(cruda, 'observacion')),
            estado_requerimiento: texto(celda(cruda, 'estado_requerimiento'))
        });
    }
    return { columnas, faltantes, filas };
}

/** Lee el archivo Excel (buffer). Toma la primera hoja. */
function parsearArchivo(buffer, XLSX = require('xlsx')) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const hoja = wb.Sheets[wb.SheetNames[0]];
    const filasCrudas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
    return { hoja: wb.SheetNames[0], ...leerFilas(filasCrudas) };
}

/**
 * Resuelve las filas leídas contra el Gestor, sin escribir nada.
 * @param filas      salida de leerFilas().filas
 * @param empleados  [{ id, cedula, nombre, es_claro_vigente }] de todos los empleados
 * @param opciones   [{ id, campo, valor }] de red_maestra_opcion
 * @returns { filas: [{ ...fila, users_company_id, nombre_gestor, errores, advertencias, ids }], opciones_nuevas }
 *   `ids` trae el id de cada lista o, si el valor no existe, `{ nuevo: 'VALOR' }`.
 */
function resolverFilas(filas, empleados, opciones) {
    const porCedula = new Map();
    for (const e of empleados) {
        const c = normalizarCedula(e.cedula);
        if (!c) continue;
        if (!porCedula.has(c)) porCedula.set(c, []);
        porCedula.get(c).push(e);
    }
    const porClave = new Map(opciones.map((o) => [`${o.campo}|${claveOpcion(o.valor)}`, o]));
    const nuevas = new Map(); // campo|clave → { campo, valor }

    const resolverOpcion = (campo, valor) => {
        if (!valor) return null;
        const clave = `${campo}|${claveOpcion(valor)}`;
        const existente = porClave.get(clave);
        if (existente) return { id: existente.id, valor: existente.valor };
        if (!nuevas.has(clave)) nuevas.set(clave, { campo, valor: valorOpcion(valor) });
        return { nuevo: nuevas.get(clave).valor };
    };

    const resueltas = filas.map((f) => {
        const errores = [];
        const advertencias = [];
        let empleado = null;
        if (!f.cedula) {
            errores.push('Sin cédula');
        } else {
            const encontrados = porCedula.get(f.cedula) || [];
            if (encontrados.length === 0) errores.push(`La cédula ${f.cedula} no está registrada en el personal`);
            else if (encontrados.length > 1) errores.push(`La cédula ${f.cedula} está en ${encontrados.length} fichas`);
            else empleado = encontrados[0];
        }
        if (empleado && !empleado.es_claro_vigente) {
            advertencias.push('No es un empleado vigente de Claro: aparecerá en la Red Maestra por tener datos de RM');
        }
        const hayDatosRequerimiento = f.fecha_envio_texto || f.observacion || f.estado_requerimiento;
        if (!f.requerimiento && hayDatosRequerimiento) {
            advertencias.push('Sin número de requerimiento: la fecha, observación y estado del requerimiento no se cargan');
        }
        if (f.requerimiento && f.fecha_envio_texto && !f.fecha_envio) {
            advertencias.push(`Fecha de envío no válida ("${f.fecha_envio_texto}"): el requerimiento queda sin fecha`);
        }
        const ids = {};
        for (const campo of Object.keys(CAMPOS_OPCION)) {
            if (CAMPOS_OPCION[campo].nivel === 'requerimiento' && !f.requerimiento) continue;
            ids[campo] = resolverOpcion(campo, f[campo]);
        }
        const nuevosEnFila = Object.entries(ids)
            .filter(([, v]) => v && v.nuevo)
            .map(([campo, v]) => `${CAMPOS_OPCION[campo].etiqueta}: ${v.nuevo}`);
        if (nuevosEnFila.length) advertencias.push(`Valores nuevos en las listas: ${nuevosEnFila.join(', ')}`);
        return {
            ...f,
            users_company_id: empleado ? empleado.id : null,
            nombre_gestor: empleado ? empleado.nombre : null,
            errores,
            advertencias,
            ids
        };
    });

    return { filas: resueltas, opciones_nuevas: [...nuevas.values()] };
}

/**
 * Tipo de personal por el cargo del contrato, para los totales de la Red Maestra: agentes, coordinadores,
 * backoffice y otros (staff: analistas, formadores, workforce, jefes y directores).
 * "JEFE DE BACKOFFICE" es staff, no backoffice; "COORDINADOR BACKOFFICE PE" es coordinador.
 */
const TIPOS_PERSONAL = { agente: 'Agentes', coordinador: 'Coordinadores', backoffice: 'Backoffice', otro: 'Otros (staff)' };

function tipoPersonal(cargo) {
    const c = sinTildes(cargo || '').toUpperCase();
    if (/COORDINADOR/.test(c)) return 'coordinador';
    if (/\b(JEFE|DIRECTOR|GERENTE)\b/.test(c)) return 'otro';
    if (/BACK\s*OFFICE/.test(c)) return 'backoffice';
    if (/\b(AGENTE|ASESOR)\b/.test(c)) return 'agente';
    return 'otro';
}

/** Tipo de documento como lo escribe la RM: la cédula de ciudadanía es "CEDULA", lo demás su código. */
function documentoRM(codigo) {
    if (!codigo) return '';
    return codigo === 'CC' ? 'CEDULA' : codigo;
}

const ENCABEZADOS_EXPORT = [
    'DOCUMENTO', 'CEDULA', 'NOMBRE COMPLETO', 'CAMPAÑA', 'CENTRO DE COSTO', 'USUARIO SSFF',
    'NOVEDADES', 'ESTADO AGENTE', 'CARGO RM', 'ESTADO RM', 'REQUERIMIENTO', 'FECHA DE ENVIO',
    'OBSERVACIÓN', 'ESTADO REQUERIMIENTO', 'ESTADO EN GESTOR'
];

const ENCABEZADOS_REQUERIMIENTOS = [
    'CEDULA', 'NOMBRE COMPLETO', 'REQUERIMIENTO', 'FECHA DE ENVIO', 'OBSERVACIÓN', 'ESTADO REQUERIMIENTO'
];

const ANCHOS = {
    'NOMBRE COMPLETO': 38, 'CAMPAÑA': 18, 'CENTRO DE COSTO': 24, 'NOVEDADES': 34, 'CARGO RM': 22,
    'REQUERIMIENTO': 20, 'OBSERVACIÓN': 22, 'ESTADO REQUERIMIENTO': 22, 'USUARIO SSFF': 16
};

const fechaCelda = (f) => {
    if (!f) return '';
    const iso = f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10);
    const [a, m, d] = iso.split('-');
    return a && m && d ? `${d}/${m}/${a}` : '';
};

/** Filas de la hoja "Red Maestra" (una por empleado, con su último requerimiento). */
function filasExport(registros) {
    return registros.map((r) => ({
        'DOCUMENTO': documentoRM(r.tipo_documento),
        'CEDULA': r.cedula || '',
        'NOMBRE COMPLETO': r.nombre || '',
        'CAMPAÑA': r.campania || '',
        'CENTRO DE COSTO': r.centro_costo || '',
        'USUARIO SSFF': r.usuario_ssff || '',
        'NOVEDADES': r.novedades || '',
        'ESTADO AGENTE': r.estado_agente || '',
        'CARGO RM': r.cargo_rm || '',
        'ESTADO RM': r.estado_rm || '',
        'REQUERIMIENTO': r.req_numero || '',
        'FECHA DE ENVIO': fechaCelda(r.req_fecha_envio),
        'OBSERVACIÓN': r.req_observacion || '',
        'ESTADO REQUERIMIENTO': r.req_estado || '',
        'ESTADO EN GESTOR': r.estado_contrato || ''
    }));
}

function filasRequerimientos(requerimientos) {
    return requerimientos.map((q) => ({
        'CEDULA': q.cedula || '',
        'NOMBRE COMPLETO': q.nombre || '',
        'REQUERIMIENTO': q.numero || '',
        'FECHA DE ENVIO': fechaCelda(q.fecha_envio),
        'OBSERVACIÓN': q.observacion || '',
        'ESTADO REQUERIMIENTO': q.estado_requerimiento || ''
    }));
}

function generarLibro(registros, requerimientos, XLSX = require('xlsx')) {
    const libro = XLSX.utils.book_new();
    const hoja = (filas, encabezados) => {
        const ws = XLSX.utils.json_to_sheet(filas, { header: encabezados });
        ws['!cols'] = encabezados.map((h) => ({ wch: ANCHOS[h] || Math.max(12, h.length + 2) }));
        ws['!autofilter'] = { ref: ws['!ref'] };
        return ws;
    };
    XLSX.utils.book_append_sheet(libro, hoja(filasExport(registros), ENCABEZADOS_EXPORT), 'Red Maestra');
    XLSX.utils.book_append_sheet(libro, hoja(filasRequerimientos(requerimientos), ENCABEZADOS_REQUERIMIENTOS), 'Requerimientos');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    CAMPOS_OPCION,
    TIPOS_PERSONAL,
    tipoPersonal,
    normalizarCedula,
    claveOpcion,
    valorOpcion,
    fechaISO,
    detectarColumnas,
    leerFilas,
    parsearArchivo,
    resolverFilas,
    documentoRM,
    filasExport,
    generarLibro
};
