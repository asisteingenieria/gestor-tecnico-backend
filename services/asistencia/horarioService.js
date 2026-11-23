const db = require('../../config/db');
const horarioPlantillaRepo = require('../../repositories/asistencia/horarioPlantillaRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const equipoService = require('./equipoService');
const notificacionService = require('./notificacionService');
const mallaHorarios = require('../../domain/asistencia/mallaHorarios');
const plantillaMalla = require('../../domain/asistencia/plantillaMalla');
const { agregarListas } = require('../../utils/excelListas');
const { fechaLaboral, sumarDias } = require('../../utils/fechaBogota');
const { alcanceDeConsulta } = require('../../domain/asistencia/vistaTodasCampanias');
const XLSX = require('xlsx');
const { NoAutorizadoError, NoEncontradoError, ReglaAsistenciaError, ValidacionError } = require('../../errors/AppError');

function requireUsersCompanyId(usersCompanyId) {
    if (!usersCompanyId) throw new NoEncontradoError('Tu usuario no está vinculado a una ficha de RRHH');
}

// Cada jefe ve y usa solo sus plantillas (dueño = su ficha, migración 066, asistencia.md §25).
// La de otro jefe responde 404, igual que una que no existe, para no revelar las ajenas.
async function plantillaPropia(id, directorUsersCompanyId) {
    const plantilla = await horarioPlantillaRepo.findById(id);
    if (!plantilla || !plantilla.activo || plantilla.dueno_users_company_id !== directorUsersCompanyId) {
        throw new NoEncontradoError('Plantilla no encontrada');
    }
    return plantilla;
}

// Centro de costo al que aplica la plantilla (083, §45): null = general. Undefined = no se toca
// (al actualizar). Solo se valida que exista: la plantilla es una sugerencia, no restringe a quién
// se le asigna.
async function centroCostoValido(centroCostoId) {
    if (centroCostoId === undefined) return undefined;
    if (centroCostoId === null || centroCostoId === '') return null;
    const id = Number(centroCostoId);
    if (!(await horarioPlantillaRepo.existeCentroCosto(id))) throw new ReglaAsistenciaError('El centro de costo no existe');
    return id;
}

async function listarPlantillas({ directorUsersCompanyId }) {
    requireUsersCompanyId(directorUsersCompanyId);
    return horarioPlantillaRepo.findPorDueno(directorUsersCompanyId);
}

async function crearPlantilla({ directorUsersCompanyId, ...datos }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const centroCostoId = await centroCostoValido(datos.centroCostoId);
    const id = await horarioPlantillaRepo.crear({ ...datos, centroCostoId, duenoUsersCompanyId: directorUsersCompanyId });
    return { success: true, idhorario_plantilla: id };
}

async function actualizarPlantilla({ directorUsersCompanyId, id, campos }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await plantillaPropia(id, directorUsersCompanyId);
    await horarioPlantillaRepo.actualizar(id, { ...campos, centroCostoId: await centroCostoValido(campos.centroCostoId) });
    return { success: true };
}

async function eliminarPlantilla({ directorUsersCompanyId, id }) {
    requireUsersCompanyId(directorUsersCompanyId);
    await plantillaPropia(id, directorUsersCompanyId);
    await horarioPlantillaRepo.desactivar(id);
    return { success: true };
}

// Fechas del rango [desde, hasta] que caen en los días de la semana pedidos (1=lunes..7=domingo).
function generarFechas(desde, hasta, diasSemana) {
    const fechas = [];
    const cursor = new Date(`${desde}T00:00:00Z`);
    const fin = new Date(`${hasta}T00:00:00Z`);
    while (cursor <= fin) {
        const diaIso = cursor.getUTCDay() === 0 ? 7 : cursor.getUTCDay();
        if (!diasSemana || diasSemana.length === 0 || diasSemana.includes(diaIso)) {
            fechas.push(cursor.toISOString().slice(0, 10));
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return fechas;
}

async function asignarMasivo({ directorUsersCompanyId, empleados, desde, hasta, diasSemana, plantillaId, valores, modalidad = null, creadoPor }) {
    requireUsersCompanyId(directorUsersCompanyId);
    // Todo el equipo en una consulta (con "Seleccionar todos" pueden ser 100+ personas).
    const idsPedidos = [...new Set(empleados.map(Number))];
    const aCargo = new Set(await equipoRepo.subordinadosDe(directorUsersCompanyId, idsPedidos));
    if (idsPedidos.some((id) => !aCargo.has(id))) throw new NoAutorizadoError('El empleado no está a su cargo');

    let datosHorario = valores;
    if (plantillaId) {
        const plantilla = await plantillaPropia(plantillaId, directorUsersCompanyId);
        datosHorario = {
            horaEntrada: plantilla.hora_entrada,
            horaSalida: plantilla.hora_salida,
            minutosAlmuerzo: plantilla.minutos_almuerzo,
            horaAlmuerzoInicio: plantilla.hora_almuerzo_inicio,
            toleranciaEntradaMin: plantilla.tolerancia_entrada_min
        };
    }
    if (!datosHorario || !datosHorario.horaEntrada || !datosHorario.horaSalida) {
        throw new ReglaAsistenciaError('Debe indicar plantilla_id o los valores de horario (hora_entrada, hora_salida)');
    }

    const fechas = generarFechas(desde, hasta, diasSemana);
    const filas = idsPedidos.flatMap((empleadoId) => fechas.map((fecha) => ({
        usersCompanyId: empleadoId,
        fecha,
        horarioPlantillaId: plantillaId ?? null,
        horaEntrada: datosHorario.horaEntrada,
        horaSalida: datosHorario.horaSalida,
        minutosAlmuerzo: datosHorario.minutosAlmuerzo,
        horaAlmuerzoInicio: datosHorario.horaAlmuerzoInicio,
        toleranciaEntradaMin: datosHorario.toleranciaEntradaMin,
        esDescanso: false,
        // null conserva la modalidad que ya tuviera el día (§58).
        modalidad,
        creadoPor,
        notas: null
    })));

    // Todo o nada: una asignación a medio camino dejaría parte del equipo sin horario.
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        await horarioAsignadoRepo.insertarVarios(filas, conn);
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
    return { success: true, horarios_creados: filas.length };
}

// Sin alcance: los horarios de su equipo. Con `alcance` 'todas' o una `campaniaId`, quien ve todas las
// campañas (§68) consulta los de esa gente, en solo lectura (§74): asignar, editar y borrar siguen
// exigiendo que el empleado esté a su cargo.
async function consultarHorarios({ directorUsersCompanyId, empleadoId, desde, hasta, alcance, campaniaId }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const consulta = alcanceDeConsulta({ alcance, campaniaId });
    if (consulta.tipo !== 'equipo') {
        if (!(await equipoService.veTodasLasCampaniasDe(directorUsersCompanyId))) {
            throw new NoAutorizadoError('Solo puedes consultar los horarios de tu equipo');
        }
        const roster = await empleadoRepo.findActivosPorCampania(consulta.campaniaId);
        return horarioAsignadoRepo.findRangoPorEmpleados(roster.map((e) => e.users_company_id), desde, hasta);
    }
    if (empleadoId) {
        await equipoService.assertEmpleadoACargo(directorUsersCompanyId, empleadoId);
        return horarioAsignadoRepo.findRango(empleadoId, desde, hasta);
    }
    const empleados = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    const listas = await Promise.all(empleados.map((e) => horarioAsignadoRepo.findRango(e.users_company_id, desde, hasta)));
    return listas.flat();
}

async function actualizarAsignacion({ directorUsersCompanyId, idhorarioAsignado, campos }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const asignacion = await horarioAsignadoRepo.findById(idhorarioAsignado);
    if (!asignacion) throw new NoEncontradoError('Horario asignado no encontrado');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, asignacion.users_company_id);
    await horarioAsignadoRepo.actualizar(idhorarioAsignado, campos);
    return { success: true };
}

async function eliminarAsignacion({ directorUsersCompanyId, idhorarioAsignado }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const asignacion = await horarioAsignadoRepo.findById(idhorarioAsignado);
    if (!asignacion) throw new NoEncontradoError('Horario asignado no encontrado');
    await equipoService.assertEmpleadoACargo(directorUsersCompanyId, asignacion.users_company_id);
    await horarioAsignadoRepo.eliminar(idhorarioAsignado);
    return { success: true };
}

// --- Malla de horarios en Excel (§55) ---------------------------------------------------------

// Hoja con la malla: la primera cuyas columnas se reconocen (Mallas1.xlsx trae además una "Hoja1"
// vacía). Si ninguna, la primera con datos, para que el error diga qué columnas faltan.
function leerArchivoMalla(buffer) {
    if (!buffer || buffer.length === 0) throw new ValidacionError('Adjunte el archivo de Excel con la malla');
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
        const lectura = mallaHorarios.leerMalla(filas);
        if (lectura.faltantes.length === 0) return { hoja: nombre, ...lectura };
        primeraConDatos ??= { hoja: nombre, ...lectura };
    }
    if (!primeraConDatos) throw new ValidacionError('El archivo no tiene filas');
    throw new ValidacionError(
        `La hoja "${primeraConDatos.hoja}" no tiene las columnas obligatorias: ${primeraConDatos.faltantes.join(', ')}. ` +
        'Se esperan al menos Cedula, Fecha, Entrada (o Entrada_Final) y Salida (o Salida_Final).'
    );
}

const claveFecha = (fecha) => (fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10));

