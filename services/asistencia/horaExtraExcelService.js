const db = require('../../config/db');
const XLSX = require('xlsx');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const notificacionRepo = require('../../repositories/asistencia/notificacionAsistenciaRepository');
const { calcularTramos, aprobadorDeSolicitud, aprobarAlSolicitar, avisarDespuesDeSolicitar } = require('./horaExtraService');
const horaExtraExcel = require('../../domain/asistencia/horaExtraExcel');
const { homologarPpt } = require('../../domain/asistencia/mallaHorarios');
const { totalMinutos, claseDominante } = require('../../domain/asistencia/clasificarHoraExtra');
const { mensajesHoraExtra, esCargoDirector } = require('../../domain/asistencia/aprobacionJerarquica');
const { textoHoras, lunesDe, diasDeSemana } = require('../../domain/asistencia/semanaMalla');
const { validarLimites } = require('../../domain/asistencia/limitesHoraExtra');
const parametroRepo = require('../../repositories/asistencia/parametroRepository');
const novedadEquipoRepo = require('../../repositories/asistencia/novedadEquipoRepository');
const cambioTurnoRepo = require('../../repositories/asistencia/solicitudCambioTurnoRepository');
const { fechaLaboral, sumarDias } = require('../../utils/fechaBogota');
const { horasComoTexto } = require('../../utils/excelFechas');
const { NoEncontradoError, ReglaAsistenciaError, ValidacionError } = require('../../errors/AppError');

// Horas extra en Excel (asistencia.md §91): el jefe pide en un solo archivo las horas extra de su equipo directo y le
// llegan a su director como si las hubiera pedido una por una en la pantalla (§51). Todo o nada.

const MAX_ERRORES_RESPUESTA = 500;
const claveFecha = (f) => (f instanceof Date ? f.toISOString().slice(0, 10) : String(f).slice(0, 10));

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

// Novedades de RRHH y cambios de turno pendientes por persona y día (§91.2).
async function novedadesDe(ids, desde, hasta) {
    const [novedadesRrhh, cambiosPendientes] = await Promise.all([
        novedadEquipoRepo.vigentesDe(ids, desde, hasta),
        cambioTurnoRepo.findPendientesEntre(ids, desde, hasta)
    ]);
    return horaExtraExcel.novedadesPorDia({ novedadesRrhh, cambiosPendientes, desde, hasta, sumarDias });
}

const porPersonaYDia = (filas) => new Map(filas.map((f) => [`${f.users_company_id}|${claveFecha(f.fecha)}`, f]));

// --- Plantilla -------------------------------------------------------------------------------------

const INSTRUCCIONES = (desde, hasta) => [
    ['Solicitud de horas extra de tu equipo'],
    [`Del ${desde.split('-').reverse().join('/')} al ${hasta.split('-').reverse().join('/')}. Una fila por persona y día.`],
    [],
    ['Cómo llenarla'],
    ['1. Llena Hora inicio, Hora fin y Motivo solo en los días en que la persona tuvo (o tendrá) hora extra. Las demás filas déjalas vacías: no se piden.'],
    ['2. Horas en formato de 24 horas: 17:00, 19:30. Si la hora fin es menor que la de inicio, la franja termina al día siguiente (22:00 a 02:00).'],
    ['3. Novedad muestra las novedades de RRHH registradas (vacaciones, incapacidad, licencia, suspensión) y los cambios de turno o libres pendientes de ese día: esos días no se puede pedir hora extra (las horas de votación sí lo permiten).'],
    ['4. Una sola hora extra por persona y día. "Ya solicitada" muestra las que ya están pendientes o aprobadas: esos días no se pueden pedir otra vez.'],
    ['5. Turno es informativo: la franja se clasifica sola (diurna, nocturna, dominical o festiva) con el turno de ese día. Si queda dentro del turno en un día ordinario no es hora extra.'],
    ['6. No cambies Cedula ni Fecha. Nombre, Cargo, Centro de costo, Turno, Ya solicitada y Novedad son informativos.'],
    ['7. Límites legales: como máximo 2 horas extra al día y 12 a la semana (lunes a domingo), contando las ya pedidas. Con 3 o más domingos trabajados en el mes la persona tiene derecho a un descanso compensatorio.'],
    ['8. Si una sola fila tiene error no se envía ninguna: la vista previa dice qué filas corregir.'],
    [],
    ['Cuando termines, súbela en Horas extra → Solicitar en Excel. Primero verás una vista previa y después la envías a tu director.']
];

