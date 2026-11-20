/**
 * Filtros y descarga en Excel del Consolidado de novedades de RRHH (claude/modulo recursoshumanos.md §57), para
 * RRHH y financiera. Los mismos filtros de la pantalla (NovedadesRRHH.jsx) se aplican aquí, así que el archivo
 * trae exactamente lo que se ve: búsqueda, tipo de novedad, campaña, estado de los soportes y un rango de fechas
 * sobre la fecha de registro de la novedad (por defecto), la inicial o la final.
 *
 * Puro: recibe la query de la petición y las filas de NovedadRrhh.getAll(); `generarLibro` escribe el .xlsx con
 * la librería que se le pase.
 */

const { fechasReales } = require('./excelFechas');
const { fechaDMY, fechaHoraBogota } = require('./reporteEmpleados');
const { MODALIDADES, esVacaciones, partes } = require('./vacacionesNovedad');

const CAMPOS_FECHA = ['registro', 'inicial', 'final'];
const ETIQUETA_CAMPO_FECHA = { registro: 'Fecha de registro', inicial: 'Fecha inicial', final: 'Fecha final' };

// Estado de los soportes de una novedad. El documento del expediente (cargue masivo, migración 098) trae los
// soportes juntos, así que cuenta como soportada aunque no tenga cada soporte por separado.
const SOPORTES = ['expediente', 'completos', 'pendientes', 'no_requiere'];
const ETIQUETA_SOPORTES = {
    expediente: 'Documento del expediente',
    completos: 'Soportes completos',
    pendientes: 'Soportes pendientes',
    no_requiere: 'No requiere soportes'
};

