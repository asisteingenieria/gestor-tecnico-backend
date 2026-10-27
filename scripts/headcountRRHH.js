/**
 * HeadCount de RRHH (Descargas/HeadCount.xlsx, 2026-10-27): deja el sistema igual al Excel.
 *
 * El archivo trae dos hojas:
 *   - "TOTAL PERSONAL": los 389 empleados ya cargados (ingresos hasta el 2026-09-15).
 *   - "Personal pend": los 67 ingresos desde el 2026-09-18; 7 de ellos ya son bajas. Contratación
 *     le quitó 26 columnas, entre ellas Tipo de contrato y Ciudad donde labora (obligatorias en el
 *     import), y las demás quedaron corridas, así que el import por posición no la puede leer.
 *
 * Dos modos:
 *
 *   node scripts/headcountRRHH.js excel <HeadCount.xlsx> <salida.xlsx>
 *     Genera, con las filas de "Personal pend", un Excel con el formato de "TOTAL PERSONAL" listo
 *     para "Cargar Excel" en RRHH: Tipo de contrato = CTI (Indefinido) y Ciudad = Bogotá, como
 *     confirmó RRHH, y los nombres de jefes y analistas escritos como en su ficha. No toca la BD.
 *
 *   node scripts/headcountRRHH.js sincronizar <HeadCount.xlsx> [--aplicar]
 *     Lo que el import no hace. Correrlo DESPUÉS de cargar el Excel generado:
 *       1. crea la ficha mínima (sin contrato) de German Stiven Arias Rojas, dueño de la empresa,
 *          que figura como director/jefe de área/jefe inmediato y no tiene contrato;
 *       2. llena jefe inmediato, jefe de área, director de área y analista encargado de las dos
 *          hojas, resolviendo los nombres mal escritos (ALIAS). Un analista que ya no está (sin
 *          ficha) se reemplaza por el director de área del empleado. Al equipo de German le llena
 *          además quién gestiona su asistencia (migración 082, asistencia.md §44): Geraldin Cruz
 *          Ortiz a sus directores (los que lo tienen como jefe inmediato) y su jefe inmediato al
 *          resto. Solo llena campos vacíos: si el contrato ya tiene otra persona, lo reporta y no
 *          lo toca;
 *       3. registra el retiro de las bajas de "Personal pend" con los datos de la hoja.
 *     Por defecto SOLO SIMULA. Es seguro de re-ejecutar.
 */

const path = require('path');
const XLSX = require('xlsx');
const db = require('../config/db');
const Retiro = require('../models/Retiro');

// Nombre como viene en el Excel → nombre completo de la ficha. Confirmados con RRHH.
const ALIAS = {
    'GISETHE RODRIGUEZ': 'ANGIE GISETHE RODRIGUEZ FRANCO',
    'STEFANY VELASQUEZ': 'STEFANY JULIETH VELASQUEZ RODRIGUEZ',
    'SHARON PARDO': 'SHARON DISLEY PARDO SANCHEZ',
    'AZAEL DAVID ALCALA BETANCURT': 'AZAEL DAVID ALCALA BETANCOURT',
    'LAIDY NATHALY LOPEZ PULIDO': 'LAIDY NATHALI LOPEZ PULIDO',
    'DIANA MILENA SASTRE QUINTERO': 'DIANA MARCELA SASTRE QUINTERO',
    'GERMAN STIVEN ARIS ROJAS': 'GERMAN STIVEN ARIAS ROJAS',
    // Ya no está; su reemplazo como jefe de workforce entró en "Personal pend".
    'MIGUEL ANGEL BAUTISTA LEGUIZAMON': 'MANUEL ANDRES QUINTERO BARBOSA'
};

// Jefes que ya no están en la empresa: el campo queda vacío, sin reportarlo como pendiente.
// Los analistas que ya no están no se listan: se reemplazan por el director de área del empleado.
const YA_NO_ESTAN = new Set(['NICOLAS DAVID FLOR BERNAL']);