async function plantilla({ jefeUsersCompanyId, desde, hasta }) {
    requireUsersCompanyId(jefeUsersCompanyId);
    const hoy = fechaLaboral(new Date());
    // Por defecto la última semana hasta hoy: lo más común es legalizar lo ya trabajado.
    const inicio = desde || sumarDias(hoy, -6);
    const fin = hasta || (desde ? sumarDias(desde, 6) : hoy);
    const fechas = [];
    for (let f = inicio; f <= fin && fechas.length <= horaExtraExcel.MAX_DIAS; f = sumarDias(f, 1)) fechas.push(f);
    const error = horaExtraExcel.errorDeRango(inicio, fin, fechas.length);
    if (error) throw new ReglaAsistenciaError(error);

    const equipo = await equipoRepo.listaEmpleadosACargo(jefeUsersCompanyId);
    if (equipo.length === 0) throw new ReglaAsistenciaError('No tienes personal a cargo para armar la plantilla');
    const ids = equipo.map((e) => e.users_company_id);
    const [horarios, yaPedidas, novedades] = await Promise.all([
        horarioAsignadoRepo.findRangoPorEmpleados(ids, inicio, fin),
        horaExtraRepo.findActivasPorEmpleadosEntre(ids, inicio, fin),
        novedadesDe(ids, inicio, fin)
    ]);
    const filas = horaExtraExcel.filasPlantilla({ equipo, fechas, horarios: porPersonaYDia(horarios), yaPedidas: porPersonaYDia(yaPedidas), novedades });

    const { ENCABEZADOS } = horaExtraExcel;
    const ws = XLSX.utils.json_to_sheet(filas, { header: ENCABEZADOS });
    // Fecha real (número de serie con formato), para que Excel la filtre por año/mes/día.
    const colFecha = ENCABEZADOS.indexOf('Fecha');
    filas.forEach((f, i) => {
        const celda = ws[XLSX.utils.encode_cell({ r: i + 1, c: colFecha })];
        const [a, m, d] = f.Fecha.split('-').map(Number);
        Object.assign(celda, { t: 'n', v: Date.UTC(a, m - 1, d) / 86400000 + 25569, z: 'dd/mm/yyyy' });
    });
    // Horas como texto: 19:30 se ve 19:30 también en la barra de fórmulas (§90.2).
    horasComoTexto(ws, XLSX, ['Hora inicio', 'Hora fin']);
    ws['!cols'] = [14, 34, 26, 24, 12, 13, 20, 34, 11, 11, 40].map((wch) => ({ wch }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length, 1), c: ENCABEZADOS.length - 1 } }) };
    const instrucciones = XLSX.utils.aoa_to_sheet(INSTRUCCIONES(inicio, fin));
    instrucciones['!cols'] = [{ wch: 130 }];
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, ws, 'Horas extra');
    XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');
    return {
        nombre: `plantilla_horas_extra_${inicio}_a_${fin}.xlsx`,
        buffer: XLSX.write(libro, { type: 'buffer', bookType: 'xlsx', compression: true }),
        personas: new Set(filas.map((f) => f.Cedula)).size
    };
}

// --- Lectura y plan --------------------------------------------------------------------------------

function leerArchivo(buffer) {
    if (!buffer || buffer.length === 0) throw new ValidacionError('Adjunte el archivo de Excel con las horas extra');
    let libro;
    try {
        libro = XLSX.read(buffer, { type: 'buffer' });
    } catch {
        throw new ValidacionError('No se pudo leer el archivo: verifique que sea un Excel (.xlsx o .xls)');
    }
    let primeraConDatos = null;
    for (const nombre of libro.SheetNames) {
        const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { raw: true, defval: null });
        if (filas.length === 0) continue;
        const lectura = horaExtraExcel.leerSolicitudes(filas);
        if (lectura.faltantes.length === 0) return { hoja: nombre, ...lectura };
        primeraConDatos ??= { hoja: nombre, ...lectura };
    }
    if (!primeraConDatos) throw new ValidacionError('El archivo no tiene filas');
    throw new ValidacionError(
        `La hoja "${primeraConDatos.hoja}" no tiene las columnas obligatorias: ${primeraConDatos.faltantes.join(', ')}. ` +
        'Se esperan Cedula, Fecha, Hora inicio, Hora fin y Motivo: usa la plantilla de Horas extra.'
    );
}

