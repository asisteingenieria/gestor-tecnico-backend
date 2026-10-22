const iniciarPausaSchema = {
    body: { tipo: { requerido: true, enum: ['bano', 'almuerzo'] } }
};

const trazabilidadParamsSchema = {
    params: { fecha: { requerido: true, tipo: 'fecha' } }
};

const rangoQuerySchema = {
    query: {
        desde: { tipo: 'fecha' },
        hasta: { tipo: 'fecha' }
    }
};

// Las 5 clases del formato V.3. Ya no las elige el agente: el servidor clasifica la franja
// (migración 074). Se usan al asignar (el jefe sí elige) y al ajustar tramos al aprobar.
const CLASES_HORA_EXTRA = ['recargo_nocturno', 'extras_diurnas', 'extras_nocturnas', 'dominicales_festivas', 'extras_dominicales_festivas'];

// El agente ingresa la franja (fecha + hora inicio/fin); la clase la determina el servidor.
const solicitarHoraExtraSchema = {
    body: {
        fecha: { requerido: true, tipo: 'fecha' },
        hora_inicio: { requerido: true, tipo: 'hora' },
        hora_fin: { requerido: true, tipo: 'hora' },
        motivo: { tipo: 'texto' }
    }
};

// Previsualización de la clasificación antes de enviar (no guarda nada).
const previsualizarHoraExtraSchema = {
    body: {
        fecha: { requerido: true, tipo: 'fecha' },
        hora_inicio: { requerido: true, tipo: 'hora' },
        hora_fin: { requerido: true, tipo: 'hora' }
    }
};

const misHorasExtraQuerySchema = {
    query: { estado: { enum: ['pendiente', 'aprobada', 'rechazada', 'cancelada'] } }
};

const idParamSchema = {
    params: { id: { requerido: true, tipo: 'entero' } }
};

const empleadoIdParamSchema = {
    params: { empleadoId: { requerido: true, tipo: 'entero' } }
};

const trazabilidadEquipoParamsSchema = {
    params: {
        empleadoId: { requerido: true, tipo: 'entero' },
        fecha: { requerido: true, tipo: 'fecha' }
    }
};

const crearPlantillaSchema = {
    body: {
        nombre: { requerido: true, tipo: 'texto' },
        hora_entrada: { requerido: true, tipo: 'texto' },
        hora_salida: { requerido: true, tipo: 'texto' },
        minutos_almuerzo: { tipo: 'entero' },
        hora_almuerzo_inicio: { tipo: 'texto' },
        tolerancia_entrada_min: { tipo: 'entero' }
    }
};

const actualizarPlantillaSchema = {
    params: { id: { requerido: true, tipo: 'entero' } },
    body: {
        nombre: { tipo: 'texto' },
        hora_entrada: { tipo: 'texto' },
        hora_salida: { tipo: 'texto' },
        minutos_almuerzo: { tipo: 'entero' },
        hora_almuerzo_inicio: { tipo: 'texto' },
        tolerancia_entrada_min: { tipo: 'entero' }
    }
};

const consultarHorariosQuerySchema = {
    query: {
        empleadoId: { tipo: 'entero' },
        desde: { tipo: 'fecha' },
        hasta: { tipo: 'fecha' }
    }
};

const asignarHorarioSchema = {
    body: {
        empleados: { requerido: true, tipo: 'array', minimo: 1 },
        desde: { requerido: true, tipo: 'fecha' },
        hasta: { requerido: true, tipo: 'fecha' },
        dias_semana: { tipo: 'array', valores: [1, 2, 3, 4, 5, 6, 7] },
        plantilla_id: { tipo: 'entero' },
        hora_entrada: { tipo: 'texto' },
        hora_salida: { tipo: 'texto' }
    }
};

const actualizarAsignacionSchema = {
    params: { id: { requerido: true, tipo: 'entero' } },
    body: {
        hora_entrada: { tipo: 'texto' },
        hora_salida: { tipo: 'texto' },
        minutos_almuerzo: { tipo: 'entero' },
        hora_almuerzo_inicio: { tipo: 'texto' },
        tolerancia_entrada_min: { tipo: 'entero' },
        es_descanso: { tipo: 'booleano' },
        notas: { tipo: 'texto' }
    }
};

const bandejaHorasExtraQuerySchema = {
    query: { estado: { enum: ['pendiente', 'aprobada', 'rechazada', 'cancelada'] } }
};

// Al aprobar, el jefe puede ajustar la clasificación mandando `tramos` [{clase, minutos}]. Si no
// los manda, se quedan los que calculó el servidor. El contenido de cada tramo lo valida el servicio.
const aprobarHoraExtraSchema = {
    params: { id: { requerido: true, tipo: 'entero' } },
    body: {
        tramos: { tipo: 'array' },
        comentario: { tipo: 'texto' }
    }
};

const rechazarHoraExtraSchema = {
    params: { id: { requerido: true, tipo: 'entero' } },
    body: { comentario: { tipo: 'texto' } }
};

const asignarHoraExtraSchema = {
    body: {
        empleados: { requerido: true, tipo: 'array', minimo: 1 },
        fecha: { requerido: true, tipo: 'fecha' },
        minutos: { requerido: true, tipo: 'entero' },
        clase: { requerido: true, enum: CLASES_HORA_EXTRA },
        motivo: { tipo: 'texto' }
    }
};

const eventoManualSchema = {
    params: { id: { requerido: true, tipo: 'entero' } },
    body: {
        tipo: {
            requerido: true,
            enum: ['entrada', 'inicio_bano', 'fin_bano', 'inicio_almuerzo', 'fin_almuerzo', 'salida', 'inicio_extra', 'fin_extra']
        },
        nota: { requerido: true, tipo: 'texto' }
    }
};

// Reporte mensual de horas extras (§32). El formato AAAA-MM del periodo y el contenido de cada
// fila los valida el dominio, que da mensajes por empleado.
const periodoQuerySchema = {
    query: { periodo: { requerido: true, tipo: 'texto' } }
};

// Reporte de financiera: el periodo y, opcionalmente, una campaña.
const reporteFinancieraQuerySchema = {
    query: { periodo: { requerido: true, tipo: 'texto' }, campania_id: { tipo: 'entero' } }
};

const empleadosFinancieraQuerySchema = {
    query: { campania_id: { tipo: 'entero' } }
};

const jornadasEmpleadoSchema = {
    params: { empleadoId: { requerido: true, tipo: 'entero' } },
    query: { desde: { tipo: 'fecha' }, hasta: { tipo: 'fecha' } }
};

module.exports = {
    periodoQuerySchema,
    reporteFinancieraQuerySchema,
    empleadosFinancieraQuerySchema,
    jornadasEmpleadoSchema,
    iniciarPausaSchema,
    trazabilidadParamsSchema,
    rangoQuerySchema,
    solicitarHoraExtraSchema,
    previsualizarHoraExtraSchema,
    misHorasExtraQuerySchema,
    idParamSchema,
    empleadoIdParamSchema,
    trazabilidadEquipoParamsSchema,
    crearPlantillaSchema,
    actualizarPlantillaSchema,
    consultarHorariosQuerySchema,
    asignarHorarioSchema,
    actualizarAsignacionSchema,
    bandejaHorasExtraQuerySchema,
    aprobarHoraExtraSchema,
    rechazarHoraExtraSchema,
    asignarHoraExtraSchema,
    eventoManualSchema
};
