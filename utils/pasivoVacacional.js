/**
 * Pasivo vacacional calculado (claude/modulo recursoshumanos.md §58), con las mismas fórmulas del Excel
 * "pasivo vacacional" de Gestión Humana:
 *   días trabajados = DAYS360(fecha de ingreso, fecha) + 1      (método US de Excel)
 *   días acumulados = días trabajados × 15 / 360                 (15 días hábiles por año)
 *   pasivo          = acumulados − disfrutados − compensados
 *   total           = pasivo − vacaciones programadas
 *   valor           = días × salario / 30
 *
 * Disfrutados y compensados = los del Excel en la fecha de corte (tabla vacaciones_saldo) + los días de las
 * novedades de Vacaciones que empiezan después del corte y hasta la fecha consultada, cada uno según la modalidad
 * de la novedad (disfrutadas / compensadas / las dos, migración 107, §59). Sin corte, todas las novedades de
 * Vacaciones desde el ingreso. Programadas = días (disfrutados + compensados) de las novedades de Vacaciones que
 * empiezan después de la fecha. Una novedad cuenta entera el día en que empieza.
 *
 * Puro: sin base de datos. `generarLibro` escribe el .xlsx con la librería que se le pase.
 */

const { fechasReales } = require('./excelFechas');
const { partes } = require('./vacacionesNovedad');

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DIAS_POR_ANIO = 15;

