const db = require('../../config/db');
const jornadaRepo = require('../../repositories/asistencia/jornadaRepository');
const eventoRepo = require('../../repositories/asistencia/jornadaEventoRepository');
const horarioRepo = require('../../repositories/asistencia/horarioAsignadoRepository');
const parametroRepo = require('../../repositories/asistencia/parametroRepository');
const empleadoRepo = require('../../repositories/asistencia/empleadoRepository');
const registroRepo = require('../../repositories/asistencia/asislockRegistroRepository');
const loginBiometricoRepo = require('../../repositories/asistencia/loginBiometricoRepository');
const { asislock } = require('../../domain/asistencia');
const { calcularEstadoConDatos, construirTotales } = require('./jornadaCalculo');
const notificacionService = require('./notificacionService');

// Integración AsisLock → asistencia (asistencia.md §18). Cada login/logout se procesa en su
// propia transacción: un registro con problemas no frena a los demás del mismo envío.

const MAX_INTENTOS_POR_CARRERA = 2;

// estado_conexion es VARCHAR(20) en AsisLock; si llega como número se guarda como texto.
const textoONulo = (v) => (v === undefined || v === null ? null : String(v));

/** Fila de login_biometrico tal como la tiene AsisLock (copia de la migración 064). */
function datosCopia(registro) {
    return {
        llave: asislock.llaveSesion(registro),
        asislockId: registro.id ?? null,
        usuario: String(registro.usuario ?? '').slice(0, 20),
        fecha: registro.fecha,
        horaLogin: asislock.normalizarHora(registro.hora_login),
        horaLogout: asislock.normalizarHora(registro.hora_logout),
        estadoConexion: textoONulo(registro.estado_conexion),
        ipLocal: registro.ip_local ?? null,
        ipPublica: registro.ip_publica ?? null,
        aplicativo: registro.aplicativo ?? null,
        conectadoBiometrico: registro.conectado_biometrico ?? null
    };
}

/**
 * Guarda la sesión en login_biometrico. Un logout sin id ni hora_login (sistemas que no envían
 * id) no trae con qué identificar su sesión: cierra la sesión abierta de esa cédula ese día, o
 * queda como fila solo con logout si no hay ninguna.
 */
async function guardarCopia(registro) {
    const copia = datosCopia(registro);
    if (registro.id || registro.hora_login || !copia.horaLogout) return loginBiometricoRepo.guardar(copia);

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        if (!(await loginBiometricoRepo.existeLogout(copia.usuario, copia.fecha, copia.horaLogout, conn))) {
            const abierta = await loginBiometricoRepo.findSesionAbiertaParaActualizar(copia.usuario, copia.fecha, copia.horaLogout, conn);
            if (abierta) await loginBiometricoRepo.cerrarSesion(abierta.idlogin_biometrico, copia, conn);
            else await loginBiometricoRepo.guardar(copia, conn);
        }
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

function datosBitacora(registro, evento, hora) {
    return {
        llave: asislock.llaveEvento(registro, evento),
        asislockId: registro.id ?? null,
        evento,
        usuario: String(registro.usuario ?? '').slice(0, 20),
        fechaReportada: registro.fecha ?? null,
        horaReportada: hora ?? null,
        estadoConexion: textoONulo(registro.estado_conexion),
        ipLocal: registro.ip_local ?? null,
        ipPublica: registro.ip_publica ?? null,
        aplicativo: registro.aplicativo ?? null,
        conectadoBiometrico: registro.conectado_biometrico ?? null
    };
}

async function procesarEventoEnTransaccion({ registro, evento, hora, instante, fecha, ahora }) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const bitacora = datosBitacora(registro, evento, hora);

        const previo = await registroRepo.findParaActualizar(bitacora.llave, evento, conn);
        if (previo && previo.resultado !== 'rechazado') {
            await conn.commit();
            return { resultado: 'duplicado', accion: previo.accion, motivo: previo.motivo };
        }

        const finalizar = async (resultado, extra = {}) => {
            await registroRepo.guardar({
                ...bitacora,
                ocurridoEn: instante,
                usersCompanyId: null,
                jornadaId: null,
                accion: null,
                motivo: null,
                ...extra,
                resultado
            }, conn);
            await conn.commit();
            return { resultado, accion: extra.accion ?? null, motivo: extra.motivo ?? null };
        };

        if (!fecha) return finalizar('rechazado', { motivo: 'fecha_invalida' });
        if (!instante) return finalizar('rechazado', { motivo: 'hora_invalida' });

        const parametros = { ...asislock.PARAMETROS_DEFECTO, ...(await parametroRepo.obtener(conn)) };
        const motivoHora = asislock.motivoRechazoHora(instante, ahora, parametros);
        if (motivoHora) return finalizar('rechazado', { motivo: motivoHora });

        const cedula = asislock.normalizarCedula(registro.usuario);
        const empleados = cedula ? await empleadoRepo.findPorNumeroIdentificacion(cedula, conn) : [];
        if (empleados.length === 0) return finalizar('rechazado', { motivo: 'empleado_no_encontrado' });
        if (empleados.length > 1) return finalizar('rechazado', { motivo: 'cedula_ambigua' });
        const usersCompanyId = empleados[0];

        let jornada = await jornadaRepo.findHoyParaActualizar(usersCompanyId, fecha, conn);
        const eventos = jornada ? await eventoRepo.findByJornada(jornada.idjornada, conn) : [];
        const horario = await horarioRepo.findByEmpleadoYFecha(usersCompanyId, fecha, conn);

        const decision = evento === 'login'
            ? asislock.decidirLogin({ eventos, instante })
            : asislock.decidirLogout({ eventos, horario, instante, parametros });

        if (!decision.accion) {
            return finalizar('ignorado', { usersCompanyId, jornadaId: jornada?.idjornada ?? null, motivo: decision.motivo });
        }

        if (!jornada) {
            // Si otra petición crea la misma jornada a la vez, el INSERT choca con
            // uq_jornada_empleado_fecha: se reintenta el evento completo (ver procesarEvento).
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
                origen: 'asislock',
                nota: `AsisLock ${registro.id ? `registro #${registro.id}` : `(sin id, cédula ${registro.usuario})`}${registro.aplicativo ? ` (${String(registro.aplicativo).slice(0, 80)})` : ''}`,
                ip: (registro.ip_publica || registro.ip_local || null)?.slice(0, 45) ?? null,
                userAgent: 'AsisLock',
                ocurridoEn: instante
            }, conn);
        }

        const { estadoCalculado, eventos: eventosActualizados } = await calcularEstadoConDatos(usersCompanyId, fecha, jornada.idjornada, ahora, conn);
        await jornadaRepo.actualizarTotales(jornada.idjornada, construirTotales(estadoCalculado, eventosActualizados), conn);

        const respuesta = await finalizar('registrado', { usersCompanyId, jornadaId: jornada.idjornada, accion: decision.accion });
        notificacionService.notificarDirector(usersCompanyId, decision.eventos[decision.eventos.length - 1], { origen: 'asislock' });
        return respuesta;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

