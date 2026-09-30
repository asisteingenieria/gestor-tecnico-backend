const XLSX = require('xlsx');

// Índices de columna (0-based) de la hoja "TOTAL PERSONAL" del Excel real de RRHH.
// El header de la hoja repite "Tipo De Identificación"/"Identificación" varias veces
// por celdas combinadas en el original — por eso se parsea por POSICIÓN, no por nombre
// de columna. Ver asistencia.md / claude/modulo recursoshumanos.md para el origen del
// mapeo (comparado fila a fila contra datos reales, no contra el nombre del header).
const COL = {
    CLIENTE: 1,
    TIPO_ID: 2, NUM_ID: 3,
    TIPO_ID_2: 4, NUM_ID_2: 5,
    TIPO_ID_3: 6, NUM_ID_3: 7,
    FECHA_EXPEDICION: 8, CIUDAD_EXPEDICION: 9,
    PRIMER_NOMBRE: 10, SEGUNDO_NOMBRE: 11, PRIMER_APELLIDO: 12, SEGUNDO_APELLIDO: 13,
    GENERO: 15, RH: 16,
    TIPO_CONTRATO: 17,
    CIUDAD_LABORA: 18,
    OLEADA: 19,
    FECHA_INGRESO: 20,
    AREA: 21,
    CAMPANIA: 22,
    CENTRO_COSTO_NOMBRE: 23, CENTRO_COSTO_CODIGO: 24,
    CARGO_SSFF: 25,
    USUARIO_SSFF: 26,
    CARGO: 27,
    SALARIO: 28, BONO_NO_PRESTACIONAL: 29, BONO_CAFETERIA: 30,
    DIRECTOR_AREA: 31, JEFE_AREA: 32, JEFE_INMEDIATO: 33,
    FECHA_FIN_PERIODO_PRUEBA: 49, FECHA_FIN_CONTRATO: 50,
    FECHA_NACIMIENTO: 34,
    CIUDAD_NACIMIENTO: 35,
    TIPO_DIRECCION: 36,
    DIRECCION: 37, BARRIO: 38,
    TELEFONO: 39, EMAIL: 40,
    ESTADO_CIVIL: 41, NUMERO_HIJOS: 42,
    CONTACTO_EMERGENCIA: 43, PARENTESCO: 44, TELEFONO_CONTACTO: 45,
    TIPO_CUENTA: 46, NUMERO_CUENTA: 47,
    BANCO: 48, // "Numero de cuenta Correcta" en el header: mal etiquetada, es el banco real.
    ARL: 51, ARL_FECHA_AFILIACION: 52, TARIFA_ARL: 53,
    EPS: 54, EPS_FECHA_AFILIACION: 55,
    AFP: 58, AFP_FECHA_AFILIACION: 59,
    CESANTIAS: 62, CESANTIAS_FECHA_AFILIACION: 63,
    CAJA: 66, CAJA_FECHA_AFILIACION: 67,
    VACUNA_TIPO: 68, PRIMERA_DOSIS: 69, SEGUNDA_DOSIS: 70,
    MODALIDAD: 72,
    SERIAL_DIADEMA: 79, LOCKER: 80,
    RUT: 81, PISO: 82, CARNET: 83,
    ANALISTA_ENCARGADO: 86,
    DOTACION: 87, TALLA_CAMISA: 88, TALLA_PANTALON: 89, TALLA_CALZADO: 90,
    OBSERVACIONES: 84,
    FECHA_CERTIFICACION_LABORAL: 85
};

const PLACEHOLDERS = new Set(['', 'N/A', 'N/A ', 'NA', null, undefined]);

function limpio(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (PLACEHOLDERS.has(s) || PLACEHOLDERS.has(s.toUpperCase())) return null;
    return s === '' ? null : s;
}

function esPlaceholderPendiente(v) {
    const s = limpio(v);
    return s !== null && s.toUpperCase() === 'P';
}

function fechaISO(v) {
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    const s = limpio(v);
    if (!s) return null;
    // Fallback por si la celda llegó como texto dd/mm/aaaa en vez de fecha real.
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
}