const NOMBRE_GERMAN = 'GERMAN STIVEN ARIAS ROJAS';
// Gestiona en asistencia a los directores de German (los que lo tienen como jefe inmediato), §44.
const CEDULA_GESTORA_DIRECTORES = '1233489011'; // Geraldin Cruz Ortiz

const GERMAN = {
    numero_identificacion: '0123456789',
    primer_nombre: 'GERMAN', segundo_nombre: 'STIVEN',
    primer_apellido: 'ARIAS', segundo_apellido: 'ROJAS',
    nombre_propio: 'Arias Rojas German Stiven'
};

// Posiciones de "TOTAL PERSONAL" (las mismas de utils/importEmpleadosExcel.js).
const TP = { NUM_ID: 3, TIPO_CONTRATO: 17, CIUDAD_LABORA: 18, DIRECTOR: 31, JEFE_AREA: 32, JEFE_INMEDIATO: 33, ESTADO_CONTRATO: 71, SERIAL_DIADEMA: 79, LOCKER: 80, ANALISTA: 86 };
// Posiciones de "Personal pend".
const PP = { ESTADO: 0, NUM_ID: 3, DIRECTOR: 26, JEFE_AREA: 27, JEFE_INMEDIATO: 28, ESTADO_CONTRATO: 49,
    FECHA_RETIRO: 51, FECHA_ULTIMA_CONEXION: 52, TIPO_RETIRO: 53, MOTIVO_RETIRO: 54, JUSTIFICACION: 55,
    SERIAL_DIADEMA: 56, LOCKER: 57, ANALISTA: 61 };

// Encabezado esperado en cada posición que se lee: si contratación vuelve a mover columnas, el
// script se detiene en vez de leer el salario como si fuera el jefe. La cédula está bajo "Tipo De
// Identificación" por las celdas combinadas del original (ver utils/importEmpleadosExcel.js).
const ENCABEZADOS = {
    'TOTAL PERSONAL': { [TP.NUM_ID]: 'TIPO DE IDENTIFICACION', [TP.DIRECTOR]: 'DIRECTOR DE AREA', [TP.JEFE_AREA]: 'JEFE DE AREA',
        [TP.JEFE_INMEDIATO]: 'JEFE INMEDIATO', [TP.ANALISTA]: 'ANALISTA ENCARGADO' },
    'Personal pend': { [PP.ESTADO]: 'ESTADO', [PP.NUM_ID]: 'TIPO DE IDENTIFICACION', [PP.DIRECTOR]: 'DIRECTOR DE AREA',
        [PP.JEFE_AREA]: 'JEFE DE AREA', [PP.JEFE_INMEDIATO]: 'JEFE INMEDIATO', [PP.FECHA_RETIRO]: 'FECHA DE RETIRO',
        [PP.FECHA_ULTIMA_CONEXION]: 'FECHA ULTIMA CONEXION', [PP.TIPO_RETIRO]: 'TIPO DE RETIRO',
        [PP.MOTIVO_RETIRO]: 'MOTIVO DE RETIRO', [PP.JUSTIFICACION]: 'JUSTIFICACION', [PP.SERIAL_DIADEMA]: 'SERIAL DIADEMA',
        [PP.ANALISTA]: 'ANALISTA ENCARGADO' }
};

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const normalizarNombre = (s) => { const n = normalizar(s); return ALIAS[n] || n; };
const vacio = (v) => v === null || v === undefined || ['', 'N/A', 'NA'].includes(String(v).trim().toUpperCase());
const fechaISO = (v) => (v instanceof Date && !isNaN(v) ? v.toISOString().slice(0, 10) : null);
const esBaja = (fila) => normalizar(fila[PP.ESTADO]) === 'BAJA';