async function planDeMalla(directorUsersCompanyId, buffer) {
    requireUsersCompanyId(directorUsersCompanyId);
    const lectura = leerArchivoMalla(buffer);
    const hoy = fechaLaboral(new Date());

    const equipoLista = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    const equipo = new Map(equipoLista
        .filter((e) => e.numero_identificacion)
        .map((e) => [String(e.numero_identificacion).trim(), e]));
    const cedulas = [...new Set(lectura.registros.map((r) => r.cedula))];
    const [existentesRrhh, retiradas] = await Promise.all([
        empleadoRepo.findNumerosExistentes(cedulas), empleadoRepo.findNumerosRetirados(cedulas)
    ]);
    const cedulasRrhh = new Set(existentesRrhh);
    const cedulasRetiradas = new Set(retiradas);

    const vigentes = lectura.registros.filter((r) => r.fecha >= hoy && equipo.has(r.cedula));
    const ids = [...new Set(vigentes.map((r) => equipo.get(r.cedula).users_company_id))];
    const fechas = vigentes.map((r) => r.fecha).sort();
    const existentes = new Map();
    if (ids.length > 0) {
        for (const h of await horarioAsignadoRepo.findRangoPorEmpleados(ids, fechas[0], fechas[fechas.length - 1])) {
            existentes.set(`${h.users_company_id}|${claveFecha(h.fecha)}`, h);
        }
    }
    const plantillas = await horarioPlantillaRepo.findPorDueno(directorUsersCompanyId);
    const plan = mallaHorarios.planificar({ registros: lectura.registros, hoy, equipo, cedulasRrhh, cedulasRetiradas, existentes, plantillas });
    return { lectura, plan, hoy };
}

