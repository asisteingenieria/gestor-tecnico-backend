/**
 * Malla de horarios en Excel (asistencia.md §55): los jefes suben el archivo tal como lo exporta la
 * tabla `tab_mallas_turnos_mes` (Mallas1.xlsx), una fila por persona y día, y se les asigna el horario
 * a su equipo directo. Puro: recibe las filas ya leídas del Excel, el equipo, los horarios existentes y
 * las plantillas, y devuelve qué se haría con cada fila. Sin E/S.
 *
 * Reglas (decididas con el usuario el 2026-11-03, y las de la carga de §49):
 *   - Las columnas se buscan por nombre, sin importar mayúsculas, tildes ni el orden. Para la hora se
 *     prefieren las columnas *_Final (el turno ya ajustado) y, si no están, Entrada/Salida/Tiempo_Almuerzo.
 *   - Entrada 00:00 = día libre (descanso), igual que la novedad Libre.
 *   - INC, VACACIONES, RETIRO, SUSPENSION, LNR y LR = descanso con la novedad en las notas. La novedad viene
 *     en la columna Novedad (Mallas1) o escrita en la celda de Entrada (plantilla 01_Mallas_Operacion, que
 *     no tiene columna Novedad).
 *   - Un turno sin plantilla igual del jefe genera una plantilla nueva al aplicar (general, sin centro de
 *     costo), para que el turno tenga nombre y se pueda reutilizar.
 *   - Almuerzo_Final es la DURACIÓN del almuerzo (00:30 = 30 min), no su hora de inicio.
 *   - Una salida anterior o igual a la entrada (turno que cruza la medianoche) no se soporta: la fila
 *     se rechaza para que el jefe la corrija, en vez de adivinar.
 *   - Solo se aplica de HOY en adelante; los días pasados se informan y se omiten.
 *   - Solo se aplica al equipo directo de quien sube el archivo; el resto se informa y se omite.
 *   - Reemplaza el horario que ya tuviera la persona ese día.
 *   - "Modelo Trabajo" (opcional) da la modalidad del día para AsisLock (§58): Presencial → presencial;
 *     Teletrabajo, Remoto, Virtual o Trabajo en casa → virtual. Vacío, Híbrido o desconocido = sin dato
 *     (se conserva lo que tuviera el día y, si nada, AsisLock recibe la del contrato).
 */

const { normalizarModalidad } = require('./consultaAsislock');

const NOVEDADES_DESCANSO = ['LIBRE', 'INC', 'VACACIONES', 'RETIRO', 'SUSPENSION', 'LNR', 'LR'];
const MAX_FILAS = 20000;

const normalizarTexto = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[\s.-]+/g, '_');

// Columna lógica → encabezados aceptados, en orden de preferencia.
const COLUMNAS = {
    cedula: ['cedula', 'cedulaplataforma', 'cedula_plataforma', 'documento', 'numero_identificacion', 'identificacion'],
    nombre: ['nombre', 'nombre_completo'],
    fecha: ['fecha'],
    entrada: ['entrada_final', 'entrada'],
    salida: ['salida_final', 'salida'],
    almuerzo: ['almuerzo_final', 'tiempo_almuerzo', 'tiempo_de_almuerzo', 'almuerzo'],
    novedad: ['novedad'],
    modalidad: ['modelo_trabajo', 'modelo_de_trabajo', 'modalidad', 'modalidad_trabajo', 'modalidad_de_trabajo']
};
const OBLIGATORIAS = ['cedula', 'fecha', 'entrada', 'salida'];

/** Encabezados del Excel → { columnaLogica: encabezadoReal }, y las obligatorias que faltan. */
function mapearColumnas(encabezados) {
    const porNormalizado = new Map(encabezados.map((e) => [normalizarTexto(e), e]));
    const mapa = {};
    for (const [logica, candidatos] of Object.entries(COLUMNAS)) {
        const hallado = candidatos.find((c) => porNormalizado.has(c));
        if (hallado) mapa[logica] = porNormalizado.get(hallado);
    }
    return { mapa, faltantes: OBLIGATORIAS.filter((c) => !mapa[c]) };
}

const dosDigitos = (n) => String(n).padStart(2, '0');