function leerHojas(archivo) {
    const wb = XLSX.readFile(archivo, { cellDates: true });
    for (const hoja of ['TOTAL PERSONAL', 'Personal pend']) {
        if (!wb.SheetNames.includes(hoja)) throw new Error(`El archivo no tiene la hoja "${hoja}"`);
    }
    const filas = (hoja) => XLSX.utils.sheet_to_json(wb.Sheets[hoja], { header: 1, raw: true, defval: null });
    const total = filas('TOTAL PERSONAL');
    const pend = filas('Personal pend');
    for (const [hoja, encabezado] of [['TOTAL PERSONAL', total[0]], ['Personal pend', pend[0]]]) {
        for (const [i, esperado] of Object.entries(ENCABEZADOS[hoja])) {
            if (normalizar(encabezado[i]) !== esperado) {
                throw new Error(`Hoja "${hoja}", columna ${Number(i) + 1}: se esperaba "${esperado}" y dice "${encabezado[i]}"`);
            }
        }
    }
    return {
        encabezadoTotal: total[0],
        encabezadoPend: pend[0],
        total: total.slice(1).filter((f) => f && !vacio(f[TP.NUM_ID])),
        pend: pend.slice(1).filter((f) => f && !vacio(f[PP.NUM_ID]))
    };
}

// Columna de "TOTAL PERSONAL" → columna de "Personal pend". Las primeras 17 coinciden por
// posición (el encabezado repite "Tipo De Identificación"); el resto se ubica por nombre.
function mapearColumnas(encabezadoTotal, encabezadoPend) {
    const enc = (s) => normalizar(s);
    const pend = encabezadoPend.map(enc);
    const mapa = {};
    encabezadoTotal.forEach((h, i) => {
        if (i <= 16) { mapa[i] = i; return; }
        if (i === TP.ESTADO_CONTRATO) { mapa[i] = PP.ESTADO_CONTRATO; return; }
        const j = pend.findIndex((x, k) => k > 16 && k !== PP.ESTADO_CONTRATO && x === enc(h));
        if (j >= 0) mapa[i] = j;
    });
    // "BANCO" de "Personal pend" es la columna "Numero de cuenta Correcta" de "TOTAL PERSONAL",
    // que el import ya lee como banco.
    mapa[48] = pend.indexOf('BANCO');
    return mapa;
}