async function procesarEvento(datos) {
    for (let intento = 1; ; intento++) {
        try {
            return await procesarEventoEnTransaccion(datos);
        } catch (error) {
            // ER_DUP_ENTRY: otra petición creó la misma jornada o el mismo registro a la vez.
            // ER_LOCK_DEADLOCK: dos reenvíos simultáneos del mismo registro (FOR UPDATE sobre
            // una fila que aún no existe toma un gap lock). En ambos casos, al reintentar, la
            // fila ya existe y el flujo normal (idempotencia) resuelve.
            const carrera = error.code === 'ER_DUP_ENTRY' || error.code === 'ER_LOCK_DEADLOCK';
            if (carrera && intento < MAX_INTENTOS_POR_CARRERA) continue;
            throw error;
        }
    }
}

/**
 * Procesa un envío de AsisLock. Los eventos (login y logout de todos los registros) se
 * aplican en orden cronológico, para que un envío con varios registros del mismo empleado
 * no dependa del orden en que vinieron en el arreglo.
 * @returns {Array} un resultado por registro, en el orden recibido
 */
async function recibirRegistros(registros) {
    const ahora = new Date();
    // La copia se guarda siempre, aunque después el login/logout se rechace o se ignore.
    for (const registro of registros) await guardarCopia(registro);

    const pendientes = [];
    const resultados = registros.map((registro) => {
        const instantes = asislock.instantesDelRegistro(registro);
        const fila = { id: registro.id ?? null, usuario: String(registro.usuario ?? ''), login: null, logout: null };
        for (const evento of ['login', 'logout']) {
            const hora = registro[`hora_${evento}`];
            if (hora === undefined || hora === null || hora === '') continue;
            pendientes.push({
                fila,
                datos: {
                    registro,
                    evento,
                    hora,
                    fecha: instantes?.fecha ?? null,
                    instante: instantes ? instantes[evento] : null,
                    ahora
                }
            });
        }
        return fila;
    });

    const orden = { login: 0, logout: 1 };
    pendientes.sort((a, b) => (a.datos.instante?.getTime() ?? 0) - (b.datos.instante?.getTime() ?? 0)
        || orden[a.datos.evento] - orden[b.datos.evento]);

    for (const { fila, datos } of pendientes) {
        fila[datos.evento] = await procesarEvento(datos);
    }
    return resultados;
}

module.exports = { recibirRegistros };
