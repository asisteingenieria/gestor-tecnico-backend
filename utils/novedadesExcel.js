/**
 * Cargue masivo de novedades desde el Excel de Gestión Humana (claude/modulo recursoshumanos.md §50).
 * Lógica pura, sin base de datos: leer cada fila, decidir su tipo de novedad del catálogo y elegir
 * su documento entre los archivos de 6.NOVEDADES del expediente (migración 097).
 *
 * Columnas del Excel ("Novedades desde agosto al 041126.xlsx"): CEDULA, Novedad (abreviatura),
 * Origen de INC, Accidente de transito, Fecha Inicial/Final/Retorno, Total Dias, Fecha reporte.
 * Las fechas vienen como serial de Excel.
 *
 * Los documentos de la carpeta compartida se nombran por fecha: "INC/01-10-2025 02-10-2025.pdf"
 * (inicial y final) o "VACACIONES/08-08-2025.pdf". La llave es cédula + fecha inicial, y la
 * subcarpeta debe ser compatible con el tipo.
 */

// Abreviaturas del Excel → nombre en tipo_novedad (migración 069). INC se resuelve aparte.
const TIPO_POR_ABREVIATURA = {
    VACACIONES: 'Vacaciones',
    SUSPENSION: 'Suspensiones',
    LNR: 'Licencia No remunerada',
    LR: 'Licencia Remunerada',
    LM: 'Licencia de Maternidad',
    LPL: 'Licencia por luto',          // confirmado por el usuario 2026-11-06
    LP: 'Licencia de paternidad'       // confirmado por el usuario 2026-11-06
};

const INC = {
    COMUN_CORTA: 'Incapacidades origen comun 1- 2 días',
    COMUN_LARGA: 'Incapacidades origen comun 3 días o mas',
    TRANSITO_CORTA: 'Incapacidades accidente de transito 1- 2 días',
    TRANSITO_LARGA: 'Incapacidades accidente de transito 3 días o mas',
    TRABAJO: 'Incapacidad Accidente Trabajo'
};

// Subcarpetas de 6.NOVEDADES donde puede estar el documento de cada abreviatura. "" = suelto en
// 6.NOVEDADES. Hay carpetas mal escritas o genéricas en la compartida (INCAPACACIDADES, NC, NOVEDADES).
const NEUTRAS = ['', 'NOVEDADES', 'DOCUMENTO', 'DOCUMENTOS'];
const CARPETAS_COMPATIBLES = {
    INC: ['INC', 'INCAPACACIDADES', 'INCAPACIDADES', 'INCAPACIDAD', 'NC'],
    VACACIONES: ['VACACIONES', 'SOLICITUD DE VACACIONES'],
    SUSPENSION: ['SUSPENSION', 'SUSPENSIONES'],
    LNR: ['LNR'],
    LR: ['LR', 'PERMISOS'],
    LM: ['LM', 'LICENCIA DE MATERNIDAD'],
    // Luto: en la compartida aparece como LPL, LDL, LCDL y, a veces, dentro de LR.
    LPL: ['LPL', 'LDL', 'LCDL', 'LR'],
    LP: ['LP', 'LICENCIA DE PATERNIDAD']
};