/**
 * Fecha de una celda: número de serie de Excel, Date o texto 'YYYY-MM-DD' / 'DD/MM/YYYY'.
 * @returns {string|null} 'YYYY-MM-DD'
 */
function fechaDeCelda(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') {
        if (!Number.isFinite(valor) || valor < 1) return null;
        // Serie de Excel: días desde 1899-12-30. Se descarta la parte de la hora.
        return new Date(Math.round((Math.floor(valor) - 25569) * 86400000)).toISOString().slice(0, 10);
    }
    if (valor instanceof Date) {
        return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
    }
    const texto = String(valor).trim().split(/[ T]/)[0];
    let m = texto.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    let iso = m ? `${m[1]}-${dosDigitos(m[2])}-${dosDigitos(m[3])}` : null;
    if (!iso) {
        m = texto.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        iso = m ? `${m[3]}-${dosDigitos(m[2])}-${dosDigitos(m[1])}` : null;
    }
    if (!iso) return null;
    const comprobacion = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(comprobacion.getTime()) && comprobacion.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Hora (o duración) de una celda: fracción de día de Excel, Date o texto 'HH:MM[:SS]' / '8:00 a. m.'.
 * @returns {number|null} minutos desde la medianoche (0-1439)
 */
function minutosDeCelda(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') {
        if (!Number.isFinite(valor) || valor < 0) return null;
        return Math.round((valor % 1) * 1440) % 1440;
    }
    if (valor instanceof Date) {
        if (Number.isNaN(valor.getTime())) return null;
        return valor.getUTCHours() * 60 + valor.getUTCMinutes();
    }
    const texto = String(valor).trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
    const m = texto.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a m|p m)?$/);
    if (!m) return null;
    let horas = Number(m[1]);
    const minutos = Number(m[2]);
    if (minutos > 59) return null;
    const sufijo = m[4]?.replace(' ', '');
    if (sufijo) {
        if (horas < 1 || horas > 12) return null;
        if (sufijo === 'am' && horas === 12) horas = 0;
        if (sufijo === 'pm' && horas !== 12) horas += 12;
    }
    if (horas > 23) return null;
    return horas * 60 + minutos;
}

const aHora = (minutos) => `${dosDigitos(Math.floor(minutos / 60))}:${dosDigitos(minutos % 60)}:00`;

function normalizarCedula(valor) {
    if (valor === null || valor === undefined) return null;
    // Un número de Excel puede venir como 1023456.0
    const texto = typeof valor === 'number' ? String(Math.trunc(valor)) : String(valor).trim().replace(/\.0+$/, '');
    const limpia = texto.replace(/[.\s,-]/g, '');
    return /^\d{4,15}$/.test(limpia) ? limpia : null;
}

/**
 * Filas crudas del Excel (sheet_to_json con raw: true, la fila 1 como encabezado) → registros de horario.
 * @param {Array<Object>} filas
 * @returns {{ faltantes: string[], registros: Array, errores: Array<{fila, cedula, nombre, fecha, motivo}> }}
 *          `fila` es el número de fila en Excel (la 1 es el encabezado).
 */