async function planDelArchivo(jefeUsersCompanyId, buffer) {
    requireUsersCompanyId(jefeUsersCompanyId);
    const lectura = leerArchivo(buffer);
    const equipoLista = await equipoRepo.listaEmpleadosACargo(jefeUsersCompanyId);
    const equipo = new Map(equipoLista.filter((e) => e.numero_identificacion).map((e) => [String(e.numero_identificacion).trim(), e]));
    // PPT con los 7 dígitos → la ficha con 600 (§69).
    const registros = homologarPpt(lectura.registros, equipo);
    const cedulasRrhh = new Set(await empleadoRepo.findNumerosExistentes([...new Set(registros.map((r) => r.cedula))]));

    const fechas = registros.map((r) => r.fecha).sort();
    const ids = [...new Set(registros.filter((r) => equipo.has(r.cedula)).map((r) => equipo.get(r.cedula).users_company_id))];
    const [activas, novedades] = ids.length > 0
        ? await Promise.all([
            horaExtraRepo.findActivasPorEmpleadosEntre(ids, fechas[0], fechas[fechas.length - 1]),
            novedadesDe(ids, fechas[0], fechas[fechas.length - 1])
        ])
        : [[], new Map()];
    const { validas, errores } = horaExtraExcel.planificar({ registros, equipo, cedulasRrhh, yaPedidas: porPersonaYDia(activas), novedades });

    // Clasificación de cada franja con el turno de ese día, igual que en la pantalla (§32).
    const solicitudes = [];
    await Promise.all(validas.map(async (v) => {
        let tramos;
        try {
            tramos = await calcularTramos(v.users_company_id, v.fecha, v.horaInicio, v.horaFin);
        } catch (e) {
            if (!(e instanceof ValidacionError)) throw e;
            errores.push({ fila: v.fila, cedula: v.cedula, nombre: v.nombre_rrhh, fecha: v.fecha, motivo: e.message });
            return;
        }
        const minutos = totalMinutos(tramos);
        if (minutos <= 0) {
            errores.push({ fila: v.fila, cedula: v.cedula, nombre: v.nombre_rrhh, fecha: v.fecha, motivo: 'La franja queda dentro de su turno en un día ordinario: no es hora extra' });
            return;
        }
        solicitudes.push({ ...v, tramos, minutos });
    }));
    solicitudes.sort((a, b) => a.fila - b.fila);
    const limites = await limitesLegales(solicitudes);
    errores.push(...limites.errores);
    const conError = new Set(errores.map((e) => e.fila));
    const todosLosErrores = [...lectura.errores, ...errores].sort((a, b) => a.fila - b.fila);
    return { lectura, solicitudes: solicitudes.filter((s) => !conError.has(s.fila)), errores: todosLosErrores, avisos: limites.avisos };
}

// Topes legales (§91.1): 2 h extra diarias y 12 semanales contando las ya pedidas, y aviso de 3+ domingos en el mes.
async function limitesLegales(solicitudes) {
    if (solicitudes.length === 0) return { errores: [], avisos: [] };
    const { max_horas_extra_diarias: diarias, max_horas_extra_semanales: semanales } = await parametroRepo.obtener();
    if (!Number.isFinite(diarias) || !Number.isFinite(semanales)) {
        throw new ReglaAsistenciaError('Faltan los parámetros max_horas_extra_diarias y max_horas_extra_semanales (migración 111)');
    }
    const fechas = solicitudes.map((s) => s.fecha).sort();
    const primera = fechas[0];
    const ultima = fechas[fechas.length - 1];
    // Semanas completas y meses completos que tocan las solicitudes.
    const desde = [lunesDe(primera), `${primera.slice(0, 7)}-01`].sort()[0];
    const finDeMes = (f) => { const [a, m] = f.split('-').map(Number); return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); };
    const hasta = [diasDeSemana(lunesDe(ultima))[6], finDeMes(ultima)].sort()[1];
    const ids = [...new Set(solicitudes.map((s) => s.users_company_id))];
    const [activas, horarios] = await Promise.all([
        horaExtraRepo.findActivasPorEmpleadosEntre(ids, desde, hasta),
        horarioAsignadoRepo.findRangoPorEmpleados(ids, desde, hasta)
    ]);
    const tramos = await horaExtraRepo.findTramosPorHorasExtra(activas.map((a) => a.idhora_extra));
    const existentes = activas.map((a) => ({ ...a, tramos: tramos.filter((t) => t.idhora_extra === a.idhora_extra) }));
    return validarLimites({
        solicitudes: solicitudes.map((s) => ({ ...s, nombre: s.nombre_rrhh ?? s.nombre })),
        existentes, horarios, maxDiariosMin: diarias * 60, maxSemanalesMin: semanales * 60
    });
}