// Separador de las listas de la query (nombres de tipo y de campaña pueden llevar comas).
const SEPARADOR = '|';

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(texto) {
    if (!FECHA_ISO.test(texto)) return false;
    const d = new Date(`${texto}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

function estadoSoportes(n) {
    if (Number(n.documentos_expediente) > 0) return 'expediente';
    const requeridos = Number(n.soportes_requeridos) || 0;
    if (requeridos === 0) return 'no_requiere';
    return (Number(n.soportes_cargados) || 0) >= requeridos ? 'completos' : 'pendientes';
}

/** DATE de MySQL (Date a medianoche UTC o 'AAAA-MM-DD') → 'AAAA-MM-DD'. */
function diaDate(f) {
    if (!f) return null;
    const iso = f instanceof Date
        ? (Number.isNaN(f.getTime()) ? '' : f.toISOString().slice(0, 10))
        : String(f).slice(0, 10);
    return FECHA_ISO.test(iso) ? iso : null;
}

/** DATETIME en UTC → día de Bogotá 'AAAA-MM-DD' (UTC-5, sin horario de verano). */
function diaBogota(f) {
    if (!f) return null;
    const d = f instanceof Date ? f : new Date(String(f).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return null;
    return new Date(d.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Día de la novedad sobre el que se aplica el rango. */
function diaDelRango(n, campoFecha) {
    if (campoFecha === 'inicial') return diaDate(n.fecha_inicial);
    if (campoFecha === 'final') return diaDate(n.fecha_final);
    return diaBogota(n.created_at);
}

const lista = (v) => String(v || '').split(SEPARADOR).map((x) => x.trim()).filter(Boolean);

/**
 * Valida los filtros de la query: `q`, `tipos`, `campanias` (nombres separados por "|"), `soportes`
 * (separados por coma), `campoFecha` (registro | inicial | final, por defecto registro) y `desde`/`hasta`
 * (AAAA-MM-DD, cualquiera sola).
 */
function parsearFiltros(query = {}) {
    const soportes = String(query.soportes || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const invalidos = soportes.filter((s) => !SOPORTES.includes(s));
    if (invalidos.length) return { error: `Estado de soportes no válido: ${invalidos.join(', ')}` };

    const desde = query.desde ? String(query.desde) : null;
    const hasta = query.hasta ? String(query.hasta) : null;
    if (desde && !fechaValida(desde)) return { error: 'La fecha "desde" no es válida (AAAA-MM-DD)' };
    if (hasta && !fechaValida(hasta)) return { error: 'La fecha "hasta" no es válida (AAAA-MM-DD)' };
    if (desde && hasta && desde > hasta) return { error: 'La fecha "desde" no puede ser posterior a "hasta"' };

    let campoFecha = query.campoFecha ? String(query.campoFecha).toLowerCase() : 'registro';
    if (!CAMPOS_FECHA.includes(campoFecha)) return { error: `Tipo de fecha no válido: ${campoFecha}` };
    if (!desde && !hasta) campoFecha = null;

    return {
        filtros: {
            q: String(query.q || '').trim(),
            tipos: [...new Set(lista(query.tipos))],
            campanias: [...new Set(lista(query.campanias))],
            soportes: [...new Set(soportes)],
            campoFecha, desde, hasta
        }
    };
}

/** Aplica los filtros a las filas de NovedadRrhh.getAll(), igual que la pantalla. */
function filtrar(filas, { q = '', tipos = [], campanias = [], soportes = [], campoFecha = null, desde = null, hasta = null } = {}) {
    const busqueda = q.toLowerCase();
    return filas.filter((n) => {
        if (busqueda) {
            const coincide = (n.empleado_nombre || '').toLowerCase().includes(busqueda)
                || String(n.empleado_identificacion || '').includes(q)
                || (n.tipo_novedad_nombre || '').toLowerCase().includes(busqueda)
                || (n.campania_nombre || '').toLowerCase().includes(busqueda);
            if (!coincide) return false;
        }
        if (tipos.length && !tipos.includes(n.tipo_novedad_nombre)) return false;
        if (campanias.length && !campanias.includes(n.campania_nombre || 'Sin campaña')) return false;
        if (soportes.length && !soportes.includes(estadoSoportes(n))) return false;
        if (campoFecha && (desde || hasta)) {
            const dia = diaDelRango(n, campoFecha);
            if (!dia || (desde && dia < desde) || (hasta && dia > hasta)) return false;
        }
        return true;
    });
}

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));
const siNo = (v) => (Number(v) ? 'SI' : 'NO');

const COLUMNAS = [
    ['Fecha De Registro', (n) => fechaHoraBogota(n.created_at)],
    ['Número De Identificación', (n) => texto(n.empleado_identificacion)],
    ['Empleado', (n) => texto(n.empleado_nombre)],
    ['Cargo', (n) => texto(n.cargo_nombre)],
    ['Campaña', (n) => texto(n.campania_nombre)],
    ['Centro De Costo', (n) => texto(n.centro_costo_nombre)],
    ['Tipo De Novedad', (n) => texto(n.tipo_novedad_nombre)],
    ['Categoría', (n) => texto(n.tipo_novedad_categoria)],
    ['Fecha Inicial', (n) => fechaDMY(n.fecha_inicial)],
    ['Fecha Final', (n) => fechaDMY(n.fecha_final)],
    ['Fecha De Retorno', (n) => fechaDMY(n.fecha_retorno)],
    ['Total Días', (n) => numero(n.total_dias)],
    ['Modalidad Vacaciones', (n) => (esVacaciones(n.tipo_novedad_nombre) ? MODALIDADES[n.modalidad_vacaciones || 'disfrutadas'] : '')],
    ['Días Disfrutados', (n) => (esVacaciones(n.tipo_novedad_nombre) ? numero(partes(n).disfrutados) : '')],
    ['Días Compensados', (n) => (esVacaciones(n.tipo_novedad_nombre) ? numero(partes(n).compensados) : '')],
    ['Origen Incapacidad', (n) => texto(n.origen_incapacidad)],
    ['Accidente De Tránsito', (n) => siNo(n.accidente_transito)],
    ['Diagnóstico', (n) => texto(n.resumen_diagnostico)],
    ['Fecha De Reporte', (n) => fechaDMY(n.fecha_reporte)],
    ['Fecha De Recibido', (n) => fechaDMY(n.fecha_recibido)],
    ['Responsable', (n) => texto(n.responsable_nombre)],
    ['Soportes', (n) => ETIQUETA_SOPORTES[estadoSoportes(n)]],
    ['Soportes Cargados', (n) => numero(n.soportes_cargados)],
    ['Soportes Requeridos', (n) => numero(n.soportes_requeridos)],
    ['Documentos Del Expediente', (n) => numero(n.documentos_expediente)],
    ['Observaciones', (n) => texto(n.observaciones)],
    ['Última Actualización', (n) => fechaHoraBogota(n.updated_at)]
];

const ENCABEZADOS = COLUMNAS.map(([h]) => h);

function armarFilas(filas) {
    return filas.map((n) => Object.fromEntries(COLUMNAS.map(([h, valor]) => [h, valor(n)])));
}

/** Filtros en palabras, para la hoja "Filtros". */
function describirFiltros({ q, tipos, campanias, soportes, campoFecha, desde, hasta }) {
    let rango = 'Sin rango de fechas';
    if (campoFecha) {
        const d = desde ? fechaDMY(desde) : null;
        const h = hasta ? fechaDMY(hasta) : null;
        rango = `${ETIQUETA_CAMPO_FECHA[campoFecha]} ${d && h ? `del ${d} al ${h}` : d ? `desde el ${d}` : `hasta el ${h}`}`;
    }
    return [
        ['Búsqueda', q || 'Sin búsqueda'],
        ['Tipo de novedad', tipos.length ? tipos.join(', ') : 'Todos'],
        ['Campaña', campanias.length ? campanias.join(', ') : 'Todas'],
        ['Soportes', soportes.length ? soportes.map((s) => ETIQUETA_SOPORTES[s]).join(', ') : 'Todos'],
        ['Rango', rango]
    ];
}

/** novedades_<desde>_a_<hasta>.xlsx, o con la fecha de hoy si no hay rango. */
function nombreArchivo({ campoFecha, desde, hasta }, hoy) {
    if (!campoFecha) return `novedades_${hoy}.xlsx`;
    return `novedades_${campoFecha}_${desde || 'inicio'}_a_${hasta || hoy}.xlsx`;
}

const ANCHOS = { 'Empleado': 36, 'Responsable': 32, 'Tipo De Novedad': 32, 'Diagnóstico': 40, 'Observaciones': 50, 'Fecha De Registro': 18, 'Última Actualización': 18 };

function generarLibro(filasExcel, filtros, generadoEn, XLSX = require('xlsx')) {
    const libro = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filasExcel, { header: ENCABEZADOS });
    ws['!cols'] = ENCABEZADOS.map((h) => ({ wch: ANCHOS[h] || Math.max(12, h.length + 2) }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    fechasReales(ws, XLSX); // fechas reales: el filtro de Excel las agrupa por año, mes y día (§60)
    XLSX.utils.book_append_sheet(libro, ws, 'Novedades');

    const resumen = XLSX.utils.aoa_to_sheet([
        ...describirFiltros(filtros),
        ['Novedades', filasExcel.length],
        ['Generado', generadoEn || '']
    ]);
    resumen['!cols'] = [{ wch: 16 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(libro, resumen, 'Filtros');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    CAMPOS_FECHA, SOPORTES, SEPARADOR, ENCABEZADOS,
    estadoSoportes, diaDelRango, parsearFiltros, filtrar, armarFilas, describirFiltros, nombreArchivo, generarLibro
};