function fechaValida(texto) {
    if (!FECHA_ISO.test(texto || '')) return false;
    const d = new Date(`${texto}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

/** DATE de MySQL (Date a medianoche UTC o 'AAAA-MM-DD') → 'AAAA-MM-DD' o null. */
function iso(f) {
    if (!f) return null;
    const texto = f instanceof Date ? (Number.isNaN(f.getTime()) ? '' : f.toISOString().slice(0, 10)) : String(f).slice(0, 10);
    return FECHA_ISO.test(texto) ? texto : null;
}

/** Serial de fecha de Excel → 'AAAA-MM-DD'. */
function desdeSerialExcel(serial) {
    return new Date(Math.round((Number(serial) - 25569) * 86400000)).toISOString().slice(0, 10);
}

const ultimoDiaDelMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();

/**
 * DAYS360 de Excel con el método US (NASD), el que usa la fórmula sin tercer argumento:
 * - si el inicio es el último día del mes (31, o fin de febrero), pasa a 30;
 * - si el fin es 31 y el inicio quedó en 30, el fin pasa a 30 (si el inicio es menor, el 31 cuenta como el 1 del
 *   mes siguiente, que en la resta da lo mismo).
 */
function days360(inicio, fin) {
    let [a1, m1, d1] = inicio.split('-').map(Number);
    let [a2, m2, d2] = fin.split('-').map(Number);
    const finDeFebrero = (a, m, d) => m === 2 && d === ultimoDiaDelMes(a, m);
    if (finDeFebrero(a1, m1, d1) && finDeFebrero(a2, m2, d2)) d2 = 30;
    if (d1 === 31 || finDeFebrero(a1, m1, d1)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    return (a2 - a1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

const redondear = (n, dec = 2) => Math.round((Number(n) + Number.EPSILON) * 10 ** dec) / 10 ** dec;

/**
 * Pasivo de un empleado en `fecha` ('AAAA-MM-DD').
 * @param {{ fecha_ingreso, salario }} empleado
 * @param {{ fecha_corte, dias_disfrutados_corte, dias_compensados }|null} saldo
 * @param {{ fecha_inicial, total_dias, modalidad_vacaciones, dias_disfrutados, dias_compensados }[]} vacaciones
 *        novedades de Vacaciones del empleado
 */
function calcularEmpleado(empleado, saldo, vacaciones, fecha) {
    const ingreso = iso(empleado.fecha_ingreso);
    const trabajados = ingreso && ingreso <= fecha ? days360(ingreso, fecha) + 1 : 0;
    const acumulados = trabajados * DIAS_POR_ANIO / 360;

    const corte = saldo ? iso(saldo.fecha_corte) : null;
    // Solo las novedades del contrato vigente (desde su ingreso): las de un contrato anterior ya se liquidaron.
    const propias = (vacaciones || [])
        .map((v) => ({ dia: iso(v.fecha_inicial), ...partes(v) }))
        .filter((v) => v.dia && (!ingreso || v.dia >= ingreso));
    const sumar = (campo, cond) => propias.filter(cond).reduce((s, v) => s + v[campo], 0);

    // Días de un tipo (disfrutados o compensados) hasta la fecha: el Excel al corte + las novedades desde el corte.
    const hastaLaFecha = (campo, base) => {
        if (!corte) return sumar(campo, (v) => v.dia <= fecha);
        return fecha >= corte
            ? base + sumar(campo, (v) => v.dia > corte && v.dia <= fecha)
            // Antes del corte: se descuentan las que empezaron entre la fecha y el corte (ya venían en el Excel).
            : base - sumar(campo, (v) => v.dia > fecha && v.dia <= corte);
    };
    const disfrutados = hastaLaFecha('disfrutados', corte ? Number(saldo.dias_disfrutados_corte) || 0 : 0);
    const compensados = hastaLaFecha('compensados', corte ? Number(saldo.dias_compensados) || 0 : 0);
    const futuras = (v) => v.dia > fecha;
    const programadas = sumar('disfrutados', futuras) + sumar('compensados', futuras);
    const pasivo = acumulados - disfrutados - compensados;
    const total = pasivo - programadas;
    const salario = empleado.salario == null ? null : Number(empleado.salario);
    const valorDia = salario ? salario / 30 : null;

    return {
        con_corte: Boolean(corte),
        fecha_corte: corte,
        dias_trabajados: trabajados,
        dias_acumulados: redondear(acumulados),
        dias_disfrutados: redondear(disfrutados),
        dias_compensados: redondear(compensados),
        pasivo_dias: redondear(pasivo),
        dias_programados: redondear(programadas),
        total_dias: redondear(total),
        salario,
        valor_pasivo: valorDia == null ? null : Math.round(pasivo * valorDia),
        valor_total: valorDia == null ? null : Math.round(total * valorDia)
    };
}

/** Agrupa las novedades de Vacaciones por users_company_id. */
function agruparPorEmpleado(novedades) {
    const mapa = new Map();
    for (const n of novedades) {
        if (!mapa.has(n.users_company_id)) mapa.set(n.users_company_id, []);
        mapa.get(n.users_company_id).push(n);
    }
    return mapa;
}

/**
 * "Con observación" (§58.3): no tiene saldo inicial y ya trabajaba antes del mes del corte del Excel, así que pudo
 * tomar vacaciones que el sistema no conoce. Quien ingresó desde el primer día del mes del corte no la lleva: el
 * Excel se armó antes de que llegara y su cálculo ya está completo con las novedades del sistema.
 * El corte general es la fecha más reciente de los saldos cargados del Excel.
 */
function inicioMesCorte(empleados) {
    const cortes = empleados.filter((e) => e.saldo_id && (e.origen || 'excel') === 'excel').map((e) => iso(e.fecha_corte)).filter(Boolean);
    if (!cortes.length) return null;
    return `${cortes.sort().at(-1).slice(0, 7)}-01`;
}

/** Calcula todos los empleados y los totales. */
function calcular(empleados, novedades, fecha) {
    const porEmpleado = agruparPorEmpleado(novedades);
    const desdeMesCorte = inicioMesCorte(empleados);
    const filas = empleados.map((e) => {
        const saldo = e.saldo_id ? {
            fecha_corte: e.fecha_corte, dias_disfrutados_corte: e.dias_disfrutados_corte, dias_compensados: e.dias_compensados
        } : null;
        return {
            users_company_id: e.users_company_id,
            tipo_identificacion: e.tipo_identificacion,
            numero_identificacion: e.numero_identificacion,
            nombre: e.nombre,
            cargo: e.cargo,
            area: e.area,
            campania: e.campania,
            fecha_ingreso: iso(e.fecha_ingreso),
            ...calcularEmpleado(e, saldo, porEmpleado.get(e.users_company_id), fecha),
            // Saldo inicial tal como está guardado (lo que financiera edita, §58.2).
            origen_saldo: saldo ? (e.origen || 'excel') : null,
            saldo_disfrutados_corte: saldo ? redondear(Number(e.dias_disfrutados_corte) || 0) : null,
            saldo_compensados_corte: saldo ? redondear(Number(e.dias_compensados) || 0) : null,
            nota_saldo: saldo ? e.nota || null : null,
            ajustado_en: saldo && e.ajustado_en ? e.ajustado_en : null
        };
    }).map((f) => {
        const ingresoReciente = !f.con_corte && Boolean(desdeMesCorte && f.fecha_ingreso && f.fecha_ingreso >= desdeMesCorte);
        return { ...f, ingreso_reciente: ingresoReciente, con_observacion: !f.con_corte && !ingresoReciente };
    });
    const suma = (campo) => filas.reduce((s, f) => s + (Number(f[campo]) || 0), 0);
    return {
        filas,
        totales: {
            empleados: filas.length,
            con_corte: filas.filter((f) => f.con_corte).length,
            con_observacion: filas.filter((f) => f.con_observacion).length,
            ingreso_reciente: filas.filter((f) => f.ingreso_reciente).length,
            ajustados: filas.filter((f) => f.origen_saldo === 'financiera').length,
            pasivo_dias: redondear(suma('pasivo_dias')),
            dias_programados: redondear(suma('dias_programados')),
            total_dias: redondear(suma('total_dias')),
            valor_pasivo: Math.round(suma('valor_pasivo')),
            valor_total: Math.round(suma('valor_total')),
            sin_salario: filas.filter((f) => f.salario == null).length
        }
    };
}

// Campos en pesos: solo financiera los ve (RRHH ve el pasivo solo en días).
const CAMPOS_VALOR = ['salario', 'valor_pasivo', 'valor_total'];
const TOTALES_VALOR = ['valor_pasivo', 'valor_total', 'sin_salario'];

/** Quita el salario y los valores en pesos del resultado (para RRHH). */
function sinValores(resultado) {
    const quitar = (obj, campos) => Object.fromEntries(Object.entries(obj).filter(([k]) => !campos.includes(k)));
    return {
        ...resultado,
        filas: resultado.filas.map((f) => quitar(f, CAMPOS_VALOR)),
        totales: quitar(resultado.totales, TOTALES_VALOR)
    };
}

/** Solo financiera ve el pasivo en pesos, ajusta el saldo y descarga el Excel (§58.2). */
const veValores = (user) => user?.role === 'financiera';
const esFinanciera = veValores;

const MAX_DIAS = 9999;

/**
 * Valida el ajuste del saldo de un empleado que hace financiera (§58.2).
 * body: { fecha_corte 'AAAA-MM-DD', dias_disfrutados, dias_compensados, nota }
 * @returns {{ datos } | { error }}
 */
function validarAjuste(body = {}, hoy) {
    const fechaCorte = String(body.fecha_corte || '').trim();
    if (!fechaValida(fechaCorte)) return { error: 'La fecha de corte no es válida (AAAA-MM-DD)' };
    if (hoy && fechaCorte > hoy) return { error: 'La fecha de corte no puede ser futura' };
    const numero = (v, nombre) => {
        if (v === '' || v === null || v === undefined) return { error: `Indique los días ${nombre}` };
        const n = Number(String(v).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > MAX_DIAS) return { error: `Los días ${nombre} deben ser un número entre 0 y ${MAX_DIAS}` };
        return { n: redondear(n) };
    };
    const disfrutados = numero(body.dias_disfrutados, 'disfrutados');
    if (disfrutados.error) return disfrutados;
    const compensados = numero(body.dias_compensados, 'compensados');
    if (compensados.error) return compensados;
    const nota = String(body.nota || '').trim();
    if (nota.length < 5) return { error: 'Escriba el motivo del ajuste (mínimo 5 caracteres)' };
    if (nota.length > 500) return { error: 'El motivo no puede pasar de 500 caracteres' };
    return { datos: { fecha_corte: fechaCorte, dias_disfrutados: disfrutados.n, dias_compensados: compensados.n, nota } };
}

// ---- Lectura del Excel de corte (scripts/cargarPasivoVacacional.js) ----

const ENCABEZADOS_EXCEL = {
    tipo: 'TIPO DE IDENTIFICACIÓN', cedula: 'IDENTIFICACIÓN', nombre: 'PRIMER NOMBRE', ingreso: 'FECHA DE INGRESO',
    fecha: 'FECHA ACTUAL', trabajados: 'DIAS TRABAJADOS', acumulados: 'DIAS ACUMULADOS', disfrutados: 'DIAS DISFRUTADOS',
    compensados: 'DIAS COMPENSADOS', pasivo: 'PASIVO VACACIONAL', programadas: 'VACACIONES PROGRAMADAS', total: 'TOTAL'
};

const normalizarEncabezado = (h) => String(h || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/** Filas (header:1, raw) de la hoja del Excel → registros con fechas ISO. Error si falta una columna. */
function leerExcelCorte(filas) {
    const [encabezados, ...datos] = filas;
    const indice = {};
    const normalizados = (encabezados || []).map(normalizarEncabezado);
    for (const [clave, nombre] of Object.entries(ENCABEZADOS_EXCEL)) {
        const i = normalizados.indexOf(normalizarEncabezado(nombre));
        if (i === -1) return { error: `Falta la columna "${nombre}"` };
        indice[clave] = i;
    }
    const fecha = (v) => (typeof v === 'number' ? desdeSerialExcel(v) : iso(v));
    const numero = (v) => (v === '' || v == null ? 0 : Number(v));
    const registros = datos
        .filter((r) => r && String(r[indice.cedula] ?? '').trim())
        .map((r, i) => ({
            fila: i + 2,
            tipo: String(r[indice.tipo] ?? '').trim(),
            cedula: String(r[indice.cedula]).trim().replace(/\.0+$/, ''),
            nombre: String(r[indice.nombre] ?? '').trim(),
            ingreso: fecha(r[indice.ingreso]),
            fecha: fecha(r[indice.fecha]),
            trabajados: numero(r[indice.trabajados]),
            acumulados: numero(r[indice.acumulados]),
            disfrutados: numero(r[indice.disfrutados]),
            compensados: numero(r[indice.compensados]),
            pasivo: numero(r[indice.pasivo]),
            programadas: numero(r[indice.programadas]),
            total: numero(r[indice.total])
        }));
    return { registros };
}

// ---- Descarga en Excel ----

const COLUMNAS = [
    ['Tipo De Identificación', (f) => f.tipo_identificacion || ''],
    ['Identificación', (f) => f.numero_identificacion || ''],
    ['Nombre', (f) => f.nombre || ''],
    ['Cargo', (f) => f.cargo || ''],
    ['Área', (f) => f.area || ''],
    ['Campaña', (f) => f.campania || ''],
    ['Fecha De Ingreso', (f) => dmy(f.fecha_ingreso)],
    ['Fecha De Cálculo', (f, fecha) => dmy(fecha)],
    ['Días Trabajados', (f) => f.dias_trabajados],
    ['Días Acumulados', (f) => f.dias_acumulados],
    ['Días Disfrutados', (f) => f.dias_disfrutados],
    ['Días Compensados', (f) => f.dias_compensados],
    ['Pasivo Vacacional (días)', (f) => f.pasivo_dias],
    ['Vacaciones Programadas', (f) => f.dias_programados],
    ['Total (días)', (f) => f.total_dias],
    ['Salario', (f) => (f.salario == null ? '' : f.salario)],
    ['Valor Pasivo', (f) => (f.valor_pasivo == null ? '' : f.valor_pasivo)],
    ['Valor Total', (f) => (f.valor_total == null ? '' : f.valor_total)],
    ['Observación', (f) => (f.con_observacion ? 'Con observación: no venía en el Excel de corte; pasivo = acumulado menos novedades' : '')],
    ['Saldo Inicial', (f) => (!f.con_corte ? (f.ingreso_reciente ? 'Ingresó en el mes del corte o después: cálculo completo' : '')
        : f.origen_saldo === 'financiera' ? `Ajustado por financiera al ${dmy(f.fecha_corte)}${f.nota_saldo ? `: ${f.nota_saldo}` : ''}`
            : `Excel al ${dmy(f.fecha_corte)}`)]
];

function dmy(f) {
    const t = iso(f);
    if (!t) return '';
    const [a, m, d] = t.split('-');
    return `${d}/${m}/${a}`;
}

const COLUMNAS_VALOR = ['Salario', 'Valor Pasivo', 'Valor Total'];

/** `conValores`: incluye salario y valores en pesos (solo financiera). */
function generarLibro(resultado, fecha, generadoEn, XLSX = require('xlsx'), { conValores = true } = {}) {
    const columnas = conValores ? COLUMNAS : COLUMNAS.filter(([h]) => !COLUMNAS_VALOR.includes(h));
    const encabezados = columnas.map(([h]) => h);
    const filas = resultado.filas.map((f) => Object.fromEntries(columnas.map(([h, valor]) => [h, valor(f, fecha)])));
    const libro = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(filas, { header: encabezados });
    ws['!cols'] = encabezados.map((h) => ({ wch: h === 'Nombre' ? 36 : Math.max(12, h.length + 2) }));
    ws['!autofilter'] = { ref: ws['!ref'] };
    fechasReales(ws, XLSX); // fechas reales: el filtro de Excel las agrupa por año, mes y día (§60)
    XLSX.utils.book_append_sheet(libro, ws, 'Pasivo vacacional');
    const t = resultado.totales;
    const resumen = XLSX.utils.aoa_to_sheet([
        ['Fecha de cálculo', dmy(fecha)],
        ['Empleados', t.empleados],
        ['Con saldo inicial del Excel', t.con_corte],
        ['Ingresaron en el mes del corte o después (sin observación)', t.ingreso_reciente],
        ['Con observación (no venían en el Excel y ya trabajaban antes)', t.con_observacion],
        ['Pasivo (días)', t.pasivo_dias],
        ['Vacaciones programadas (días)', t.dias_programados],
        ['Total (días)', t.total_dias],
        ...(conValores ? [
            ['Valor pasivo', t.valor_pasivo],
            ['Valor total', t.valor_total],
            ['Empleados sin salario', t.sin_salario]
        ] : []),
        ['Fórmula', `Días trabajados = DAYS360(ingreso, fecha) + 1; acumulados = trabajados × 15 / 360${conValores ? '; valor = días × salario / 30' : ''}`],
        ['Generado', generadoEn || '']
    ]);
    resumen['!cols'] = [{ wch: 30 }, { wch: 90 }];
    XLSX.utils.book_append_sheet(libro, resumen, 'Resumen');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
    fechaValida, iso, desdeSerialExcel, days360, calcularEmpleado, calcular, sinValores, veValores, esFinanciera, validarAjuste,
    leerExcelCorte, generarLibro, redondear
};
