// Expediente documental del empleado: la estructura de carpetas que Gestión Humana usa en la carpeta
// compartida (ALTAS FORMATO), replicada en el servidor bajo storage/expedientes/:
//
//   <año de ingreso>/<APELLIDOS NOMBRES>/1.SELECCION
//                                       /2.DOCUMENTOS
//                                       /3.CONTRATO
//                                       /4.SST
//                                       /5.RELACIONES LABORALES
//                                       /6.NOVEDADES/<INC|LNR|LR|VACACIONES|...>
//
// En la carpeta compartida la numeración y la escritura varían ("4.NOVEDADES", "5. NOVEDAD",
// "2. DOCUMENTACIÓN", "3.CONTRATOS"), así que cada carpeta se reconoce por su nombre sin el número.
// Puro: sin base de datos ni disco, para poder probarlo solo.

const CATEGORIAS = Object.freeze([
    { clave: 'seleccion',            carpeta: '1.SELECCION',            nombre: 'Selección' },
    { clave: 'documentos',           carpeta: '2.DOCUMENTOS',           nombre: 'Documentos' },
    { clave: 'contrato',             carpeta: '3.CONTRATO',             nombre: 'Contrato' },
    { clave: 'sst',                  carpeta: '4.SST',                  nombre: 'SST' },
    { clave: 'relaciones_laborales', carpeta: '5.RELACIONES LABORALES', nombre: 'Relaciones laborales' },
    { clave: 'novedades',            carpeta: '6.NOVEDADES',            nombre: 'Novedades' }
]);

const CATEGORIA_POR_CLAVE = Object.freeze(Object.fromEntries(CATEGORIAS.map(c => [c.clave, c])));

/** Mayúsculas, sin tildes, solo letras/números y espacios simples. */
function normalizarTexto(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
}

/** El nombre de carpeta sin el número del principio: "5. RELACIONES LABORALES" → "RELACIONES LABORALES". */
const sinNumero = (s) => normalizarTexto(s).replace(/^\d+\s*/, '');

// Tolera los errores de escritura vistos en la carpeta compartida: "DOCUEMENTOS", "DOCUMETNOS",
// "CONTARTO", "RELACION LABORALES".
const REGLAS_CATEGORIA = [
    [/^SELECCION/, 'seleccion'],
    [/^DOCU/, 'documentos'],
    [/^CON(TRATO|TARTO)/, 'contrato'],
    [/^(SST|SEGURIDAD Y SALUD)/, 'sst'],
    [/^(RELACION(ES)? LABORAL(ES)?|JURIDIC)/, 'relaciones_laborales'],
    [/^NOVEDAD/, 'novedades'],
    // Carpetas sueltas en la raíz del empleado, ubicadas con el usuario (§49): un otrosí modifica el
    // contrato y un compromiso es de relaciones laborales. Dentro de NOVEDADES, "OTRO SI" sigue siendo
    // una subcarpeta de novedades, como la tiene Gestión Humana.
    [/^OTRO ?SI/, 'contrato'],
    [/^COMPROMISO/, 'relaciones_laborales']
];

/** Clave de la categoría de una subcarpeta del empleado, o null si no es ninguna de las seis. */
function clasificarCarpeta(nombre) {
    const t = sinNumero(nombre);
    const regla = REGLAS_CATEGORIA.find(([re]) => re.test(t));
    return regla ? regla[1] : null;
}

// Abreviatura que Gestión Humana usa para cada tipo de novedad. Lo que no esté aquí se conserva con su
// nombre normalizado (p. ej. "DIA DE LA FAMILIA", "LPL") para no perder la carpeta.
const REGLAS_NOVEDAD = [
    [/^(INC|INCAPACIDAD(ES)?)$/, 'INC'],
    [/^(LNR|LICENCIAS? NO REMUNERADAS?)$/, 'LNR'],
    [/^(LR|LICENCIAS? REMUNERADAS?)$/, 'LR'],
    [/^(LM|LICENCIAS? DE MATERNIDAD)$/, 'LM'],
    [/^VACACION(ES)?$/, 'VACACIONES'],
    [/^SUSPENSION(ES)?$/, 'SUSPENSION'],
    // Variantes del mismo nombre que se unen en una sola carpeta.
    [/^DIA (DE LA )?FAM[A-Z]*$/, 'DIA DE LA FAMILIA'],
    [/^TELE ?TRABAJO$/, 'TELETRABAJO'],
    [/^OTRO ?SI$/, 'OTRO SI'],
    [/^INCLU[CS]ION DE BENEFICIARIOS?$/, 'INCLUSION DE BENEFICIARIO'],
    [/^L?LAMADOS? DE ATENCION$/, 'LLAMADO DE ATENCION'],
    [/^TRASLADO (DE )?EPS$/, 'TRASLADO EPS']
];

