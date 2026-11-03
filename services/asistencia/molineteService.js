const db = require('../../config/db');
const { configurado } = require('../../config/molinete');
const origenRepo = require('../../repositories/asistencia/molineteOrigenRepository');
const marcacionRepo = require('../../repositories/asistencia/molineteMarcacionRepository');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const horaExtraRepo = require('../../repositories/asistencia/horaExtraRepository');
const parametroRepo = require('../../repositories/asistencia/parametroRepository');
const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const { asislock, molinete } = require('../../domain/asistencia');
const { calcularEstadoConDatos, construirTotales } = require('./jornadaCalculo');
const notificacionService = require('./notificacionService');
const { fechaLaboral, combinarFechaHora, textoBogotaAInstante, instanteATextoBogota } = require('../../utils/fechaBogota');

// Molinete (ZKBioSecurity) → asistencia del staff (asistencia.md §54). El backend lee la base del
// molinete cada pocos segundos (no hay forma de que el molinete avise: la base es de un tercero y
// el usuario es de solo consulta) y cada marcación nueva entra a la jornada en su propia
// transacción, igual que un aviso de AsisLock. Con el aviso por socket, el monitor del empleado
// arranca segundos después de poner la huella.

const LOTE = 500;
const MAX_INTENTOS_POR_CARRERA = 2;
const PARAMETROS_DEFECTO = { molinete_intervalo_seg: 2, molinete_solape_seg: 120 };

async function parametros(conn = db) {
    return {
        ...asislock.PARAMETROS_DEFECTO,
        ...PARAMETROS_DEFECTO,
        ...(await parametroRepo.obtener(conn))
    };
}

async function procesarEnTransaccion(fila, ahora) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        if (await marcacionRepo.existeParaActualizar(fila.unique_key, conn)) {
            await conn.commit();
            return { resultado: 'duplicado' };
        }

        const instante = textoBogotaAInstante(fila.event_time);
        const sentido = molinete.sentidoDeLector(fila.lector);
        const copia = {
            uniqueKey: fila.unique_key,
            pin: fila.pin ? String(fila.pin).slice(0, 30) : null,
            cedula: asislock.normalizarCedula(fila.cedula)?.slice(0, 30) ?? null,
            departamento: fila.departamento ? String(fila.departamento).trim().slice(0, 60) : null,
            lector: fila.lector ? String(fila.lector).slice(0, 60) : null,
            sentido,
            ocurridoEn: instante,
            registradoEnOrigen: textoBogotaAInstante(fila.create_time),
            usersCompanyId: null,
            jornadaId: null,
            accion: null,
            motivo: null
        };
        const finalizar = async (resultado, extra = {}) => {
            await marcacionRepo.guardar({ ...copia, ...extra, resultado }, conn);
            await conn.commit();
            return { resultado, accion: extra.accion ?? null, motivo: extra.motivo ?? null };
        };

        if (!instante) return finalizar('rechazado', { motivo: 'hora_invalida' });
        const params = await parametros(conn);
        const motivoHora = asislock.motivoRechazoHora(instante, ahora, params);
        if (motivoHora) return finalizar('rechazado', { motivo: motivoHora });

        const empleados = copia.cedula ? await empleadoRepo.findPorNumeroIdentificacion(copia.cedula, conn) : [];
        if (empleados.length === 0) return finalizar('rechazado', { motivo: 'empleado_no_encontrado' });
        if (empleados.length > 1) return finalizar('rechazado', { motivo: 'cedula_ambigua' });
        const usersCompanyId = empleados[0];

        const fecha = fechaLaboral(instante);
        let jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, fecha, conn);
        const eventos = jornada ? await eventoRepo.findByJornada(jornada.idjornada, conn) : [];
        const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha, conn);
        const horasExtraAprobadas = await horaExtraRepo.findAprobadasPorEmpleadoYFecha(usersCompanyId, fecha, conn);

        const decision = molinete.decidirMarcacion({ eventos, horario, instante, sentido, fecha, horasExtraAprobadas, parametros: params });
        if (!decision.accion) {
            return finalizar('ignorado', { usersCompanyId, jornadaId: jornada?.idjornada ?? null, motivo: decision.motivo });
        }
        if (decision.eventos.length === 0) {
            // Cruce intermedio: queda en la copia (cuenta para la trazabilidad), sin tocar la jornada.
            return finalizar('registrado', { usersCompanyId, jornadaId: jornada?.idjornada ?? null, accion: decision.accion, motivo: decision.motivo });
        }

        if (!jornada) {
            // Si otra pasada crea la misma jornada a la vez, choca con uq_jornada_empleado_fecha y
            // se reintenta (procesar).
            const idjornada = await jornadaRepo.crear(
                { usersCompanyId, fecha, horarioAsignadoId: horario?.idhorario_asignado ?? null },
                conn
            );
            jornada = { idjornada };
        }

        for (const tipo of decision.eventos) {
            await eventoRepo.insertar({
                jornadaId: jornada.idjornada,
                tipo,
                origen: 'molinete',
                nota: `Molinete ${copia.lector ?? ''}`.trim().slice(0, 255),
                ip: null,
                userAgent: 'Molinete',
                ocurridoEn: instante
            }, conn);
        }

        const { estadoCalculado, eventos: actualizados } = await calcularEstadoConDatos(usersCompanyId, fecha, jornada.idjornada, ahora, conn);
        await jornadaRepo.actualizarTotales(jornada.idjornada, construirTotales(estadoCalculado, actualizados), conn);

        const respuesta = await finalizar('registrado', { usersCompanyId, jornadaId: jornada.idjornada, accion: decision.accion });
        notificacionService.notificarCambioJornada(usersCompanyId, decision.eventos[decision.eventos.length - 1], { origen: 'molinete' });
        return respuesta;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function procesar(fila, ahora) {
    for (let intento = 1; ; intento++) {
        try {
            return await procesarEnTransaccion(fila, ahora);
        } catch (error) {
            // Otra pasada creó la misma jornada o la misma marcación a la vez: al reintentar, la
            // fila ya existe y la idempotencia resuelve.
            const carrera = error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK';
            if (carrera && intento < MAX_INTENTOS_POR_CARRERA) continue;
            throw error;
        }
    }
}

