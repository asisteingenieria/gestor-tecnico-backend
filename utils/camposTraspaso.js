// Qué se llena en cada tipo de traspaso: hoja "TRASPASOS" de Criterios (1).xlsx (migración 070,
// claude/modulo recursoshumanos.md §35). Copiado en el frontend en src/utils/traspasos.js: si
// cambia uno, hay que cambiar el otro.
//
// "Información actual" es la misma en todos los tipos; "Información nueva" cambia por tipo.

const CAMPOS_ACTUALES = [
    'tipo_contrato_anterior_id', 'ciudad_anterior_id', 'fecha_ingreso_anterior',
    'area_anterior_id', 'campania_anterior_id', 'centro_costo_anterior_id',
    'cargo_ssff_anterior', 'usuario_ssff_anterior', 'cargo_anterior_id',
    'salario_anterior', 'bono_no_prestacional_anterior',
    'jefe_area_anterior_id', 'jefe_inmediato_anterior_id', 'modalidad_anterior_id'
];

// Destino común a encargo, ratificación, cambio de cargo y cambio de salario.
const DESTINO = [
    'area_nueva_id', 'campania_nueva_id', 'centro_costo_nuevo_id', 'cargo_ssff_nuevo', 'usuario_ssff_nuevo',
    'jefe_area_nuevo_id', 'jefe_inmediato_nuevo_id', 'modalidad_idmodalidad'
];

const CAMPOS_NUEVOS_POR_TIPO = {
    ENCARGO: ['cargo_nuevo_id', 'bono_no_prestacional_nuevo', 'fecha_inicio', 'fecha_fin', ...DESTINO],
    RATIFICACION: ['cargo_nuevo_id', 'salario_nuevo', 'fecha_inicio', ...DESTINO],
    NO_RATIFICACION: ['cargo_nuevo_id', 'salario_nuevo', 'fecha_inicio', ...DESTINO],
    TRABAJO_CASA: ['modalidad_idmodalidad', 'fecha_inicio_trabajo_casa', 'fecha_fin_trabajo_casa', 'diadema', 'equipo_computo'],
    CAMBIO_CARGO: ['cargo_nuevo_id', 'salario_nuevo', 'fecha_inicio', ...DESTINO],
    CAMBIO_SALARIO: ['cargo_nuevo_id', 'salario_nuevo', 'fecha_inicio', ...DESTINO]
};

const OBLIGATORIOS_POR_TIPO = {
    ENCARGO: ['cargo_nuevo_id', 'fecha_inicio', 'fecha_fin'],
    RATIFICACION: ['cargo_nuevo_id', 'fecha_inicio'],
    NO_RATIFICACION: ['cargo_nuevo_id', 'fecha_inicio'],
    TRABAJO_CASA: ['modalidad_idmodalidad', 'fecha_inicio_trabajo_casa', 'fecha_fin_trabajo_casa'],
    CAMBIO_CARGO: ['cargo_nuevo_id', 'salario_nuevo', 'fecha_inicio'],
    CAMBIO_SALARIO: ['salario_nuevo', 'fecha_inicio']
};

// Todos los campos de "información nueva" que algún tipo usa; los que no aplican al tipo elegido
// se guardan en NULL.
const TODOS_LOS_NUEVOS = [...new Set(Object.values(CAMPOS_NUEVOS_POR_TIPO).flat())];

const vacio = (v) => v === undefined || v === null || String(v).trim() === '';

/**
 * Deja los datos de un traspaso según su tipo.
 * @returns {{ datos: object, faltantes: string[] }} `faltantes`: obligatorios vacíos.
 */
function prepararTraspaso(codigo, data) {
    const aplican = CAMPOS_NUEVOS_POR_TIPO[codigo];
    if (!aplican) return { datos: { ...data }, faltantes: [] };

    const datos = { ...data };
    for (const campo of TODOS_LOS_NUEVOS) {
        if (!aplican.includes(campo)) datos[campo] = null;
    }
    // Trabajo en casa no tiene "Fecha inicio" propia: el traspaso empieza y termina con el
    // trabajo en casa (fecha_inicio es NOT NULL y es la que ordena el listado).
    if (codigo === 'TRABAJO_CASA') {
        datos.fecha_inicio = data.fecha_inicio_trabajo_casa;
        datos.fecha_fin = data.fecha_fin_trabajo_casa;
    }
    // Ratificación / no ratificación: el tipo ya dice si se ratificó.
    datos.ratificacion = codigo === 'RATIFICACION';

    const faltantes = OBLIGATORIOS_POR_TIPO[codigo].filter(campo => vacio(datos[campo]));
    if (codigo === 'ENCARGO' && !faltantes.length && datos.fecha_fin < datos.fecha_inicio) faltantes.push('fecha_fin');
    if (codigo === 'TRABAJO_CASA' && !faltantes.length && datos.fecha_fin_trabajo_casa < datos.fecha_inicio_trabajo_casa) faltantes.push('fecha_fin_trabajo_casa');
    return { datos, faltantes };
}

// Para los mensajes de error (solo los campos que pueden ser obligatorios).
const ETIQUETAS = {
    cargo_nuevo_id: 'Cargo nuevo',
    salario_nuevo: 'Salario nuevo',
    fecha_inicio: 'Fecha inicio',
    fecha_fin: 'Fecha fin (no anterior a la de inicio)',
    modalidad_idmodalidad: 'Modalidad nueva',
    fecha_inicio_trabajo_casa: 'Fecha de inicio de trabajo en casa',
    fecha_fin_trabajo_casa: 'Fecha fin de trabajo en casa (no anterior a la de inicio)'
};

module.exports = { CAMPOS_ACTUALES, CAMPOS_NUEVOS_POR_TIPO, OBLIGATORIOS_POR_TIPO, ETIQUETAS, prepararTraspaso };