/** Subcarpeta de 6.NOVEDADES con nombre único: "INCAPACIDADES" → "INC". */
function subtipoNovedad(nombre) {
    const t = sinNumero(nombre);
    const regla = REGLAS_NOVEDAD.find(([re]) => re.test(t));
    return regla ? regla[1] : t;
}

/** Nombre de la carpeta del empleado: "APELLIDOS NOMBRES" en mayúsculas y sin tildes. */
function nombreCarpetaEmpleado(e) {
    return normalizarTexto([e.primer_apellido, e.segundo_apellido, e.primer_nombre, e.segundo_nombre]
        .filter(Boolean).join(' '));
}

/** Clave para comparar nombres de carpeta sin importar el orden de las palabras. */
const claveSinOrden = (s) => normalizarTexto(s).split(' ').filter(Boolean).sort().join(' ');

// Lo que no está dentro de ninguna de las seis carpetas (archivos sueltos en la carpeta del empleado,
// carpetas como "OTRO SI" o "5.COMPROMISO" en la raíz) se copia igual, con su ruta original, aquí.
const CARPETA_OTROS = 'OTROS';

/**
 * Ruta dentro del expediente, a partir de la ruta relativa a la carpeta del empleado en la carpeta
 * compartida (partes separadas). Devuelve { categoria, subtipo, partes }; categoria es null para lo que
 * no está en ninguna de las seis carpetas, que va a OTROS/<ruta original>. Ningún archivo se descarta.
 */
function ubicarArchivo(partesRelativas) {
    if (partesRelativas.length < 2) return { categoria: null, partes: [CARPETA_OTROS, ...partesRelativas] };
    const [carpeta, ...resto] = partesRelativas;
    const categoria = clasificarCarpeta(carpeta);
    if (!categoria) return { categoria: null, partes: [CARPETA_OTROS, ...partesRelativas] };
    const cat = CATEGORIA_POR_CLAVE[categoria];
    if (categoria === 'novedades' && resto.length >= 2) {
        const subtipo = subtipoNovedad(resto[0]);
        return { categoria, subtipo, partes: [cat.carpeta, subtipo, ...resto.slice(1)] };
    }
    return { categoria, subtipo: null, partes: [cat.carpeta, ...resto] };
}

/**
 * Índices para asociar carpetas a fichas. `fichas`: filas con id, cedula y los cuatro nombres.
 */
function indexarFichas(fichas) {
    const conNombre = fichas.map(f => ({ ...f, nombre: nombreCarpetaEmpleado(f) }));
    const agrupar = (clave) => {
        const mapa = new Map();
        for (const f of conNombre) mapa.set(clave(f), [...(mapa.get(clave(f)) || []), f]);
        return mapa;
    };
    return {
        porId: new Map(conNombre.map(f => [f.id, f])),
        porCedula: new Map(conNombre.map(f => [String(f.cedula), f])),
        porNombre: agrupar(f => f.nombre),
        sinOrden: agrupar(f => claveSinOrden(f.nombre)),
        filasNombre: conNombre.map(f => ({ id: f.id, nombre: f.nombre }))
    };
}

/**
 * Ficha de una carpeta de empleado por su nombre: { ficha, tipo } con tipo exacto | sin_orden |
 * aproximado (nombre mal escrito en un lado, si la ficha es claramente esa según homologar), o
 * { tipo: 'ambiguo', candidatas } | { tipo: 'sin_coincidencia' }.
 */
function asociarCarpeta(carpeta, indices) {
    const { homologar } = require('./homologacionCatalogos');
    for (const [tipo, indice, clave] of [
        ['exacto', indices.porNombre, normalizarTexto(carpeta)],
        ['sin_orden', indices.sinOrden, claveSinOrden(carpeta)]
    ]) {
        const fichas = indice.get(clave) || [];
        if (fichas.length === 1) return { ficha: fichas[0], tipo };
        if (fichas.length > 1) return { tipo: 'ambiguo', candidatas: fichas };
    }
    const parecida = homologar(carpeta, indices.filasNombre);
    if (parecida) return { ficha: indices.porId.get(parecida.id), tipo: 'aproximado', puntaje: parecida.puntaje };
    return { tipo: 'sin_coincidencia' };
}

/** Carpeta del expediente de un empleado nuevo: "<año de ingreso>/<APELLIDOS NOMBRES>". */
function carpetaExpediente(empleado, fechaIngreso) {
    const anio = String(fechaIngreso || '').slice(0, 4);
    return `${/^\d{4}$/.test(anio) ? anio : new Date().getFullYear()}/${nombreCarpetaEmpleado(empleado)}`;
}

module.exports = {
    CATEGORIAS,
    CARPETA_OTROS,
    indexarFichas,
    asociarCarpeta,
    carpetaExpediente,
    CATEGORIA_POR_CLAVE,
    normalizarTexto,
    clasificarCarpeta,
    subtipoNovedad,
    nombreCarpetaEmpleado,
    claveSinOrden,
    ubicarArchivo
};