/**
 * Una pasada: trae del molinete lo registrado desde la última marcación copiada (menos el solape)
 * y lo procesa en orden cronológico. La primera vez, sin nada copiado, arranca en el inicio del día
 * de hoy: el histórico del molinete no se importa.
 * @returns {{ leidas: number, resultados: Object }}
 */
async function sincronizar(ahora = new Date()) {
    if (!configurado) return { leidas: 0, resultados: {}, apagado: true };
    const params = await parametros();
    const ultimo = await marcacionRepo.ultimoRegistradoEnOrigen();
    const desde = ultimo
        ? new Date(new Date(ultimo).getTime() - params.molinete_solape_seg * 1000)
        : combinarFechaHora(fechaLaboral(ahora), '00:00:00');

    const filas = await origenRepo.findDesde(instanteATextoBogota(desde), molinete.departamentosDe(params.molinete_departamentos), LOTE);
    // Un mismo envío puede traer marcaciones de un equipo que entregó tarde: se aplican por la hora
    // de la marcación, no por la de llegada.
    filas.sort((a, b) => a.event_time.localeCompare(b.event_time) || a.create_time.localeCompare(b.create_time));

    const resultados = {};
    for (const fila of filas) {
        try {
            const { resultado, accion } = await procesar(fila, ahora);
            const clave = accion ? `${resultado}:${accion}` : resultado;
            resultados[clave] = (resultados[clave] || 0) + 1;
        } catch (error) {
            // Una marcación con problemas no frena a las demás; se reintenta en la siguiente pasada
            // porque no quedó copiada.
            console.error(`[molinete] Error procesando ${fila.unique_key}:`, error.message);
            resultados.error = (resultados.error || 0) + 1;
        }
    }
    return { leidas: filas.length, resultados };
}

let temporizador = null;

/**
 * Lectura continua dentro del proceso del backend. Cada pasada espera a que termine la anterior
 * (setTimeout, no setInterval). Un error de conexión se registra y se reintenta más espaciado.
 */
function iniciar() {
    if (!configurado || temporizador) return false;
    let fallasSeguidas = 0;
    const pasada = async () => {
        let intervalo = PARAMETROS_DEFECTO.molinete_intervalo_seg;
        try {
            intervalo = (await parametros()).molinete_intervalo_seg;
            const { leidas, resultados } = await sincronizar();
            if (fallasSeguidas > 0) console.log('[molinete] Conexión recuperada');
            fallasSeguidas = 0;
            // El solape relee las últimas en cada pasada: solo se registra cuando hubo algo nuevo.
            const { duplicado = 0, ...nuevas } = resultados;
            if (leidas > duplicado) console.log('[molinete]', JSON.stringify(nuevas));
        } catch (error) {
            fallasSeguidas++;
            if (fallasSeguidas === 1 || fallasSeguidas % 60 === 0) {
                console.error(`[molinete] Error en la lectura (${fallasSeguidas} seguidas):`, error.message);
            }
        }
        // Tras fallas seguidas se espacia hasta 1 minuto para no insistir contra un servidor caído.
        const espera = fallasSeguidas > 0 ? Math.min(60, intervalo * 2 ** Math.min(fallasSeguidas, 4)) : intervalo;
        temporizador = setTimeout(pasada, espera * 1000);
    };
    temporizador = setTimeout(pasada, 0);
    return true;
}

function detener() {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
}

/** Verificación de la conexión (scripts/sincronizarMolinete.js --verificar). */
async function verificar() {
    if (!configurado) return { configurado: false };
    return { configurado: true, ...(await origenRepo.probar()) };
}

module.exports = { sincronizar, iniciar, detener, verificar, configurado };