function numero(v, porDefecto = 0) {
    const s = limpio(v);
    if (s === null) return porDefecto;
    const n = Number(String(s).replace(/,/g, ''));
    return isNaN(n) ? porDefecto : n;
}

// Limpia el prefijo "007." / "013." que trae la columna de banco antes del nombre real.
function limpiarBanco(v) {
    const s = limpio(v);
    if (!s) return null;
    return s.replace(/^\d+\.\s*/, '').trim();
}

// "SI"/"NO" en texto, o -1/0/true/false (así vienen exportados algunos booleanos de
// Excel/Access, como en el Excel de nómina). undefined si la celda no trae nada
// reconocible, para no pisar un valor existente al actualizar un empleado.
function booleano(v) {
    if (v === true || v === 1 || v === -1) return true;
    if (v === false || v === 0) return false;
    const s = limpio(v);
    if (!s) return undefined;
    const norm = s.toUpperCase();
    if (['SI', 'SÍ', 'VERDADERO', 'TRUE', 'X'].includes(norm)) return true;
    if (['NO', 'FALSO', 'FALSE'].includes(norm)) return false;
    return undefined;
}

function normalizarHeader(s) {
    return String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\./g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Campos de la migración 050 (Excel de nómina) que hoy NO tienen una posición fija en
// "TOTAL PERSONAL" — a diferencia del resto de columnas de ese Excel (parseadas por
// posición porque el header tiene nombres repetidos/ambiguos), estos son nombres únicos
// y sin ambigüedad, así que se detectan por nombre de columna donde sea que el archivo
// los traiga. Si una columna no está en el archivo, el campo queda simplemente vacío
// (no rompe la carga de archivos que todavía no las incluyen).
const CAMPOS_NUEVOS_POR_NOMBRE = {
    EMPRESA: ['empresa'],
    CLASE: ['clase'],
    PERIODO_PAGO: ['periodo pago'],
    CLASIFICACION_DIAN: ['clasificacion dian'],
    TIPO_SENA: ['tipo sena'],
    TIPO_COTIZANTE: ['tipo cotizante'],
    SUBTIPO_COTIZANTE: ['subtipo de cotizante', 'subtipo cotizante'],
    DECLARANTE: ['declarante'],
    LIBRETA_MILITAR: ['libreta militar no', 'libreta militar']
};

function detectarColumnasNuevas(headerRow) {
    const headersNormalizados = (headerRow || []).map(normalizarHeader);
    const col = {};
    for (const [clave, alias] of Object.entries(CAMPOS_NUEVOS_POR_NOMBRE)) {
        const idx = headersNormalizados.findIndex(h => alias.includes(h));
        if (idx !== -1) col[clave] = idx;
    }
    return col;
}

const MAP_GENERO = { M: 'Masculino', F: 'Femenino' };
const MAP_MODALIDAD = { PRESENCIAL: 'Presencial', 'TRABAJO EN CASA': 'Remoto' };
// "Tipo De Dirección" del Excel (Urbano/Rural) — catálogo nuevo `zona_direccion`
// (migración 047), distinto del catálogo `tipo_direccion` ya existente (que clasifica
// el uso de la dirección: Residencia/Correspondencia/Laboral, no la zona).
const MAP_ZONA_DIRECCION = { URBANO: 'Urbano', RURAL: 'Rural' };
const MAP_TIPO_CUENTA = { 'CUENTA DE AHORROS': 'Ahorros', 'CUENTA CORRIENTE': 'Corriente' };
const MAP_AREA = { OPERATIVA: 'Operaciones', ADMINISTRATIVA: 'Administrativa' };
// "CTI" es la única abreviatura vista en los datos reales (Contrato a Término Indefinido).
const MAP_TIPO_CONTRATO = { CTI: 'Indefinido' };
// Documentos de identidad que el catálogo actual nombra distinto al Excel.
const MAP_TIPO_ID_CODIGO = { PAS: 'PA' };
// Relaciones de emergencia: el catálogo solo tiene categorías amplias; se mapean los
// sinónimos vistos en datos reales. Lo que no está aquí cae en 'Otro' (no se inventan
// categorías nuevas para un catálogo cerrado de parentescos).
const MAP_PARENTESCO = {
    MADRE: 'Madre', PADRE: 'Padre',
    ESPOSA: 'Cónyuge', ESPOSO: 'Cónyuge', CONYUGE: 'Cónyuge', CONYUGUE: 'Cónyuge', 'COMPAÑERA': 'Cónyuge',
    PAREJA: 'Otro', NOVIA: 'Otro', PADRINO: 'Otro',
    HERMANA: 'Hermano(a)', HERMANO: 'Hermano(a)',
    TIA: 'Tío(a)', TIO: 'Tío(a)',
    PRIMO: 'Primo(a)', PRIMA: 'Primo(a)',
    ABUELA: 'Abuelo(a)', ABUELO: 'Abuelo(a)',
    AMIGA: 'Amigo(a)', AMIGO: 'Amigo(a)',
    HIJA: 'Hijo(a)', HIJO: 'Hijo(a)'
};

function elegirIdentificacionSecundaria(fila, advertencias, numeroFila) {
    const par = (tipoCol, numCol) => {
        const tipo = limpio(fila[tipoCol]);
        const num = limpio(fila[numCol]);
        if (!tipo || !num || Number(num) === 0) return null;
        return { tipo, numero: num };
    };
    const a = par(COL.TIPO_ID_2, COL.NUM_ID_2);
    const b = par(COL.TIPO_ID_3, COL.NUM_ID_3);
    if (a && b) {
        advertencias.push(`Fila ${numeroFila}: trae dos identificaciones secundarias distintas, se guardó solo la primera (${a.tipo} ${a.numero}).`);
        return a;
    }
    return a || b || null;
}

/**
 * Convierte una fila cruda del Excel (array por posición) en un objeto normalizado,
 * listo para que la capa de servicio resuelva catálogos e inserte. No toca la BD.
 * `colExtra`: posiciones de los campos de la migración 050 detectadas por nombre de
 * columna (ver detectarColumnasNuevas) — puede no traer todas, o ninguna.
 */
function normalizarFila(fila, numeroFila, colExtra = {}) {
    const advertencias = [];

    // primer_apellido es NOT NULL en el esquema. Hay empleados reales con un solo
    // apellido, que el Excel deja en la celda de "Segundo Apellido" y la de "Primer
    // Apellido" vacía — se promueve para no perder el dato ni violar la columna.
    let primerApellido = limpio(fila[COL.PRIMER_APELLIDO]);
    let segundoApellido = limpio(fila[COL.SEGUNDO_APELLIDO]);
    if (!primerApellido && segundoApellido) {
        primerApellido = segundoApellido;
        segundoApellido = null;
        advertencias.push(`Fila ${numeroFila}: solo traía un apellido (en la celda de "segundo apellido"), se guardó como apellido único.`);
    }

    const tipoIdCodigo = (() => {
        const raw = limpio(fila[COL.TIPO_ID]);
        if (!raw) return null;
        const codigo = raw.toUpperCase();
        return MAP_TIPO_ID_CODIGO[codigo] || codigo;
    })();

    const idSecundaria = elegirIdentificacionSecundaria(fila, advertencias, numeroFila);
    const tipoIdSecundariaCodigo = idSecundaria
        ? (MAP_TIPO_ID_CODIGO[idSecundaria.tipo.toUpperCase()] || idSecundaria.tipo.toUpperCase())
        : null;

    let estadoCivilRaw = limpio(fila[COL.ESTADO_CIVIL]);
    if (esPlaceholderPendiente(estadoCivilRaw)) estadoCivilRaw = null;

    const parentescoRaw = limpio(fila[COL.PARENTESCO]);
    const contactoRaw = limpio(fila[COL.CONTACTO_EMERGENCIA]);
    const telContactoRaw = limpio(fila[COL.TELEFONO_CONTACTO]);
    const contactoEsPendiente = esPlaceholderPendiente(parentescoRaw) || esPlaceholderPendiente(contactoRaw) || esPlaceholderPendiente(telContactoRaw);

    let contactoEmergencia = null;
    if (!contactoEsPendiente && contactoRaw && telContactoRaw && parentescoRaw) {
        const parentescoNombre = MAP_PARENTESCO[parentescoRaw.toUpperCase()];
        if (!parentescoNombre) advertencias.push(`Fila ${numeroFila}: parentesco "${parentescoRaw}" no reconocido, se guardó como "Otro".`);
        contactoEmergencia = {
            nombre: contactoRaw,
            telefono: telContactoRaw,
            parentesco_nombre: parentescoNombre || 'Otro'
        };
    }

    const generoRaw = limpio(fila[COL.GENERO]);
    const generoNombre = generoRaw ? (MAP_GENERO[generoRaw.toUpperCase()] || null) : null;
    if (generoRaw && !generoNombre) advertencias.push(`Fila ${numeroFila}: género "${generoRaw}" no reconocido, se dejó vacío.`);

    const modalidadRaw = limpio(fila[COL.MODALIDAD]);
    const modalidadNombre = modalidadRaw ? (MAP_MODALIDAD[modalidadRaw.toUpperCase()] || modalidadRaw) : null;

    const tipoCuentaRaw = limpio(fila[COL.TIPO_CUENTA]);
    const tipoCuentaNombre = tipoCuentaRaw ? (MAP_TIPO_CUENTA[tipoCuentaRaw.toUpperCase()] || tipoCuentaRaw) : null;

    const bancoNombre = limpiarBanco(fila[COL.BANCO]);

    // Vacunación: "NO"/"SIN INFORMACIÓN" significa que no se vacunó -> no se crea registro.
    const vacunaRaw = limpio(fila[COL.VACUNA_TIPO]);
    const sinVacuna = !vacunaRaw || ['NO', 'SIN INFORMACIÓN', 'SIN INFORMACION'].includes(vacunaRaw.toUpperCase());
    const vacunacion = sinVacuna ? null : {
        tipo_vacuna_nombre: vacunaRaw,
        primera_dosis: fechaISO(fila[COL.PRIMERA_DOSIS]),
        segunda_dosis: fechaISO(fila[COL.SEGUNDA_DOSIS])
    };

    // Diadema: solo si trae un serial real (no "P"/"N/A").
    const diademaRaw = limpio(fila[COL.SERIAL_DIADEMA]);
    const diademaSerial = (diademaRaw && diademaRaw.toUpperCase() !== 'P') ? diademaRaw : null;

    const lockerRaw = limpio(fila[COL.LOCKER]);

    // Carnet: la columna es un ESTADO ("Entregado"/"Pendiente"/"P"), no un identificador.
    const carnetRaw = limpio(fila[COL.CARNET]);
    const carnetEntregado = !!(carnetRaw && carnetRaw.toUpperCase() === 'ENTREGADO');

    const dotacionRaw = limpio(fila[COL.DOTACION]);
    const tallaCamisa = limpio(fila[COL.TALLA_CAMISA]);
    const tallaPantalon = limpio(fila[COL.TALLA_PANTALON]);
    const tallaCalzado = limpio(fila[COL.TALLA_CALZADO]);
    const tieneDotacion = (dotacionRaw && dotacionRaw.toUpperCase() === 'SI') || tallaCamisa || tallaPantalon || tallaCalzado;

    return {
        numero_fila: numeroFila,
        nombre_completo: [fila[COL.PRIMER_NOMBRE], fila[COL.SEGUNDO_NOMBRE], primerApellido, segundoApellido]
            .map(limpio).filter(Boolean).join(' '),
        advertencias,

        cliente_nombre: limpio(fila[COL.CLIENTE]),
        tipo_id_codigo: tipoIdCodigo,
        numero_identificacion: limpio(fila[COL.NUM_ID]),
        tipo_id_secundaria_codigo: tipoIdSecundariaCodigo,
        numero_identificacion_secundaria: idSecundaria ? idSecundaria.numero : null,
        fecha_expedicion: fechaISO(fila[COL.FECHA_EXPEDICION]),
        ciudad_expedicion_nombre: limpio(fila[COL.CIUDAD_EXPEDICION]),

        primer_nombre: limpio(fila[COL.PRIMER_NOMBRE]),
        segundo_nombre: limpio(fila[COL.SEGUNDO_NOMBRE]),
        primer_apellido: primerApellido,
        segundo_apellido: segundoApellido,
        genero_nombre: generoNombre,
        grupo_sanguineo_nombre: limpio(fila[COL.RH]),

        tipo_contrato_nombre: (() => {
            const raw = limpio(fila[COL.TIPO_CONTRATO]);
            return raw ? (MAP_TIPO_CONTRATO[raw.toUpperCase()] || raw) : null;
        })(),
        ciudad_labora_nombre: limpio(fila[COL.CIUDAD_LABORA]),
        oleada_nombre: limpio(fila[COL.OLEADA]),
        fecha_ingreso: fechaISO(fila[COL.FECHA_INGRESO]),
        area_nombre: (() => {
            const raw = limpio(fila[COL.AREA]);
            return raw ? (MAP_AREA[raw.toUpperCase()] || raw) : null;
        })(),
        campania_nombre: limpio(fila[COL.CAMPANIA]),
        centro_costo_nombre: limpio(fila[COL.CENTRO_COSTO_NOMBRE]),
        centro_costo_codigo: limpio(fila[COL.CENTRO_COSTO_CODIGO]),
        usuario_ssff: limpio(fila[COL.USUARIO_SSFF]),
        cargo_nombre: limpio(fila[COL.CARGO]),
        cargo_ssff: limpio(fila[COL.CARGO_SSFF]),
        salario: numero(fila[COL.SALARIO]),
        bono_no_prestacional: numero(fila[COL.BONO_NO_PRESTACIONAL]),
        bono_cafeteria: numero(fila[COL.BONO_CAFETERIA]),
        director_area_nombre: limpio(fila[COL.DIRECTOR_AREA]),
        jefe_area_nombre: limpio(fila[COL.JEFE_AREA]),
        jefe_inmediato_nombre: limpio(fila[COL.JEFE_INMEDIATO]),
        fecha_fin_periodo_prueba: fechaISO(fila[COL.FECHA_FIN_PERIODO_PRUEBA]),
        fecha_fin_contrato: fechaISO(fila[COL.FECHA_FIN_CONTRATO]),
        observaciones: limpio(fila[COL.OBSERVACIONES]),
        fecha_entrega_certificacion_laboral: fechaISO(fila[COL.FECHA_CERTIFICACION_LABORAL]),

        fecha_nacimiento: fechaISO(fila[COL.FECHA_NACIMIENTO]),
        ciudad_nacimiento_nombre: limpio(fila[COL.CIUDAD_NACIMIENTO]),
        zona_direccion_nombre: (() => {
            const raw = limpio(fila[COL.TIPO_DIRECCION]);
            return raw ? (MAP_ZONA_DIRECCION[raw.toUpperCase()] || null) : null;
        })(),
        direccion: limpio(fila[COL.DIRECCION]),
        barrio: limpio(fila[COL.BARRIO]),
        telefono: limpio(fila[COL.TELEFONO]),
        email: limpio(fila[COL.EMAIL]),
        estado_civil_raw: estadoCivilRaw,
        numero_hijos: numero(fila[COL.NUMERO_HIJOS]),
        contacto_emergencia: contactoEmergencia,

        cuenta_numero: limpio(fila[COL.NUMERO_CUENTA]),
        cuenta_tipo_nombre: tipoCuentaNombre,
        banco_nombre: bancoNombre,

        arl_nombre: limpio(fila[COL.ARL]),
        arl_fecha_afiliacion: fechaISO(fila[COL.ARL_FECHA_AFILIACION]),
        tarifa_arl: numero(fila[COL.TARIFA_ARL], null),
        eps_nombre: limpio(fila[COL.EPS]),
        eps_fecha_afiliacion: fechaISO(fila[COL.EPS_FECHA_AFILIACION]),
        afp_nombre: limpio(fila[COL.AFP]),
        afp_fecha_afiliacion: fechaISO(fila[COL.AFP_FECHA_AFILIACION]),
        cesantias_nombre: limpio(fila[COL.CESANTIAS]),
        cesantias_fecha_afiliacion: fechaISO(fila[COL.CESANTIAS_FECHA_AFILIACION]),
        caja_nombre: limpio(fila[COL.CAJA]),
        caja_fecha_afiliacion: fechaISO(fila[COL.CAJA_FECHA_AFILIACION]),

        vacunacion,

        modalidad_nombre: modalidadNombre,

        diadema_serial: diademaSerial,
        locker_numero: lockerRaw,
        carnet_entregado: carnetEntregado,

        rut: limpio(fila[COL.RUT]),
        piso: limpio(fila[COL.PISO]),
        analista_encargado_nombre: limpio(fila[COL.ANALISTA_ENCARGADO]),

        dotacion: tieneDotacion ? { talla_camisa: tallaCamisa, talla_pantalon: tallaPantalon, talla_calzado: tallaCalzado } : null,
        // La misma señal "DOTACIÓN"="SI" que ya decide si se guarda el historial de
        // tallas también alimenta el flag nuevo contrato.aplica_dotacion (migración
        // 050) — no es un concepto distinto, solo una columna adicional que lo lee.
        aplica_dotacion: dotacionRaw ? dotacionRaw.toUpperCase() === 'SI' : undefined,

        // ---- Campos nuevos (migración 050 / Excel de nómina) detectados por nombre
        // de columna — ver detectarColumnasNuevas. Quedan null si el archivo no los trae.
        empresa_nombre: colExtra.EMPRESA !== undefined ? limpio(fila[colExtra.EMPRESA]) : null,
        clase_nombre: colExtra.CLASE !== undefined ? limpio(fila[colExtra.CLASE]) : null,
        periodo_pago_nombre: colExtra.PERIODO_PAGO !== undefined ? limpio(fila[colExtra.PERIODO_PAGO]) : null,
        clasificacion_dian_nombre: colExtra.CLASIFICACION_DIAN !== undefined ? limpio(fila[colExtra.CLASIFICACION_DIAN]) : null,
        tipo_sena_nombre: colExtra.TIPO_SENA !== undefined ? limpio(fila[colExtra.TIPO_SENA]) : null,
        tipo_cotizante_nombre: colExtra.TIPO_COTIZANTE !== undefined ? limpio(fila[colExtra.TIPO_COTIZANTE]) : null,
        subtipo_cotizante_nombre: colExtra.SUBTIPO_COTIZANTE !== undefined ? limpio(fila[colExtra.SUBTIPO_COTIZANTE]) : null,
        declarante_renta: colExtra.DECLARANTE !== undefined ? booleano(fila[colExtra.DECLARANTE]) : undefined,
        libreta_militar_numero: colExtra.LIBRETA_MILITAR !== undefined ? limpio(fila[colExtra.LIBRETA_MILITAR]) : null
    };
}

/**
 * Parsea el buffer de un .xlsx/.xls y devuelve las filas normalizadas.
 * No accede a la base de datos — eso lo hace services/importEmpleadosService.js.
 */
function parsearArchivo(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const nombreHoja = wb.SheetNames.includes('TOTAL PERSONAL') ? 'TOTAL PERSONAL' : wb.SheetNames[0];
    const hoja = wb.Sheets[nombreHoja];
    const filasCrudas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });
    const colExtra = detectarColumnasNuevas(filasCrudas[0]);

    const filas = [];
    const erroresParseo = [];
    // Fila 0 es el header; los datos empiezan en la fila 1 (índice de hoja = fila 2 de Excel).
    for (let i = 1; i < filasCrudas.length; i++) {
        const cruda = filasCrudas[i];
        if (!cruda || cruda.every(v => v === null || v === undefined || v === '')) continue; // fila vacía
        const numeroFila = i + 1; // número de fila tal como se ve en Excel
        try {
            filas.push(normalizarFila(cruda, numeroFila, colExtra));
        } catch (e) {
            erroresParseo.push({ fila: numeroFila, mensaje: `No se pudo leer la fila: ${e.message}` });
        }
    }

    return { hoja: nombreHoja, total_filas: filas.length, filas, errores_parseo: erroresParseo };
}

module.exports = { parsearArchivo, normalizarFila, limpio, fechaISO, numero };
