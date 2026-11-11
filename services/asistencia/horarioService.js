const db = require('../../config/db');
const horarioPlantillaRepo = require('../../repositories/asistencia/horarioPlantillaRepository');
const horarioAsignadoRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const equipoRepo = require('../../repositories/asistencia/equipoRepository');
const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const equipoService = require('./equipoService');
const notificacionService = require('./notificacionService');
const mallaHorarios = require('../../domain/asistencia/mallaHorarios');
const { fechaLaboral } = require('../../utils/fechaBogota');
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

async function consultarHorarios({ directorUsersCompanyId, empleadoId, desde, hasta }) {
    requireUsersCompanyId(directorUsersCompanyId);
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
    const cedulasRrhh = new Set(await empleadoRepo.findNumerosExistentes(cedulas));

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
    const plan = mallaHorarios.planificar({ registros: lectura.registros, hoy, equipo, cedulasRrhh, existentes, plantillas });
    return { lectura, plan, hoy };
}

// Personas omitidas (no están a cargo / no existen en RRHH), una línea por persona.
function omitidosPorPersona(filas) {
    const porCedula = new Map();
    for (const f of filas) {
        if (f.estado !== 'no_a_cargo' && f.estado !== 'no_encontrado') continue;
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
        resumen: { ...plan.resumen, errores: lectura.errores.length },
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
    listarPlantillas,
    crearPlantilla,
    actualizarPlantilla,
    eliminarPlantilla,
    asignarMasivo,
    consultarHorarios,
    actualizarAsignacion,
    eliminarAsignacion
};
