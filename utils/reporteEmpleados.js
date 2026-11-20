/**
 * Descarga en Excel de los empleados con toda su información (claude/modulo recursoshumanos.md §56), para
 * RRHH y financiera. Se filtra por estado del contrato más reciente y por un rango de fechas sobre la fecha
 * de ingreso, de retiro o de registro de la ficha; los filtros se combinan (p. ej. retirados del 10 al 20 de
 * noviembre = estado retirado + fecha de retiro entre esas dos fechas).
 *
 * Las columnas de la hoja "Empleados" llevan primero los mismos encabezados de la plantilla de cargue masivo
 * (ImportEmpleadosModal.jsx::COLUMNAS_PLANTILLA), con fechas dd/mm/aaaa, así que el archivo se puede volver a
 * subir por "Cargar Excel"; después van el estado, el retiro y el resto de datos de la ficha.
 *
 * Puro: recibe la query de la petición y las filas de UserCompany.getParaExportar(); `generarLibro` escribe
 * el .xlsx con la librería que se le pase.
 */
const { fechasReales } = require('./excelFechas');

const ESTADOS = ['activo', 'periodo_prueba', 'suspendido', 'inactivo', 'retirado'];
const ETIQUETA_ESTADO = {
    activo: 'Activo', periodo_prueba: 'Periodo de prueba', suspendido: 'Suspendido',
    inactivo: 'Inactivo', retirado: 'Retirado'
};
const CAMPOS_FECHA = ['ingreso', 'retiro', 'registro'];
const ETIQUETA_CAMPO_FECHA = { ingreso: 'Fecha de ingreso', retiro: 'Fecha de retiro', registro: 'Fecha de registro' };
const ESTADOS_DE_RETIRO = ['retirado', 'inactivo'];

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(texto) {
    if (!FECHA_ISO.test(texto)) return false;
    const d = new Date(`${texto}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/**
 * Valida los filtros de la query (`estados`, `campoFecha`, `desde`, `hasta`).
 * - `estados`: lista separada por comas; vacía = todos.
 * - `campoFecha`: ingreso | retiro | registro. Si hay fechas y no viene, se usa la de retiro cuando solo se
 *   piden retirados/inactivos y la de ingreso en cualquier otro caso.
 * - `desde`/`hasta`: AAAA-MM-DD (días de Bogotá), cualquiera de las dos puede ir sola.
 * @returns {{ filtros: { estados: string[], campoFecha: string|null, desde: string|null, hasta: string|null } } | { error: string }}
 */
function parsearFiltros(query = {}) {
    const estados = String(query.estados || '')
        .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const invalidos = estados.filter((e) => !ESTADOS.includes(e));
    if (invalidos.length) return { error: `Estado no válido: ${invalidos.join(', ')}` };

    const desde = query.desde ? String(query.desde) : null;
    const hasta = query.hasta ? String(query.hasta) : null;
    if (desde && !fechaValida(desde)) return { error: 'La fecha "desde" no es válida (AAAA-MM-DD)' };
    if (hasta && !fechaValida(hasta)) return { error: 'La fecha "hasta" no es válida (AAAA-MM-DD)' };
    if (desde && hasta && desde > hasta) return { error: 'La fecha "desde" no puede ser posterior a "hasta"' };

    let campoFecha = query.campoFecha ? String(query.campoFecha).toLowerCase() : null;
    if (campoFecha && !CAMPOS_FECHA.includes(campoFecha)) return { error: `Tipo de fecha no válido: ${campoFecha}` };
    if (!desde && !hasta) campoFecha = null;
    else if (!campoFecha) {
        const soloRetiros = estados.length > 0 && estados.every((e) => ESTADOS_DE_RETIRO.includes(e));
        campoFecha = soloRetiros ? 'retiro' : 'ingreso';
    }

    return { filtros: { estados: [...new Set(estados)], campoFecha, desde, hasta } };
}

/** DATE de MySQL (Date a medianoche UTC o 'AAAA-MM-DD') → 'dd/mm/aaaa'. */
function fechaDMY(f) {
    if (!f) return '';
    const iso = f instanceof Date
        ? (Number.isNaN(f.getTime()) ? '' : f.toISOString().slice(0, 10))
        : String(f).slice(0, 10);
    if (!FECHA_ISO.test(iso)) return '';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
}

/** DATETIME en UTC → fecha y hora de Bogotá 'dd/mm/aaaa hh:mm'. */
function fechaHoraBogota(f) {
    if (!f) return '';
    const d = f instanceof Date ? f : new Date(String(f).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return '';
    const b = new Date(d.getTime() - 5 * 60 * 60 * 1000);
    const dos = (n) => String(n).padStart(2, '0');
    return `${dos(b.getUTCDate())}/${dos(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} ${dos(b.getUTCHours())}:${dos(b.getUTCMinutes())}`;
}

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const numero = (v) => (v === null || v === undefined || v === '' ? '' : Number(v));
const siNo = (v) => (v === null || v === undefined ? '' : (Number(v) ? 'SI' : 'NO'));
const nombreCompleto = (...partes) => partes.filter(Boolean).join(' ').trim();

// [encabezado, (fila) => valor]. El primer bloque calca la plantilla de cargue (mismo nombre de columna).
const COLUMNAS = [
    ['Cliente', (f) => texto(f.cliente)],
    ['Tipo De Identificación', (f) => texto(f.tipo_identificacion_codigo || f.tipo_identificacion)],
    ['Número De Identificación', (f) => texto(f.numero_identificacion)],
    ['Tipo De Identificación Secundaria', (f) => texto(f.tipo_identificacion_secundaria_codigo || f.tipo_identificacion_secundaria)],
    ['Número De Identificación Secundaria', (f) => texto(f.numero_identificacion_secundaria)],
    ['Fecha De Expedición', (f) => fechaDMY(f.fecha_expedicion)],
    ['Lugar Expedicion Identificación', (f) => texto(f.ciudad_expedicion)],
    ['Primer Nombre', (f) => texto(f.primer_nombre)],
    ['Segundo Nombre', (f) => texto(f.segundo_nombre)],
    ['Primer Apellido', (f) => texto(f.primer_apellido)],
    ['Segundo Apellido', (f) => texto(f.segundo_apellido)],
    ['Genero', (f) => texto(f.genero)],
    ['Rh', (f) => texto(f.grupo_sanguineo)],
    ['Tipo De Contrato', (f) => texto(f.tipo_contrato)],
    ['Ciudad Donde Labora', (f) => texto(f.ciudad_trabajo)],
    ['Oleada', (f) => texto(f.oleada)],
    ['Fecha De Ingreso', (f) => fechaDMY(f.fecha_ingreso)],
    ['Area', (f) => texto(f.area)],
    ['Campaña', (f) => texto(f.campania)],
    ['Nombre_Centro_Costo', (f) => texto(f.centro_costo)],
    ['Codigo_Centro_Costo', (f) => texto(f.centro_costo_codigo)],
    ['Cargo', (f) => texto(f.cargo)],
    ['Salario', (f) => numero(f.salario)],
    ['Bono No Prestacional', (f) => numero(f.bono_no_prestacional)],
    ['Director de Área', (f) => texto(f.director_area)],
    ['Jefe de Área', (f) => texto(f.jefe_area)],
    ['Jefe Inmediato', (f) => texto(f.jefe_inmediato)],
    ['Fecha De Nacimiento', (f) => fechaDMY(f.fecha_nacimiento)],
    ['Ciudad De Nacimiento', (f) => texto(f.ciudad_nacimiento)],
    ['Dirección', (f) => texto(f.direccion)],
    ['Barrio', (f) => texto(f.barrio)],
    ['Telefono', (f) => texto(f.telefono)],
    ['E-Mail', (f) => texto(f.email)],
    ['Estado Civil', (f) => texto(f.estado_civil)],
    ['Numero de hijos', (f) => numero(f.numero_hijos)],
    ['Contacto De Emergencia', (f) => texto(f.contacto_nombre)],
    ['Parentesco', (f) => texto(f.contacto_parentesco)],
    ['Telefono Contacto de Emergencia', (f) => texto(f.contacto_telefono)],
    ['Tipo De Cuenta', (f) => texto(f.tipo_cuenta)],
    ['Numero De Cuenta', (f) => texto(f.numero_cuenta)],
    ['Banco', (f) => texto(f.banco)],
    ['Fecha Fin Periodo De Prueba', (f) => fechaDMY(f.fecha_fin_periodo_prueba)],
    ['Fecha Fin Contrato', (f) => fechaDMY(f.fecha_fin_contrato)],
    ['Arl', (f) => texto(f.arl)],
    ['Eps', (f) => texto(f.eps)],
    ['Afp', (f) => texto(f.afp)],
    ['Fondo Cesantias', (f) => texto(f.cesantias)],
    ['Caja De Compensación', (f) => texto(f.caja)],
    ['Modalidad', (f) => texto(f.modalidad)],
    ['Serial Diadema', (f) => texto(f.diadema)],
    ['Locker', (f) => texto(f.locker)],
    ['RUT', (f) => texto(f.rut)],
    ['Carnet', (f) => (Number(f.carnet_entregado) ? 'ENTREGADO' : '')],
    ['Observaciones', (f) => texto(f.observaciones)],
    ['Analista Encargado', (f) => texto(f.analista_encargado)],
    ['Dotación', (f) => siNo(f.aplica_dotacion)],
    ['Talla Camisa', (f) => texto(f.talla_camisa)],
    ['Talla Pantalon', (f) => texto(f.talla_pantalon)],
    ['Talla Calzado', (f) => texto(f.talla_calzado)],
    // Datos que la plantilla no trae.
    ['Estado', (f) => ETIQUETA_ESTADO[f.estado_contrato] || texto(f.estado_contrato) || 'Sin contrato'],
    ['Nombre Completo', (f) => nombreCompleto(f.primer_nombre, f.segundo_nombre, f.primer_apellido, f.segundo_apellido)],
    ['Fecha De Registro', (f) => fechaHoraBogota(f.registrado_en)],
    ['Fecha De Retiro', (f) => fechaDMY(f.fecha_retiro)],
    ['Tipo De Retiro', (f) => texto(f.tipo_retiro)],
    ['Motivo De Retiro', (f) => texto(f.motivo_retiro)],
    ['Justificación Retiro', (f) => texto(f.justificacion_retiro)],
    ['Fecha Última Conexión', (f) => fechaDMY(f.fecha_ultima_conexion)],
    ['Equipo Entregado', (f) => siNo(f.equipo_entregado)],
    ['Retiro Registrado En', (f) => fechaHoraBogota(f.retiro_registrado_en)],
    ['Gestor De Asistencia', (f) => texto(f.gestor_asistencia)],
    ['Usuario SSFF', (f) => texto(f.usuario_ssff)],
    ['Cargo SSFF', (f) => texto(f.cargo_ssff)],
    ['Piso', (f) => texto(f.piso)],
    ['Empresa', (f) => texto(f.empresa)],
    ['Periodo De Pago', (f) => texto(f.periodo_pago)],
    ['Tipo Cotizante', (f) => texto(f.tipo_cotizante)],
    ['Bono Cafetería', (f) => numero(f.bono_cafeteria)],
    ['Tarifa ARL (%)', (f) => numero(f.tarifa_arl)],
    ['Fecha Afiliación EPS', (f) => fechaDMY(f.eps_fecha_afiliacion)],
    ['Fecha Afiliación ARL', (f) => fechaDMY(f.arl_fecha_afiliacion)],
    ['Fecha Afiliación AFP', (f) => fechaDMY(f.afp_fecha_afiliacion)],
    ['Fecha Afiliación Cesantías', (f) => fechaDMY(f.cesantias_fecha_afiliacion)],
    ['Fecha Afiliación Caja', (f) => fechaDMY(f.caja_fecha_afiliacion)],
    ['Ciudad De Residencia', (f) => texto(f.ciudad_residencia)],
    ['Zona', (f) => texto(f.zona)],
    ['Tipo De Vivienda', (f) => texto(f.tipo_vivienda)],
    ['Declarante De Renta', (f) => siNo(f.declarante_renta)],
    ['Libreta Militar', (f) => texto(f.libreta_militar_numero)]
];

const ENCABEZADOS = COLUMNAS.map(([h]) => h);

/** Filas de UserCompany.getParaExportar() → objetos con los encabezados del Excel como claves. */
function armarFilas(filas) {
    return filas.map((f) => Object.fromEntries(COLUMNAS.map(([h, valor]) => [h, valor(f)])));
}

/** Filtros en palabras, para la hoja "Filtros" y el nombre del archivo. */
function describirFiltros({ estados, campoFecha, desde, hasta }) {
    const estado = estados.length ? estados.map((e) => ETIQUETA_ESTADO[e]).join(', ') : 'Todos';
    let rango = 'Sin rango de fechas';
    if (campoFecha) {
        const d = desde ? fechaDMY(desde) : null;
        const h = hasta ? fechaDMY(hasta) : null;
        rango = `${ETIQUETA_CAMPO_FECHA[campoFecha]} ${d && h ? `del ${d} al ${h}` : d ? `desde el ${d}` : `hasta el ${h}`}`;
    }
    return { estado, rango };
}

/** Nombre del archivo: empleados_<estados>_<desde>_a_<hasta>.xlsx (o con la fecha de hoy si no hay rango). */
function nombreArchivo({ estados, desde, hasta }, hoy) {
    const parteEstado = estados.length ? estados.join('-') : 'todos';
    const parteFecha = desde || hasta ? `${desde || 'inicio'}_a_${hasta || hoy}` : hoy;
    return `empleados_${parteEstado}_${parteFecha}.xlsx`;
}

const ANCHOS = { 'Nombre Completo': 36, 'Director de Área': 32, 'Jefe de Área': 32, 'Jefe Inmediato': 32, 'Analista Encargado': 32, 'Gestor De Asistencia': 32, 'Observaciones': 40, 'Justificación Retiro': 40, 'Dirección': 32 };

/** Escribe el libro: hoja "Empleados" y hoja "Filtros" con lo que se aplicó. Devuelve el Buffer. */
function generarLibro(filasExcel, filtros, generadoEn, XLSX = require('xlsx')) {
    const libro = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filasExcel, { header: ENCABEZADOS });
    ws['!cols'] = ENCABEZADOS.map((h) => ({ wch: ANCHOS[h] || Math.max(12, h.length + 2) }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    fechasReales(ws, XLSX); // fechas reales: el filtro de Excel las agrupa por año, mes y día (§60)
    XLSX.utils.book_append_sheet(libro, ws, 'Empleados');

    const { estado, rango } = describirFiltros(filtros);
    const resumen = XLSX.utils.aoa_to_sheet([
        ['Estado', estado],
        ['Rango', rango],
        ['Empleados', filasExcel.length],
        ['Generado', generadoEn || '']
    ]);
    resumen['!cols'] = [{ wch: 14 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(libro, resumen, 'Filtros');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    ESTADOS, CAMPOS_FECHA, ENCABEZADOS,
    parsearFiltros, armarFilas, describirFiltros, nombreArchivo, generarLibro, fechaDMY, fechaHoraBogota
};