const resumenDe = (solicitudes) => ({
    solicitudes: solicitudes.length,
    personas: new Set(solicitudes.map((s) => s.users_company_id)).size,
    minutos: solicitudes.reduce((acc, s) => acc + s.minutos, 0)
});

/** Lee el Excel y dice qué se enviaría, sin guardar nada. */
async function previsualizar({ jefeUsersCompanyId, buffer }) {
    const { lectura, solicitudes, errores, avisos } = await planDelArchivo(jefeUsersCompanyId, buffer);
    const [aprobador, cargo] = await Promise.all([equipoRepo.gestorConNombreDe(jefeUsersCompanyId), equipoRepo.cargoDe(jefeUsersCompanyId)]);
    const autoaprobada = esCargoDirector(cargo);
    const resumen = resumenDe(solicitudes);
    return {
        success: true,
        hoja: lectura.hoja,
        resumen: { ...resumen, horas: textoHoras(resumen.minutos), errores: errores.length, vacias: lectura.vacias },
        aprobador: autoaprobada ? null : aprobador?.gestor ?? null,
        // §94: si quien sube es director, se aprueban al enviarlas y no necesita gestor.
        autoaprobada,
        puede_enviar: errores.length === 0 && solicitudes.length > 0 && (autoaprobada || Boolean(aprobador?.gestor_id)),
        solicitudes: solicitudes.map((s) => ({
            fila: s.fila, users_company_id: s.users_company_id, cedula: s.cedula, nombre: s.nombre_rrhh ?? s.nombre,
            fecha: s.fecha, hora_inicio: s.horaInicio, hora_fin: s.horaFin, motivo: s.motivo, minutos: s.minutos, tramos: s.tramos
        })),
        errores: errores.slice(0, MAX_ERRORES_RESPUESTA),
        // Domingos habituales (§91.1): no bloquean.
        avisos,
        truncado: Boolean(lectura.truncado)
    };
}

/** Envía todas las horas extra del Excel al director, o ninguna si hay errores. */
async function enviar({ jefeUsersCompanyId, buffer, solicitadoPor }) {
    const { solicitudes, errores } = await planDelArchivo(jefeUsersCompanyId, buffer);
    if (errores.length > 0) {
        throw new ReglaAsistenciaError(`No se envió ninguna hora extra: ${errores.length} ${errores.length === 1 ? 'fila tiene' : 'filas tienen'} error. Corrígelas y vuelve a subir el archivo.`);
    }
    if (solicitudes.length === 0) throw new ValidacionError('El archivo no trae horas extra: llena Hora inicio, Hora fin y Motivo en los días que las haya');
    // Si quien sube el Excel es director (§94), nacen aprobadas por él mismo.
    const { aprobadorId: aprobador, autoaprobada } = await aprobadorDeSolicitud(jefeUsersCompanyId);

    const resumen = resumenDe(solicitudes);
    const conn = await db.getConnection();
    let notificaciones;
    let detalle;
    try {
        await conn.beginTransaction();
        const ids = [];
        const avisosEmpleados = [];
        for (const s of solicitudes) {
            const id = await horaExtraRepo.insertarSolicitud({
                usersCompanyId: s.users_company_id, fecha: s.fecha, horaInicio: s.horaInicio, horaFin: s.horaFin,
                minutosEstimados: s.minutos, clase: claseDominante(s.tramos), motivo: s.motivo, solicitadoPor,
                solicitanteUsersCompanyId: jefeUsersCompanyId, aprobadorUsersCompanyId: aprobador
            }, conn);
            await horaExtraRepo.insertarTramos(id, s.tramos, conn);
            if (autoaprobada) avisosEmpleados.push(await aprobarAlSolicitar(id, s.tramos, solicitadoPor, conn));
            ids.push(id);
        }
        detalle = await horaExtraRepo.findDetalle(ids[0], conn);
        notificaciones = autoaprobada ? avisosEmpleados.filter(Boolean) : [{
            usersCompanyId: aprobador,
            tipo: 'hora_extra_solicitada',
            horaExtraId: ids[0],
            mensaje: mensajesHoraExtra.solicitadasExcel(detalle.solicitante, resumen.solicitudes, resumen.personas, textoHoras(resumen.minutos))
        }];
        await notificacionRepo.insertarVarias(notificaciones, conn);
        await conn.commit();
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
    avisarDespuesDeSolicitar(notificaciones, autoaprobada, solicitudes.map((s) => s.users_company_id));
    return { success: true, enviadas: resumen.solicitudes, personas: resumen.personas, horas: textoHoras(resumen.minutos), aprobador: detalle.aprobador, autoaprobada };
}

module.exports = { plantilla, previsualizar, enviar };