function generarExcel(archivo, salida) {
    const { encabezadoTotal, encabezadoPend, pend } = leerHojas(archivo);
    const mapa = mapearColumnas(encabezadoTotal, encabezadoPend);
    const filas = pend.map((f) => {
        const nueva = encabezadoTotal.map((_, i) => (mapa[i] !== undefined && mapa[i] >= 0 ? f[mapa[i]] : null));
        nueva[TP.TIPO_CONTRATO] = 'CTI';
        nueva[TP.CIUDAD_LABORA] = 'Bogotá';
        for (const col of [TP.DIRECTOR, TP.JEFE_AREA, TP.JEFE_INMEDIATO, TP.ANALISTA]) {
            if (!vacio(nueva[col])) nueva[col] = normalizarNombre(nueva[col]);
        }
        // En las bajas, "Serial Diadema"/"Locker" dicen "OK VALIDADO POR..." (devolución), no
        // un serial: no se cargan como recursos asignados.
        if (esBaja(f)) { nueva[TP.SERIAL_DIADEMA] = null; nueva[TP.LOCKER] = null; }
        return nueva;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([encabezadoTotal, ...filas], { cellDates: true }), 'TOTAL PERSONAL');
    XLSX.writeFile(wb, salida);
    console.log(`Generado ${salida}: ${filas.length} empleados (${pend.filter(esBaja).length} bajas, que se retiran con "sincronizar").`);
}

async function mapaFichasPorNombre(conn) {
    const [rows] = await conn.query(
        "SELECT id, CONCAT_WS(' ', primer_nombre, segundo_nombre, primer_apellido, segundo_apellido) AS nombre FROM users_company"
    );
    const mapa = new Map();
    for (const r of rows) mapa.set(normalizar(r.nombre), r.id);
    return mapa;
}

async function asegurarFichaGerman(conn, resumen) {
    const [existe] = await conn.query('SELECT id FROM users_company WHERE numero_identificacion = ?', [GERMAN.numero_identificacion]);
    if (existe.length > 0) return existe[0].id;
    resumen.push(`Ficha mínima (sin contrato) de ${GERMAN.primer_nombre} ${GERMAN.segundo_nombre} ${GERMAN.primer_apellido} ${GERMAN.segundo_apellido}, CC ${GERMAN.numero_identificacion}`);
    if (!APLICAR) return -1;
    const [[cc]] = await conn.query("SELECT idtipo_identificacion FROM tipo_identificacion WHERE codigo = 'CC'");
    const [r] = await conn.query(
        `INSERT INTO users_company (numero_identificacion, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido,
                                    nombre_propio, tipo_identificacion_idtipo_identificacion)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [GERMAN.numero_identificacion, GERMAN.primer_nombre, GERMAN.segundo_nombre, GERMAN.primer_apellido,
            GERMAN.segundo_apellido, GERMAN.nombre_propio, cc.idtipo_identificacion]
    );
    return r.insertId;
}

const CAMPOS_JEFATURA = [
    { campo: 'jefe_inmediato_id', etiqueta: 'jefe inmediato', tp: TP.JEFE_INMEDIATO, pp: PP.JEFE_INMEDIATO },
    { campo: 'jefe_area_id', etiqueta: 'jefe de área', tp: TP.JEFE_AREA, pp: PP.JEFE_AREA },
    { campo: 'director_area_id', etiqueta: 'director de área', tp: TP.DIRECTOR, pp: PP.DIRECTOR },
    { campo: 'analista_encargado_id', etiqueta: 'analista encargado', tp: TP.ANALISTA, pp: PP.ANALISTA },
    { campo: 'gestor_asistencia_id', etiqueta: 'gestiona asistencia' } // calculado, no viene del Excel
];

async function sincronizarJefatura(conn, filas, mapaNombres, idGerman, informe) {
    const [contratos] = await conn.query(
        `SELECT uc.numero_identificacion AS cedula, c.idcontrato, c.jefe_inmediato_id, c.jefe_area_id, c.director_area_id,
                c.analista_encargado_id, c.gestor_asistencia_id
           FROM users_company uc
           JOIN contrato c ON c.idcontrato = (SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = uc.id)`
    );
    const porCedula = new Map(contratos.map((c) => [String(c.cedula).trim(), c]));
    const [[gestora]] = await conn.query('SELECT id FROM users_company WHERE numero_identificacion = ?', [CEDULA_GESTORA_DIRECTORES]);
    if (!gestora) throw new Error(`No existe la ficha con cédula ${CEDULA_GESTORA_DIRECTORES} (gestora de los directores de German)`);
    const idDe = (nombre) => {
        if (!nombre || YA_NO_ESTAN.has(nombre)) return null;
        if (nombre === NOMBRE_GERMAN && idGerman) return idGerman;
        const id = mapaNombres.get(nombre) ?? null;
        if (!id) informe.noResueltos.add(nombre);
        return id;
    };

    for (const { cedula, nombres } of filas) {
        const contrato = porCedula.get(cedula);
        if (!contrato) { informe.sinFicha.add(cedula); continue; }

        const deseado = {
            jefe_inmediato_id: idDe(nombres.jefe_inmediato_id),
            jefe_area_id: idDe(nombres.jefe_area_id),
            director_area_id: idDe(nombres.director_area_id)
        };
        // Analista que ya no está (sin ficha): lo reemplaza el director de área del empleado.
        const analista = nombres.analista_encargado_id;
        deseado.analista_encargado_id = analista && mapaNombres.has(analista) ? mapaNombres.get(analista) : deseado.director_area_id;
        if (analista && !mapaNombres.has(analista)) informe.analistasReemplazados.add(analista);
        // German no usa el sistema: a sus directores los gestiona Geraldin y al resto, su jefe inmediato.
        if (nombres.jefe_area_id === NOMBRE_GERMAN) {
            deseado.gestor_asistencia_id = nombres.jefe_inmediato_id === NOMBRE_GERMAN ? gestora.id : deseado.jefe_inmediato_id;
            if (!deseado.gestor_asistencia_id) informe.sinGestor.push(`CC ${cedula}`);
        }

        const cambios = {};
        for (const { campo, etiqueta } of CAMPOS_JEFATURA) {
            const id = deseado[campo];
            if (!id || contrato[campo] === id) continue;
            if (contrato[campo] !== null) { informe.conflictos.push(`CC ${cedula}: ${etiqueta} ya es la ficha ${contrato[campo]}, el Excel indica la ficha ${id}`); continue; }
            cambios[campo] = id;
            informe.porCampo[etiqueta] = (informe.porCampo[etiqueta] || 0) + 1;
        }
        if (Object.keys(cambios).length === 0) continue;
        informe.contratos++;
        if (APLICAR) {
            const columnas = Object.keys(cambios);
            await conn.query(
                `UPDATE contrato SET ${columnas.map((c) => `${c} = ?`).join(', ')} WHERE idcontrato = ?`,
                [...columnas.map((c) => cambios[c]), contrato.idcontrato]
            );
        }
    }
}

async function registrarBajas(pend, tiposRetiro) {
    const resultado = { registrados: [], yaRetirados: 0, sinFicha: [], errores: [] };
    for (const f of pend.filter(esBaja)) {
        const cedula = String(f[PP.NUM_ID]).trim();
        const [[ficha]] = await db.query('SELECT id FROM users_company WHERE numero_identificacion = ?', [cedula]);
        if (!ficha) { resultado.sinFicha.push(cedula); continue; }
        if (await Retiro.getByUserCompanyId(ficha.id)) { resultado.yaRetirados++; continue; }

        const tipo = tiposRetiro.get(normalizar(f[PP.TIPO_RETIRO]));
        if (!tipo) { resultado.errores.push(`CC ${cedula}: tipo de retiro "${f[PP.TIPO_RETIRO]}" no está en el catálogo`); continue; }
        const datos = {
            fecha_retiro: fechaISO(f[PP.FECHA_RETIRO]),
            fecha_ultima_conexion: fechaISO(f[PP.FECHA_ULTIMA_CONEXION]),
            tipo_retiro_id: tipo,
            motivo_retiro: vacio(f[PP.MOTIVO_RETIRO]) ? null : String(f[PP.MOTIVO_RETIRO]).trim(),
            justificacion: vacio(f[PP.JUSTIFICACION]) ? null : String(f[PP.JUSTIFICACION]).trim(),
            // "OK VALIDADO POR TECNOLOGIA" en la columna de la diadema = equipo devuelto.
            equipo_entregado: normalizar(f[PP.SERIAL_DIADEMA]).startsWith('OK')
        };
        if (!datos.fecha_retiro) { resultado.errores.push(`CC ${cedula}: sin fecha de retiro`); continue; }
        if (APLICAR) {
            try {
                await Retiro.registrar(ficha.id, datos);
            } catch (e) {
                resultado.errores.push(`CC ${cedula}: ${e.message}`);
                continue;
            }
        }
        resultado.registrados.push(`CC ${cedula}: ${datos.fecha_retiro}, tipo ${tipo}, ${datos.motivo_retiro || 'sin motivo'}`);
    }
    return resultado;
}

const APLICAR = process.argv.includes('--aplicar');

async function sincronizar(archivo) {
    const { total, pend } = leerHojas(archivo);
    const nombresDe = (f, cols) => Object.fromEntries(CAMPOS_JEFATURA.filter((c) => c.tp !== undefined).map(({ campo, tp, pp }) => {
        const v = f[cols === 'tp' ? tp : pp];
        return [campo, vacio(v) ? null : normalizarNombre(v)];
    }));
    const filas = [
        ...total.map((f) => ({ cedula: String(f[TP.NUM_ID]).trim(), nombres: nombresDe(f, 'tp') })),
        ...pend.map((f) => ({ cedula: String(f[PP.NUM_ID]).trim(), nombres: nombresDe(f, 'pp') }))
    ];

    const conn = await db.getConnection();
    const resumenFicha = [];
    const informe = { contratos: 0, porCampo: {}, conflictos: [], noResueltos: new Set(), sinFicha: new Set(),
        analistasReemplazados: new Set(), sinGestor: [] };
    try {
        await conn.beginTransaction();
        const idGerman = await asegurarFichaGerman(conn, resumenFicha);
        const mapaNombres = await mapaFichasPorNombre(conn);
        await sincronizarJefatura(conn, filas, mapaNombres, idGerman, informe);
        if (APLICAR) await conn.commit(); else await conn.rollback();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }

    const [tipos] = await db.query('SELECT idtipo_retiro, nombre FROM tipo_retiro');
    const bajas = await registrarBajas(pend, new Map(tipos.map((t) => [normalizar(t.nombre), t.idtipo_retiro])));

    console.log(APLICAR ? '=== APLICADO ===' : '=== SIMULACIÓN (nada se guardó; usar --aplicar) ===');
    console.log(`Excel: ${total.length} en "TOTAL PERSONAL" + ${pend.length} en "Personal pend"`);
    console.log('\n1. Ficha de German:', resumenFicha.length ? resumenFicha[0] : 'ya existe');
    console.log(`\n2. Jefatura y analista: ${informe.contratos} contratos a completar`, informe.porCampo);
    if (informe.sinFicha.size) console.log(`   Cédulas del Excel sin ficha en el sistema (${informe.sinFicha.size}) — ¿falta cargar el Excel generado?:`, [...informe.sinFicha].join(', '));
    if (informe.noResueltos.size) console.log('   Nombres sin ficha (quedan vacíos):', [...informe.noResueltos].join(', '));
    if (informe.analistasReemplazados.size) console.log('   Analistas que ya no están (se asigna el director de área):', [...informe.analistasReemplazados].join(', '));
    if (informe.sinGestor.length) console.log('   Equipo de German sin jefe inmediato que gestione su asistencia:', informe.sinGestor.join(', '));
    if (informe.conflictos.length) { console.log(`   Con otra persona ya asignada, no se tocan (${informe.conflictos.length}):`); informe.conflictos.forEach((c) => console.log('    ', c)); }
    console.log(`\n3. Retiros de las bajas: ${bajas.registrados.length} a registrar, ${bajas.yaRetirados} ya retirados`);
    bajas.registrados.forEach((r) => console.log('    ', r));
    if (bajas.sinFicha.length) console.log('   Bajas sin ficha (cargar primero el Excel generado):', bajas.sinFicha.join(', '));
    bajas.errores.forEach((e) => console.log('   ERROR', e));
}

(async () => {
    const [modo, archivo, salida] = process.argv.slice(2).filter((a) => a !== '--aplicar');
    try {
        if (modo === 'excel' && archivo && salida) generarExcel(path.resolve(archivo), path.resolve(salida));
        else if (modo === 'sincronizar' && archivo) await sincronizar(path.resolve(archivo));
        else {
            console.log('Uso:\n  node scripts/headcountRRHH.js excel <HeadCount.xlsx> <salida.xlsx>\n  node scripts/headcountRRHH.js sincronizar <HeadCount.xlsx> [--aplicar]');
            process.exitCode = 1;
        }
    } catch (e) {
        console.error('Error:', e.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
