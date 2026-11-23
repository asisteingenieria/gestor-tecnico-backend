/**
 * Plantilla de cargue de la malla de horarios para un jefe (asistencia.md §75). Puro: recibe el equipo directo,
 * los días y los horarios que ya tienen, y devuelve las filas de la plantilla. Sin E/S.
 *
 * Una fila por persona y día (personas del ingreso más reciente al más antiguo, §75.3), con las columnas que lee la malla (§55, mallaHorarios.js): Cedula, Nombre, Fecha,
 * Entrada, Salida, Almuerzo, Novedad y Modelo Trabajo; Cargo y Centro de costo son informativas. Si la persona ya
 * tiene horario ese día se precarga, para que el jefe solo cambie lo que haga falta. Modelo Trabajo se precarga con
 * la modalidad del día o, si no tiene, con la del contrato (Presencial / Trabajo en casa); híbrido queda vacío.
 * El equipo llega ya filtrado a contratos activos y sin retiro (equipoRepository.listaEmpleadosACargo); los días antes
 * de la fecha de ingreso no se incluyen (§75.2).
 */

const { NOVEDADES_DESCANSO } = require('./mallaHorarios');
const { modalidadDeContrato } = require('./consultaAsislock');

const ENCABEZADOS = ['Cedula', 'Nombre', 'Cargo', 'Centro de costo', 'Fecha', 'Entrada', 'Salida', 'Almuerzo', 'Novedad', 'Modelo Trabajo'];
const MODELOS = { presencial: 'Presencial', virtual: 'Trabajo en casa' };
const MAX_DIAS = 62;

const dos = (n) => String(n).padStart(2, '0');
const hhmm = (hora) => String(hora ?? '').slice(0, 5);
const duracion = (minutos) => `${dos(Math.floor((Number(minutos) || 0) / 60))}:${dos((Number(minutos) || 0) % 60)}`;
const claveFecha = (fecha) => (fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10));

/** Novedad de un día de descanso a partir de sus notas ('Malla: INC' → INC); si no dice otra, DESCANSO (§75.1). */
function novedadDeDescanso(notas) {
    const texto = String(notas ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    return NOVEDADES_DESCANSO.find((n) => n !== 'DESCANSO' && n !== 'LIBRE' && new RegExp(`\\b${n}\\b`).test(texto)) ?? 'DESCANSO';
}

/**
 * Valida el rango pedido. Devuelve el mensaje de error o null.
 * @param {string} desde 'YYYY-MM-DD'
 * @param {string} hasta 'YYYY-MM-DD'
 * @param {string} hoy   fecha laboral de hoy
 * @param {number} dias  cantidad de días del rango (la calcula el servicio con utils/fechaBogota)
 */
function errorDeRango(desde, hasta, hoy, dias) {
    if (hasta < desde) return 'La fecha final no puede ser anterior a la inicial';
    if (desde < hoy) return 'La plantilla empieza hoy o después: los días pasados no se cargan';
    if (dias > MAX_DIAS) return `La plantilla puede cubrir hasta ${MAX_DIAS} días`;
    return null;
}

/**
 * @param {Array}    equipo      [{ users_company_id, numero_identificacion, nombre_propio, cargo, centro_costo, modalidad_contrato }]
 * @param {string[]} fechas      días del rango, en orden
 * @param {Map}      existentes  `${users_company_id}|${fecha}` → horario_asignado
 * @returns {Array<Object>} una fila por persona y día, con las claves de ENCABEZADOS (Fecha en 'YYYY-MM-DD')
 */
// Fecha de ingreso 'YYYY-MM-DD' o '' (sin fecha: queda al final del orden descendente).
const ingresoDe = (e) => (e.fecha_ingreso ? claveFecha(e.fecha_ingreso) : '');

function filasPlantilla({ equipo, fechas, existentes = new Map() }) {
    const personas = equipo
        .filter((e) => e.numero_identificacion)
        // Del ingreso más reciente al más antiguo (§75.3); sin fecha de ingreso al final; empate por nombre.
        .sort((a, b) => ingresoDe(b).localeCompare(ingresoDe(a))
            || String(a.nombre_propio ?? '').localeCompare(String(b.nombre_propio ?? ''), 'es'));
    const filas = [];
    for (const e of personas) {
        const modeloContrato = MODELOS[modalidadDeContrato(e.modalidad_contrato)] ?? '';
        const ingreso = e.fecha_ingreso ? claveFecha(e.fecha_ingreso) : null;
        for (const fecha of fechas) {
            if (ingreso && fecha < ingreso) continue;
            const h = existentes.get(`${e.users_company_id}|${fecha}`);
            const fila = {
                Cedula: String(e.numero_identificacion).trim(),
                Nombre: e.nombre_propio ?? '',
                Cargo: e.cargo ?? '',
                'Centro de costo': e.centro_costo ?? '',
                Fecha: fecha,
                Entrada: '',
                Salida: '',
                Almuerzo: '',
                Novedad: '',
                'Modelo Trabajo': modeloContrato
            };
            if (h && h.es_descanso) {
                fila.Novedad = novedadDeDescanso(h.notas);
                fila['Modelo Trabajo'] = '';
            } else if (h) {
                fila.Entrada = hhmm(h.hora_entrada);
                fila.Salida = hhmm(h.hora_salida);
                fila.Almuerzo = duracion(h.minutos_almuerzo);
                fila['Modelo Trabajo'] = MODELOS[h.modalidad] ?? modeloContrato;
            }
            filas.push(fila);
        }
    }
    return filas;
}

module.exports = { ENCABEZADOS, MODELOS, MAX_DIAS, errorDeRango, filasPlantilla, novedadDeDescanso, claveFecha };
