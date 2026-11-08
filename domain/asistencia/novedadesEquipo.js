// Historial de novedades de RRHH que ven los jefes de su equipo (asistencia.md §56). Puro: sin E/S y
// con la fecha de hoy recibida como parámetro.
//
// Los jefes NO ven el diagnóstico ni los documentos (dato médico): eso queda para RRHH y financiera.
// Lo que sí ven es qué novedad tuvo la persona, cuándo, cuántos días y si RRHH ya tiene sus soportes.

// Texto que el cargue masivo (scripts/cargarNovedadesExcel.js) deja en observaciones: es interno de
// RRHH y no le dice nada al jefe.
const PREFIJO_CARGUE_MASIVO = 'Cargue masivo desde el Excel';

function textoFecha(valor) {
    if (!valor) return null;
    return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

// en_curso: hoy está entre la fecha inicial y la final (sin final, solo el día inicial).
function estadoNovedad(fechaInicial, fechaFinal, hoy) {
    const inicio = textoFecha(fechaInicial);
    const fin = textoFecha(fechaFinal) || inicio;
    if (inicio > hoy) return 'proxima';
    if (fin < hoy) return 'finalizada';
    return 'en_curso';
}

function observacionesVisibles(texto) {
    const limpio = (texto || '').trim();
    if (!limpio || limpio.startsWith(PREFIJO_CARGUE_MASIVO)) return null;
    return limpio;
}

// Soportes: los requeridos por el tipo, contra los cargados. El documento del expediente que enlazó
// el cargue masivo (098) cuenta como soporte, igual que en la pantalla de RRHH.
function estadoSoportes(requeridos, cargados, documentosExpediente) {
    const req = Number(requeridos) || 0;
    const tiene = (Number(cargados) || 0) + (Number(documentosExpediente) || 0);
    if (req === 0) return tiene > 0 ? 'completos' : 'no_requiere';
    return tiene >= req ? 'completos' : (tiene > 0 ? 'incompletos' : 'pendientes');
}

function presentarNovedad(fila, hoy) {
    return {
        id: fila.idnovedad_rrhh,
        empleado_id: fila.empleado_id,
        empleado: fila.empleado_nombre,
        cedula: fila.empleado_identificacion,
        cargo: fila.cargo,
        campania: fila.campania,
        centro_costo: fila.centro_costo,
        jefe_inmediato: fila.jefe_inmediato,
        contrato_vigente: Boolean(fila.contrato_vigente),
        tipo_novedad_id: fila.tipo_novedad_id,
        tipo_novedad: fila.tipo_novedad,
        origen: fila.origen_incapacidad || null,
        accidente_transito: Boolean(fila.accidente_transito),
        fecha_inicial: textoFecha(fila.fecha_inicial),
        fecha_final: textoFecha(fila.fecha_final),
        fecha_retorno: textoFecha(fila.fecha_retorno),
        total_dias: fila.total_dias ?? null,
        observaciones: observacionesVisibles(fila.observaciones),
        estado: estadoNovedad(fila.fecha_inicial, fila.fecha_final, hoy),
        soportes: estadoSoportes(fila.soportes_requeridos, fila.soportes_cargados, fila.documentos_expediente)
    };
}

module.exports = { estadoNovedad, observacionesVisibles, estadoSoportes, presentarNovedad, PREFIJO_CARGUE_MASIVO };