function texto(v) {
    if (v === null || v === undefined) return '';
    return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function vacio(v) {
    const t = texto(v);
    return t === '' || t === 'N/A' || t === 'NA' || t === '0';
}

/** Fecha ISO (aaaa-mm-dd) desde un serial de Excel, un Date o un texto dd/mm/aaaa o aaaa-mm-dd. */
function aFecha(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
        if (v < 1) return null;
        return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (/^\d+(\.\d+)?$/.test(s)) return aFecha(Number(s));
    return null;
}

function diasEntre(inicial, final) {
    return Math.round((Date.parse(final) - Date.parse(inicial)) / 86400000) + 1;
}

/** Nombre del tipo_novedad para una abreviatura del Excel, o null si no se reconoce. */
function tipoNovedadDe(abreviatura, { origen, accidenteTransito, dias }) {
    const abr = texto(abreviatura);
    if (abr !== 'INC') return TIPO_POR_ABREVIATURA[abr] || null;
    const o = texto(origen);
    if (o.includes('TRABAJO')) return INC.TRABAJO;
    const corta = Number(dias) > 0 && Number(dias) <= 2;
    if (o.includes('TRANSITO') || accidenteTransito) return corta ? INC.TRANSITO_CORTA : INC.TRANSITO_LARGA;
    return corta ? INC.COMUN_CORTA : INC.COMUN_LARGA;
}

/**
 * Normaliza una fila del Excel. Devuelve { cedula, abreviatura, tipoNombre, fechaInicial, ...,
 * errores: [] }. Una fila con errores no se carga.
 */
function leerFila(raw, numeroFila) {
    const errores = [];
    const cedula = String(raw.CEDULA ?? '').replace(/\D/g, '');
    if (!cedula) errores.push('sin cédula');

    const abreviatura = texto(raw.Novedad);
    const fechaInicial = aFecha(raw['Fecha Inicial']);
    const fechaFinal = aFecha(raw['Fecha Final']);
    const fechaRetorno = aFecha(raw['Fecha Retorno']);
    const fechaReporte = aFecha(raw['Fecha reportefecha reporte'] ?? raw['Fecha reporte'] ?? raw['Fecha Reporte']);
    if (!fechaInicial) errores.push('sin fecha inicial');
    if (fechaInicial && fechaFinal && fechaFinal < fechaInicial) errores.push('la fecha final es anterior a la inicial');

    let totalDias = Number(raw['Total Dias']);
    if (!Number.isFinite(totalDias) || totalDias <= 0) {
        totalDias = fechaInicial && fechaFinal && fechaFinal >= fechaInicial ? diasEntre(fechaInicial, fechaFinal) : null;
    }

    const origen = vacio(raw['Origen de INC']) ? null : texto(raw['Origen de INC']);
    const accidenteTransito = texto(raw['Accidente de transito']) === 'SI' || (origen || '').includes('TRANSITO');
    const tipoNombre = abreviatura ? tipoNovedadDe(abreviatura, { origen, accidenteTransito, dias: totalDias }) : null;
    if (!abreviatura) errores.push('sin tipo de novedad');
    else if (!tipoNombre) errores.push(`tipo de novedad "${abreviatura}" no reconocido`);

    return {
        fila: numeroFila, cedula, abreviatura, tipoNombre,
        fechaInicial, fechaFinal, fechaRetorno, fechaReporte, totalDias,
        origen, accidenteTransito, errores
    };
}

/** Fechas ISO que trae el nombre de un archivo ("01-10-2025 02-10-2025.pdf"), en orden. */
function fechasDeNombre(nombre) {
    return [...String(nombre).matchAll(/(\d{1,2})[-._](\d{1,2})[-._](\d{4})/g)]
        .map(m => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
}

/** Primera parte de la subcarpeta, normalizada ("INC", "" si el archivo está suelto). */
function carpetaDe(subcarpeta) {
    return texto(String(subcarpeta || '').split('/')[0]);
}

/**
 * Documentos del expediente para una novedad: archivos de 6.NOVEDADES del mismo empleado cuya
 * primera fecha del nombre es la fecha inicial, en una subcarpeta del tipo (o neutra). Si hay en
 * la carpeta del tipo, se prefieren a los neutros. `usados` (Set de ids) evita dar el mismo archivo
 * a dos novedades.
 *   archivos: [{ id, subcarpeta, nombre }]
 * Devuelve { elegidos: [archivo], descartados: [archivo de la misma fecha en otra carpeta] }.
 */
function elegirDocumentos(novedad, archivos, usados = new Set()) {
    const compatibles = CARPETAS_COMPATIBLES[novedad.abreviatura] || [];
    const mismaFecha = archivos.filter(a => !usados.has(a.id) && fechasDeNombre(a.nombre)[0] === novedad.fechaInicial);
    const delTipo = mismaFecha.filter(a => compatibles.includes(carpetaDe(a.subcarpeta)));
    const neutros = mismaFecha.filter(a => NEUTRAS.includes(carpetaDe(a.subcarpeta)));
    const elegidos = delTipo.length ? delTipo : neutros;
    return { elegidos, descartados: mismaFecha.filter(a => !elegidos.includes(a)) };
}

module.exports = {
    TIPO_POR_ABREVIATURA, INC, CARPETAS_COMPATIBLES,
    aFecha, tipoNovedadDe, leerFila, fechasDeNombre, elegirDocumentos
};
