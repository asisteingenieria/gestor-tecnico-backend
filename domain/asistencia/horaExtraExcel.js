/**
 * Horas extra en Excel (asistencia.md §91): el jefe descarga una plantilla con su equipo directo, una fila por persona
 * y día del rango, llena Hora inicio, Hora fin y Motivo donde hubo (o habrá) hora extra y la sube. Todo o nada: si una
 * fila tiene error no se envía ninguna. Puro: recibe las filas ya leídas y los datos ya consultados. Sin E/S.
 *
 * Reglas (decididas con el usuario el 2026-11-26):
 *   - Una fila por persona y día del rango (como la malla, §75); las filas sin Hora inicio, Hora fin ni Motivo se ignoran.
 *   - Fechas pasadas y futuras: sirve para legalizar lo ya trabajado y para programar.
 *   - Una sola hora extra por persona y día: el cálculo de la jornada toma una aprobada por día. Si ya tiene una pendiente
 *     o aprobada ese día, o el Excel trae dos filas para el mismo día, es error.
 *   - Solo el equipo directo de quien sube el archivo, y no antes de su fecha de ingreso.
 *   - Novedades (§91.2): un día con novedad de RRHH registrada (vacaciones, incapacidad, licencia, suspensión; pasada o
 *     programada) o con un cambio de turno o libre pendiente no admite hora extra. Solo "Horas de votación" no bloquea:
 *     es parcial. La plantilla las muestra en la columna Novedad.
 *   - La franja la clasifica el servidor como en la pantalla (§32); si no suma tiempo (queda dentro del turno en un día
 *     ordinario) es error. Una hora fin menor que la de inicio cruza la medianoche.
 */

const { fechaDeCelda, minutosDeCelda, normalizarCedula } = require('./mallaHorarios');

const ENCABEZADOS = ['Cedula', 'Nombre', 'Cargo', 'Centro de costo', 'Fecha', 'Turno', 'Ya solicitada', 'Novedad', 'Hora inicio', 'Hora fin', 'Motivo'];
const MAX_DIAS = 62;
const MAX_FILAS = 20000;
const MAX_MOTIVO = 255;

const normalizarTexto = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toLowerCase().replace(/[\s.-]+/g, '_');

// Columna lógica → encabezados aceptados.
const COLUMNAS = {
    cedula: ['cedula', 'documento', 'numero_identificacion', 'identificacion'],
    nombre: ['nombre', 'nombre_completo'],
    fecha: ['fecha'],
    inicio: ['hora_inicio', 'inicio', 'desde'],
    fin: ['hora_fin', 'fin', 'hasta'],
    motivo: ['motivo', 'justificacion']
};
const OBLIGATORIAS = ['cedula', 'fecha', 'inicio', 'fin', 'motivo'];

const dos = (n) => String(n).padStart(2, '0');
const aHora = (min) => `${dos(Math.floor(min / 60))}:${dos(min % 60)}`;
const claveFecha = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f ?? '').slice(0, 10));
const hhmm = (h) => String(h ?? '').slice(0, 5);

/** Valida el rango de la plantilla. Devuelve el mensaje de error o null. */
function errorDeRango(desde, hasta, dias) {
    if (hasta < desde) return 'La fecha final no puede ser anterior a la inicial';
    if (dias > MAX_DIAS) return `La plantilla puede cubrir hasta ${MAX_DIAS} días`;
    return null;
}

const textoTurno = (h) => (!h ? 'Sin horario' : h.es_descanso ? 'Descanso' : `${hhmm(h.hora_entrada)}-${hhmm(h.hora_salida)}`);
const ESTADO_TEXTO = { pendiente: 'Pendiente', aprobada: 'Aprobada' };

/**
 * Filas de la plantilla: una por persona del equipo y día del rango (desde su ingreso), con su turno y la hora extra
 * que ya tenga pedida ese día.
 * @param {Array}    equipo       [{ users_company_id, numero_identificacion, nombre_propio, cargo, centro_costo, fecha_ingreso }]
 * @param {string[]} fechas       días del rango, en orden
 * @param {Map}      horarios     `${users_company_id}|${fecha}` → horario_asignado
 * @param {Map}      yaPedidas    `${users_company_id}|${fecha}` → hora_extra pendiente o aprobada
 * @param {Map}      novedades    `${users_company_id}|${fecha}` → [{ texto, bloquea }] (de novedadesPorDia)
 */