// Personas omitidas (retiradas, antes de su ingreso, no están a cargo o no existen en RRHH), una línea por persona.
const ESTADOS_OMITIDOS = ['retirado', 'antes_ingreso', 'no_a_cargo', 'no_encontrado'];
function omitidosPorPersona(filas) {
    const porCedula = new Map();
    for (const f of filas) {
        if (!ESTADOS_OMITIDOS.includes(f.estado)) continue;
        const p = porCedula.get(f.cedula) ?? { cedula: f.cedula, nombre: f.nombre, estado: f.estado, dias: 0 };
        p.dias++;
        porCedula.set(f.cedula, p);
    }
    return [...porCedula.values()].sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
}

const MAX_ERRORES_RESPUESTA = 500;

/** Lee la malla y dice qué haría, sin escribir nada. */
async function previsualizarMalla({ directorUsersCompanyId, buffer }) {
    const { lectura, plan, hoy } = await planDeMalla(directorUsersCompanyId, buffer);
    const delEquipo = plan.filas.filter((f) => ['nuevo', 'reemplaza', 'igual'].includes(f.estado));
    return {
        success: true,
        hoja: lectura.hoja,
        hoy,
        resumen: { ...plan.resumen, errores: lectura.errores.length, sin_diligenciar: lectura.sinDiligenciar ?? 0 },
        horarios: delEquipo.map((f) => ({
            fila: f.fila,
            users_company_id: f.users_company_id,
            cedula: f.cedula,
            nombre: f.nombre_rrhh ?? f.nombre,
            fecha: f.fecha,
            estado: f.estado,
            es_descanso: f.esDescanso,
            hora_entrada: f.horaEntrada,
            hora_salida: f.horaSalida,
            minutos_almuerzo: f.minutosAlmuerzo,
            modalidad: f.modalidad ?? null,
            notas: f.notas,
            plantilla: f.plantilla,
            plantilla_nueva: Boolean(f.plantillaNueva),
            anterior: f.anterior
        })),
        plantillas_nuevas: plan.plantillasNuevas.map((p) => ({
            nombre: p.nombre, hora_entrada: p.horaEntrada, hora_salida: p.horaSalida, minutos_almuerzo: p.minutosAlmuerzo
        })),
        omitidos: omitidosPorPersona(plan.filas),
        errores: lectura.errores.slice(0, MAX_ERRORES_RESPUESTA),
        truncado: Boolean(lectura.truncado)
    };
}