function leerMalla(filas) {
    if (!Array.isArray(filas) || filas.length === 0) return { faltantes: [], registros: [], errores: [], vacio: true };
    const encabezados = [...new Set(filas.flatMap((f) => Object.keys(f)))];
    const { mapa, faltantes } = mapearColumnas(encabezados);
    if (faltantes.length > 0) return { faltantes, registros: [], errores: [] };

    const registros = [];
    const errores = [];
    filas.slice(0, MAX_FILAS).forEach((f, i) => {
        const fila = i + 2;
        const crudoCedula = f[mapa.cedula];
        const nombre = mapa.nombre ? String(f[mapa.nombre] ?? '').trim() || null : null;
        // Filas totalmente vacías al final de la hoja.
        if ((crudoCedula === null || crudoCedula === undefined || crudoCedula === '') && !f[mapa.fecha]) return;

        const cedula = normalizarCedula(crudoCedula);
        const fecha = fechaDeCelda(f[mapa.fecha]);
        const error = (motivo) => errores.push({ fila, cedula: cedula ?? (crudoCedula == null ? null : String(crudoCedula)), nombre, fecha, motivo });
        if (!cedula) return error('Cédula vacía o inválida');
        if (!fecha) return error('Fecha vacía o inválida');

        const crudoEntrada = f[mapa.entrada];
        const textoEntrada = typeof crudoEntrada === 'string' ? crudoEntrada.trim().toUpperCase() : '';
        const novedad = (mapa.novedad ? String(f[mapa.novedad] ?? '').trim().toUpperCase() || null : null)
            ?? (NOVEDADES_DESCANSO.includes(textoEntrada) ? textoEntrada : null);
        const entrada = minutosDeCelda(crudoEntrada);
        const salida = minutosDeCelda(f[mapa.salida]);
        const almuerzo = mapa.almuerzo ? minutosDeCelda(f[mapa.almuerzo]) : null;

        const modalidad = mapa.modalidad ? normalizarModalidad(f[mapa.modalidad]) : null;
        const base = { fila, cedula, nombre, fecha, novedad };
        const esNovedadDescanso = novedad && NOVEDADES_DESCANSO.includes(novedad);
        if (esNovedadDescanso || entrada === 0) {
            registros.push({
                ...base,
                esDescanso: true,
                horaEntrada: '00:00:00',
                horaSalida: '00:00:00',
                minutosAlmuerzo: 0,
                notas: esNovedadDescanso ? (novedad === 'LIBRE' ? 'Libre' : novedad) : 'Libre'
            });
            return;
        }
        if (entrada === null) return error('Hora de entrada vacía o inválida');
        if (salida === null) return error('Hora de salida vacía o inválida');
        if (salida <= entrada) {
            return error(`La salida (${aHora(salida).slice(0, 5)}) no es posterior a la entrada (${aHora(entrada).slice(0, 5)}): los turnos que cruzan la medianoche no se pueden cargar`);
        }
        registros.push({
            ...base,
            esDescanso: false,
            horaEntrada: aHora(entrada),
            horaSalida: aHora(salida),
            minutosAlmuerzo: almuerzo ?? 0,
            modalidad,
            notas: null
        });
    });

    // Una persona con dos filas para el mismo día: no se adivina cuál vale.
    const porClave = new Map();
    for (const r of registros) {
        const clave = `${r.cedula}|${r.fecha}`;
        porClave.set(clave, (porClave.get(clave) || 0) + 1);
    }
    const unicos = [];
    for (const r of registros) {
        if (porClave.get(`${r.cedula}|${r.fecha}`) > 1) {
            errores.push({ fila: r.fila, cedula: r.cedula, nombre: r.nombre, fecha: r.fecha, motivo: 'La persona tiene más de una fila para ese día' });
        } else {
            unicos.push(r);
        }
    }
    errores.sort((a, b) => a.fila - b.fila);
    return { faltantes: [], registros: unicos, errores, truncado: filas.length > MAX_FILAS };
}

const igualHora = (a, b) => String(a ?? '').slice(0, 5) === String(b ?? '').slice(0, 5);

/** ¿El horario que ya tiene la persona ese día es el mismo que trae la malla? */
function mismoHorario(existente, r) {
    if (!existente) return false;
    if (Boolean(existente.es_descanso) !== r.esDescanso) return false;
    if (r.esDescanso) return true;
    if (r.modalidad && r.modalidad !== (existente.modalidad ?? null)) return false;
    return igualHora(existente.hora_entrada, r.horaEntrada)
        && igualHora(existente.hora_salida, r.horaSalida)
        && Number(existente.minutos_almuerzo ?? 0) === r.minutosAlmuerzo;
}

/**
 * Plantilla del jefe con el mismo turno (entrada, salida y almuerzo), para que el horario muestre el
 * nombre del turno (§46). Prefiere la del centro de costo del empleado, luego una general.
 */
function plantillaPara(r, centroCostoId, plantillas) {
    if (r.esDescanso) return null;
    const iguales = plantillas.filter((p) => igualHora(p.hora_entrada, r.horaEntrada)
        && igualHora(p.hora_salida, r.horaSalida)
        && Number(p.minutos_almuerzo ?? 0) === r.minutosAlmuerzo);
    return iguales.find((p) => p.centro_costo_id != null && p.centro_costo_id === centroCostoId)
        ?? iguales.find((p) => p.centro_costo_id == null)
        ?? null;
}