function filasPlantilla({ equipo, fechas, horarios = new Map(), yaPedidas = new Map(), novedades = new Map() }) {
    const personas = equipo.filter((e) => e.numero_identificacion)
        .sort((a, b) => String(a.nombre_propio ?? '').localeCompare(String(b.nombre_propio ?? ''), 'es'));
    const filas = [];
    for (const e of personas) {
        const ingreso = e.fecha_ingreso ? claveFecha(e.fecha_ingreso) : null;
        for (const fecha of fechas) {
            if (ingreso && fecha < ingreso) continue;
            const clave = `${e.users_company_id}|${fecha}`;
            const pedida = yaPedidas.get(clave);
            filas.push({
                Cedula: String(e.numero_identificacion).trim(),
                Nombre: e.nombre_propio ?? '',
                Cargo: e.cargo ?? '',
                'Centro de costo': e.centro_costo ?? '',
                Fecha: fecha,
                Turno: textoTurno(horarios.get(clave)),
                'Ya solicitada': pedida ? `${ESTADO_TEXTO[pedida.estado] ?? pedida.estado} ${hhmm(pedida.hora_inicio)}-${hhmm(pedida.hora_fin)}` : '',
                Novedad: (novedades.get(clave) ?? []).map((n) => n.texto).join(' · '),
                'Hora inicio': '',
                'Hora fin': '',
                Motivo: ''
            });
        }
    }
    return filas;
}

const NO_BLOQUEAN = ['horas de votacion'];
const sinTildes = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const ddmmaaaa = (f) => f.split('-').reverse().join('/');
const TIPO_CAMBIO = { cambio_horario: 'Cambio de turno pendiente', intercambio: 'Intercambio de turno pendiente', libre: 'Libre pendiente' };

/**
 * Novedades por persona y día del rango: las de RRHH (novedadEquipoRepository.vigentesDe) y los cambios de turno o
 * libres pendientes. → Map `${users_company_id}|${fecha}` → [{ texto, bloquea }]
 * @param {function} sumarDias (fecha, n) → fecha
 */
function novedadesPorDia({ novedadesRrhh = [], cambiosPendientes = [], desde, hasta, sumarDias }) {
    const mapa = new Map();
    const agregar = (uc, fecha, n) => {
        const clave = `${uc}|${fecha}`;
        if (!mapa.has(clave)) mapa.set(clave, []);
        mapa.get(clave).push(n);
    };
    for (const n of novedadesRrhh) {
        const ini = claveFecha(n.fecha_inicial);
        const fin = claveFecha(n.fecha_final ?? n.fecha_inicial);
        const texto = ini === fin ? `${n.tipo} (${ddmmaaaa(ini)})` : `${n.tipo} (${ddmmaaaa(ini)} al ${ddmmaaaa(fin)})`;
        const bloquea = !NO_BLOQUEAN.includes(sinTildes(n.tipo));
        for (let f = ini > desde ? ini : desde; f <= fin && f <= hasta; f = sumarDias(f, 1)) agregar(n.users_company_id, f, { texto, bloquea });
    }
    for (const c of cambiosPendientes) agregar(c.users_company_id, claveFecha(c.fecha), { texto: TIPO_CAMBIO[c.tipo] ?? 'Cambio de turno pendiente', bloquea: true });
    return mapa;
}

/**
 * Filas crudas del Excel (sheet_to_json con raw: true) → solicitudes.
 * @returns {{ faltantes: string[], registros: Array, errores: Array<{fila, cedula, nombre, fecha, motivo}>, vacias: number }}
 */