// --- Plantilla de cargue de la malla (§75) -------------------------------------------------------

const INSTRUCCIONES = (desde, hasta) => [
    ['Plantilla de la malla de horarios de tu equipo'],
    [`Del ${desde.split('-').reverse().join('/')} al ${hasta.split('-').reverse().join('/')}. Una fila por persona y día.`],
    [],
    ['Cómo llenarla'],
    ['1. Entrada y Salida en hora de 24 horas: 08:00, 17:00. Almuerzo es la duración: 00:30 = 30 minutos, 01:00 = una hora.'],
    ['2. Modelo Trabajo: elige de la lista Presencial o Trabajo en casa. Viene precargado con el del día o el del contrato; cámbialo si ese día es distinto.'],
    ['3. Descanso: deja Entrada y Salida vacías y elige en Novedad DESCANSO (o INC, VACACIONES, RETIRO, SUSPENSION, LNR, LR si es otra ausencia).'],
    ['4. Si la persona ya tenía horario ese día, viene precargado: cámbialo solo si hace falta.'],
    ['5. Las filas que dejes sin Entrada, Salida ni Novedad no se cargan: ese día queda como estaba.'],
    ['6. No cambies Cedula ni Fecha. Nombre, Cargo y Centro de costo son informativos.'],
    ['7. Los turnos que cruzan la medianoche (salida antes de la entrada) no se pueden cargar.'],
    [],
    ['Cuando termines, súbela en Horarios → Cargar malla. Primero verás una vista previa y después la aplicas.']
];

/** Libro de la plantilla: hoja Malla (primera, la que se lee al subirla) e Instrucciones. */
function libroPlantillaMalla(filas, desde, hasta) {
    const { ENCABEZADOS } = plantillaMalla;
    const ws = XLSX.utils.json_to_sheet(filas, { header: ENCABEZADOS });
    // Fecha real (número de serie con formato), para que Excel la filtre por año/mes/día.
    const colFecha = ENCABEZADOS.indexOf('Fecha');
    filas.forEach((f, i) => {
        const celda = ws[XLSX.utils.encode_cell({ r: i + 1, c: colFecha })];
        const [a, m, d] = f.Fecha.split('-').map(Number);
        Object.assign(celda, { t: 'n', v: Date.UTC(a, m - 1, d) / 86400000 + 25569, z: 'dd/mm/yyyy' });
    });
    ws['!cols'] = [14, 34, 28, 26, 12, 10, 10, 10, 14, 18].map((wch) => ({ wch }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(filas.length, 1), c: ENCABEZADOS.length - 1 } }) };

    const instrucciones = XLSX.utils.aoa_to_sheet(INSTRUCCIONES(desde, hasta));
    instrucciones['!cols'] = [{ wch: 130 }];

    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, ws, 'Malla');
    XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');
    const buffer = XLSX.write(libro, { type: 'buffer', bookType: 'xlsx', compression: true });

    const ultima = Math.max(filas.length + 1, 2);
    const col = (nombre) => XLSX.utils.encode_col(ENCABEZADOS.indexOf(nombre));
    return agregarListas(buffer, 1, [
        {
            rango: `${col('Novedad')}2:${col('Novedad')}${ultima}`,
            opciones: mallaHorarios.NOVEDADES_DESCANSO,
            titulo: 'Novedad',
            mensaje: 'Solo para días de descanso: deja Entrada y Salida vacías.'
        },
        {
            rango: `${col('Modelo Trabajo')}2:${col('Modelo Trabajo')}${ultima}`,
            opciones: Object.values(plantillaMalla.MODELOS),
            titulo: 'Modelo de trabajo',
            mensaje: 'Presencial o Trabajo en casa ese día.'
        }
    ]);
}