// Turno sin plantilla: clave para agrupar y nombre de la plantilla que se le crea.
function turnoNuevo(r) {
    const e = r.horaEntrada.slice(0, 5);
    const s = r.horaSalida.slice(0, 5);
    return {
        clave: `${e}|${s}|${r.minutosAlmuerzo}`,
        nombre: `Malla ${e}-${s}${r.minutosAlmuerzo ? ` · ${r.minutosAlmuerzo} min almuerzo` : ''}`,
        horaEntrada: r.horaEntrada,
        horaSalida: r.horaSalida,
        minutosAlmuerzo: r.minutosAlmuerzo
    };
}

/**
 * Qué se hace con cada registro.
 * @param {Array}  registros     de leerMalla
 * @param {string} hoy           fecha laboral de hoy 'YYYY-MM-DD'
 * @param {Map}    equipo        cédula → { users_company_id, nombre_propio, centro_costo_id } (equipo directo)
 * @param {Set}    cedulasRrhh   cédulas que existen en RRHH (para distinguir "no está a tu cargo" de "no existe")
 * @param {Map}    existentes    `${users_company_id}|${fecha}` → horario_asignado
 * @param {Array}  plantillas    del jefe
 * @returns {{ filas: Array, resumen: Object }} cada fila con `estado`: nuevo | reemplaza | igual |
 *          pasado | no_a_cargo | no_encontrado
 */
function planificar({ registros, hoy, equipo, cedulasRrhh, existentes, plantillas = [] }) {
    const filas = registros.map((r) => {
        const empleado = equipo.get(r.cedula);
        const comun = { ...r, users_company_id: empleado?.users_company_id ?? null, nombre_rrhh: empleado?.nombre_propio ?? null };
        if (r.fecha < hoy) return { ...comun, estado: 'pasado' };
        if (!empleado) return { ...comun, estado: cedulasRrhh.has(r.cedula) ? 'no_a_cargo' : 'no_encontrado' };

        const existente = existentes.get(`${empleado.users_company_id}|${r.fecha}`) ?? null;
        const plantilla = plantillaPara(r, empleado.centro_costo_id ?? null, plantillas);
        const nueva = !r.esDescanso && !plantilla ? turnoNuevo(r) : null;
        return {
            ...comun,
            horarioPlantillaId: plantilla?.idhorario_plantilla ?? null,
            plantilla: plantilla?.nombre ?? nueva?.nombre ?? null,
            plantillaNueva: nueva?.clave ?? null,
            anterior: existente
                ? { hora_entrada: existente.hora_entrada, hora_salida: existente.hora_salida, es_descanso: Boolean(existente.es_descanso), modalidad: existente.modalidad ?? null }
                : null,
            estado: !existente ? 'nuevo' : mismoHorario(existente, r) ? 'igual' : 'reemplaza'
        };
    });

    const resumen = { nuevo: 0, reemplaza: 0, igual: 0, pasado: 0, no_a_cargo: 0, no_encontrado: 0 };
    for (const f of filas) resumen[f.estado]++;
    resumen.a_aplicar = resumen.nuevo + resumen.reemplaza;
    // Plantillas que se crearán: solo las de turnos que de verdad se van a aplicar.
    const nuevas = new Map();
    for (const f of filas) {
        if (f.plantillaNueva && (f.estado === 'nuevo' || f.estado === 'reemplaza') && !nuevas.has(f.plantillaNueva)) {
            nuevas.set(f.plantillaNueva, turnoNuevo(f));
        }
    }
    resumen.personas = new Set(filas.filter((f) => f.estado === 'nuevo' || f.estado === 'reemplaza').map((f) => f.users_company_id)).size;
    return { filas, resumen, plantillasNuevas: [...nuevas.values()] };
}

module.exports = {
    NOVEDADES_DESCANSO,
    mapearColumnas,
    fechaDeCelda,
    minutosDeCelda,
    normalizarCedula,
    leerMalla,
    planificar
};
