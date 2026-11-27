/**
 * Fechas reales en los Excel descargables (claude/modulo recursoshumanos.md §60). Los reportes arman las fechas
 * como texto 'dd/mm/aaaa'; así Excel no las reconoce y su filtro muestra una lista plana de textos. Convertidas a
 * fecha (número de serie con formato), el filtro las agrupa por año → mes → día y ordena "de más antiguo a más
 * reciente", como pidió Gestión Humana (imagen AjusteExcel).
 *
 * Se aplica a las columnas cuyo encabezado empieza por "Fecha" (sin importar mayúsculas). Acepta en cada celda
 * 'dd/mm/aaaa', 'dd/mm/aaaa hh:mm' o 'aaaa-mm-dd'; lo vacío o lo que no sea fecha se deja tal cual.
 * Lógica pura, sin E/S.
 */

const FORMATO_DIA = 'dd/mm/yyyy';
const FORMATO_DIA_HORA = 'dd/mm/yyyy hh:mm';
const DIA_CERO = Date.UTC(1899, 11, 30); // día 0 del calendario de Excel (sistema 1900)
const MS_DIA = 86400000;

const DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Texto de fecha → { serial, conHora } o null si no es una fecha válida. */
function aSerial(texto) {
    const t = String(texto ?? '').trim();
    let a, m, d, h = 0, mi = 0, conHora = false;
    const dmy = DMY.exec(t);
    const iso = !dmy && ISO.exec(t);
    if (dmy) {
        [, d, m, a] = dmy.map(Number);
        if (dmy[4] !== undefined) { h = Number(dmy[4]); mi = Number(dmy[5]); conHora = true; }
    } else if (iso) {
        [, a, m, d] = iso.map(Number);
    } else {
        return null;
    }
    const ms = Date.UTC(a, m - 1, d);
    const fecha = new Date(ms);
    if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) return null;
    if (h > 23 || mi > 59) return null;
    return { serial: (ms - DIA_CERO) / MS_DIA + (h * 60 + mi) / 1440, conHora };
}

/** Convierte a fecha de Excel las celdas de las columnas "Fecha…" de la hoja. Devuelve la misma hoja. */
function fechasReales(ws, XLSX) {
    if (!ws || !ws['!ref']) return ws;
    const rango = XLSX.utils.decode_range(ws['!ref']);
    for (let c = rango.s.c; c <= rango.e.c; c++) {
        const encabezado = ws[XLSX.utils.encode_cell({ r: rango.s.r, c })];
        if (!encabezado || !/^fecha/i.test(String(encabezado.v).trim())) continue;
        for (let r = rango.s.r + 1; r <= rango.e.r; r++) {
            const celda = ws[XLSX.utils.encode_cell({ r, c })];
            if (!celda || celda.t !== 's') continue;
            const fecha = aSerial(celda.v);
            if (!fecha) continue;
            celda.t = 'n';
            celda.v = fecha.serial;
            celda.z = fecha.conHora ? FORMATO_DIA_HORA : FORMATO_DIA;
            delete celda.w;
        }
    }
    return ws;
}

/**
 * Celdas de hora de las plantillas (Entrada, Salida, Almuerzo, Hora inicio, Hora fin) con formato Texto: lo que el
 * jefe escribe queda tal cual (00:30, 14:00) en la celda y en la barra de fórmulas. Con formato General, Excel lo
 * convierte en hora del día y la barra muestra "12:30:00 a. m." o "2:00:00 p. m.", que confunde (asistencia.md §90.2).
 * El cargue lee igual los dos formatos. Aplica a todas las filas de datos, también a las vacías. Devuelve la hoja.
 */
function horasComoTexto(ws, XLSX, encabezados) {
    if (!ws || !ws['!ref']) return ws;
    const rango = XLSX.utils.decode_range(ws['!ref']);
    for (let c = rango.s.c; c <= rango.e.c; c++) {
        const encabezado = ws[XLSX.utils.encode_cell({ r: rango.s.r, c })];
        if (!encabezado || !encabezados.includes(String(encabezado.v).trim())) continue;
        for (let r = rango.s.r + 1; r <= rango.e.r; r++) {
            const ref = XLSX.utils.encode_cell({ r, c });
            const celda = ws[ref] ?? (ws[ref] = { t: 's', v: '' });
            if (celda.t !== 's') Object.assign(celda, { t: 's', v: String(celda.v ?? '') });
            celda.z = '@';
        }
    }
    return ws;
}

module.exports = { aSerial, fechasReales, horasComoTexto, FORMATO_DIA, FORMATO_DIA_HORA };