/**
 * Plantilla de cargue de la malla con el equipo directo del jefe (§75): cédula, nombre, cargo y centro de costo de
 * cada persona, una fila por día del rango (por defecto, hoy y los 6 días siguientes), con lo que ya tenga asignado.
 */
async function plantillaMallaExcel({ directorUsersCompanyId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
    const hoy = fechaLaboral(new Date());
    const inicio = desde || hoy;
    const fin = hasta || sumarDias(inicio, 6);
    const fechas = [];
    for (let f = inicio; f <= fin && fechas.length <= plantillaMalla.MAX_DIAS; f = sumarDias(f, 1)) fechas.push(f);
    const error = plantillaMalla.errorDeRango(inicio, fin, hoy, fechas.length);
    if (error) throw new ReglaAsistenciaError(error);

    const equipo = await equipoRepo.listaEmpleadosACargo(directorUsersCompanyId);
    if (equipo.length === 0) throw new ReglaAsistenciaError('No tienes personal a cargo para armar la plantilla');
    const existentes = new Map();
    for (const h of await horarioAsignadoRepo.findRangoPorEmpleados(equipo.map((e) => e.users_company_id), inicio, fin)) {
        existentes.set(`${h.users_company_id}|${claveFecha(h.fecha)}`, h);
    }
    const filas = plantillaMalla.filasPlantilla({ equipo, fechas, existentes });
    return {
        nombre: `plantilla_malla_${inicio}_a_${fin}.xlsx`,
        buffer: libroPlantillaMalla(filas, inicio, fin),
        personas: new Set(filas.map((f) => f.Cedula)).size
    };
}

/**
 * Aplica la malla: los días de hoy en adelante del equipo directo, en una sola transacción. Los turnos
 * sin plantilla igual del jefe se vuelven plantillas suyas (generales) en la misma transacción.
 */
async function aplicarMalla({ directorUsersCompanyId, buffer, creadoPor }) {
    const { plan, hoy } = await planDeMalla(directorUsersCompanyId, buffer);
    const aAplicar = plan.filas.filter((f) => f.estado === 'nuevo' || f.estado === 'reemplaza');
    if (aAplicar.length === 0) {
        return { success: true, horarios_aplicados: 0, plantillas_creadas: [], resumen: plan.resumen, message: 'No hay horarios nuevos ni cambios para aplicar' };
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const idsNuevas = new Map();
        for (const p of plan.plantillasNuevas) {
            idsNuevas.set(p.clave, await horarioPlantillaRepo.crear({
                nombre: p.nombre,
                horaEntrada: p.horaEntrada,
                horaSalida: p.horaSalida,
                minutosAlmuerzo: p.minutosAlmuerzo,
                horaAlmuerzoInicio: null,
                toleranciaEntradaMin: 0,
                centroCostoId: null,
                duenoUsersCompanyId: directorUsersCompanyId,
                creadoPor
            }, conn));
        }
        await horarioAsignadoRepo.insertarVarios(aAplicar.map((f) => ({
            usersCompanyId: f.users_company_id,
            fecha: f.fecha,
            horarioPlantillaId: f.horarioPlantillaId ?? idsNuevas.get(f.plantillaNueva) ?? null,
            horaEntrada: f.horaEntrada,
            horaSalida: f.horaSalida,
            minutosAlmuerzo: f.minutosAlmuerzo,
            horaAlmuerzoInicio: null,
            toleranciaEntradaMin: 0,
            esDescanso: f.esDescanso,
            modalidad: f.modalidad ?? null,
            creadoPor,
            notas: f.notas ? `Malla: ${f.notas}` : 'Malla'
        })), conn);
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }

    // Si cambió el turno de hoy, el monitor y "Equipo hoy" lo muestran sin recargar.
    for (const id of new Set(aAplicar.filter((f) => f.fecha === hoy).map((f) => f.users_company_id))) {
        notificacionService.notificarCambioJornada(id, 'horario');
    }
    return {
        success: true,
        horarios_aplicados: aAplicar.length,
        plantillas_creadas: plan.plantillasNuevas.map((p) => p.nombre),
        resumen: plan.resumen
    };
}

module.exports = {
    previsualizarMalla,
    aplicarMalla,
    plantillaMallaExcel,
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla,
    asignarMasivo,
    consultarHorarios,
    actualizarAsignacion,
    eliminarAsignacion
};