function leerSolicitudes(filas) {
    if (!Array.isArray(filas) || filas.length === 0) return { faltantes: [], registros: [], errores: [], vacias: 0, vacio: true };
    const encabezados = [...new Set(filas.flatMap((f) => Object.keys(f)))];
    const porNormalizado = new Map(encabezados.map((e) => [normalizarTexto(e), e]));
    const mapa = {};
    for (const [logica, candidatos] of Object.entries(COLUMNAS)) {
        const hallado = candidatos.find((c) => porNormalizado.has(c));
        if (hallado) mapa[logica] = porNormalizado.get(hallado);
    }
    const faltantes = OBLIGATORIAS.filter((c) => !mapa[c]);
    if (faltantes.length > 0) return { faltantes, registros: [], errores: [], vacias: 0 };

    const vacia = (v) => v === null || v === undefined || String(v).trim() === '';
    const registros = [];
    const errores = [];
    let vacias = 0;
    filas.slice(0, MAX_FILAS).forEach((f, i) => {
        const fila = i + 2;
        const crudoCedula = f[mapa.cedula];
        if (vacia(crudoCedula) && vacia(f[mapa.fecha])) return;
        // Día sin hora extra: no se pide nada.
        if (vacia(f[mapa.inicio]) && vacia(f[mapa.fin]) && vacia(f[mapa.motivo])) {
            vacias++;
            return;
        }
        const cedula = normalizarCedula(crudoCedula);
        const fecha = fechaDeCelda(f[mapa.fecha]);
        const nombre = mapa.nombre ? String(f[mapa.nombre] ?? '').trim() || null : null;
        const error = (motivo) => errores.push({ fila, cedula: cedula ?? (vacia(crudoCedula) ? null : String(crudoCedula)), nombre, fecha, motivo });
        if (!cedula) return error('Cédula vacía o inválida');
        if (!fecha) return error('Fecha vacía o inválida');
        const inicio = minutosDeCelda(f[mapa.inicio]);
        const fin = minutosDeCelda(f[mapa.fin]);
        const motivo = String(f[mapa.motivo] ?? '').trim();
        if (inicio === null) return error('Hora inicio vacía o inválida (usa 24 horas: 17:00)');
        if (fin === null) return error('Hora fin vacía o inválida (usa 24 horas: 19:30)');
        if (inicio === fin) return error('La hora inicio y la hora fin son iguales');
        if (!motivo) return error('El motivo es obligatorio');
        if (motivo.length > MAX_MOTIVO) return error(`El motivo pasa de ${MAX_MOTIVO} caracteres`);
        registros.push({ fila, cedula, nombre, fecha, horaInicio: aHora(inicio), horaFin: aHora(fin), motivo });
    });

    // Una hora extra por persona y día.
    const cuantas = new Map();
    for (const r of registros) cuantas.set(`${r.cedula}|${r.fecha}`, (cuantas.get(`${r.cedula}|${r.fecha}`) || 0) + 1);
    const unicos = [];
    for (const r of registros) {
        if (cuantas.get(`${r.cedula}|${r.fecha}`) > 1) {
            errores.push({ fila: r.fila, cedula: r.cedula, nombre: r.nombre, fecha: r.fecha, motivo: 'La persona tiene más de una hora extra para ese día: une las franjas en una sola fila' });
        } else {
            unicos.push(r);
        }
    }
    errores.sort((a, b) => a.fila - b.fila);
    return { faltantes: [], registros: unicos, errores, vacias, truncado: filas.length > MAX_FILAS };
}

/**
 * Cruza las solicitudes con el equipo y con las horas extra que ya existen. Devuelve las que se pueden enviar y las
 * que no, con el motivo.
 * @param {Array} registros   de leerSolicitudes
 * @param {Map}   equipo      cédula → { users_company_id, nombre_propio, fecha_ingreso } (equipo directo)
 * @param {Set}   cedulasRrhh cédulas que existen en RRHH
 * @param {Map}   yaPedidas   `${users_company_id}|${fecha}` → hora_extra pendiente o aprobada
 * @param {Map}   novedades   de novedadesPorDia
 */
function planificar({ registros, equipo, cedulasRrhh = new Set(), yaPedidas = new Map(), novedades = new Map() }) {
    const validas = [];
    const errores = [];
    for (const r of registros) {
        const empleado = equipo.get(r.cedula);
        const error = (motivo) => errores.push({ fila: r.fila, cedula: r.cedula, nombre: empleado?.nombre_propio ?? r.nombre, fecha: r.fecha, motivo });
        if (!empleado) {
            error(cedulasRrhh.has(r.cedula) ? 'No es de tu equipo directo' : 'Cédula sin ficha en RRHH');
            continue;
        }
        const ingreso = empleado.fecha_ingreso ? claveFecha(empleado.fecha_ingreso) : null;
        if (ingreso && r.fecha < ingreso) {
            error(`Es anterior a su ingreso (${ingreso.split('-').reverse().join('/')})`);
            continue;
        }
        const bloqueante = (novedades.get(`${empleado.users_company_id}|${r.fecha}`) ?? []).find((n) => n.bloquea);
        if (bloqueante) {
            error(`Tiene novedad ese día: ${bloqueante.texto}. No se puede pedir hora extra`);
            continue;
        }
        const pedida = yaPedidas.get(`${empleado.users_company_id}|${r.fecha}`);
        if (pedida) {
            error(`Ya tiene una hora extra ${pedida.estado} ese día (${hhmm(pedida.hora_inicio)}-${hhmm(pedida.hora_fin)})`);
            continue;
        }
        validas.push({ ...r, users_company_id: empleado.users_company_id, nombre_rrhh: empleado.nombre_propio });
    }
    return { validas, errores };
}

module.exports = { ENCABEZADOS, MAX_DIAS, errorDeRango, filasPlantilla, leerSolicitudes, planificar, textoTurno, novedadesPorDia };
