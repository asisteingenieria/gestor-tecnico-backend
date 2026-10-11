const { ReglaContratacionError } = require('../../errors/AppError');
const { CLAVES_SECCION } = require('./secciones');

// Estados de hydra_candidato y hydra_lote (conexionhydra.md §6.1). Los no terminales se
// DERIVAN de los datos; nunca se asignan a mano.
const ESTADOS_CANDIDATO = ['pendiente', 'listo', 'registrado', 'descartado', 'cancelado_hydra'];
const ESTADOS_CANDIDATO_TERMINALES = ['registrado', 'descartado', 'cancelado_hydra'];
// Candidatos que ya no cuentan para decidir si el lote está listo.
const ESTADOS_CANDIDATO_FUERA_DEL_LOTE = ['descartado', 'cancelado_hydra'];

const ESTADOS_LOTE = ['abierto', 'listo', 'registrado', 'cancelado'];
const ESTADOS_LOTE_TERMINALES = ['registrado', 'cancelado'];

function estadoCandidato(estadoActual, completitud) {
    if (ESTADOS_CANDIDATO_TERMINALES.includes(estadoActual)) return estadoActual;
    return completitud.listo ? 'listo' : 'pendiente';
}

// Un lote está listo cuando le queda al menos un candidato activo y todos los activos
// están listos. Los descartados/cancelados no bloquean ni cuentan.
function estadoLote(estadoActual, estadosCandidatos) {
    if (ESTADOS_LOTE_TERMINALES.includes(estadoActual)) return estadoActual;
    const activos = estadosCandidatos.filter((e) => !ESTADOS_CANDIDATO_FUERA_DEL_LOTE.includes(e));
    return activos.length > 0 && activos.every((e) => e === 'listo') ? 'listo' : 'abierto';
}

function assertCandidatoEditable(estado) {
    if (ESTADOS_CANDIDATO_TERMINALES.includes(estado)) {
        throw new ReglaContratacionError(`El candidato está "${estado}" y ya no se puede modificar`);
    }
}

function assertSeccionValida(clave) {
    if (!CLAVES_SECCION.includes(clave)) {
        throw new ReglaContratacionError(`Sección desconocida: ${clave}`);
    }
}

// El checkbox solo se marca sobre una sección sin problemas.
function assertPuedeVerificar(evaluacionSeccion) {
    if (!evaluacionSeccion.completa) {
        const detalle = evaluacionSeccion.problemas.map((p) => p.mensaje).join('; ');
        throw new ReglaContratacionError(`La sección tiene datos pendientes: ${detalle}`);
    }
}

function assertPuedeDescartar(estado, motivo) {
    assertCandidatoEditable(estado);
    if (typeof motivo !== 'string' || motivo.trim() === '') {
        throw new ReglaContratacionError('Descartar a un candidato exige indicar el motivo');
    }
}

// Hydra puede reenviar datos o cancelar mientras el candidato no esté registrado.
// Reenviar sobre un descartado se permite (puede volver a entrar al proceso).
function assertHydraPuedeActualizar(estado) {
    if (estado === 'registrado') {
        throw new ReglaContratacionError('El candidato ya fue registrado como empleado');
    }
}

function assertLoteRegistrable(estadoLoteActual, estadosCandidatos) {
    if (estadoLoteActual === 'registrado') {
        throw new ReglaContratacionError('El lote ya fue registrado');
    }
    if (estadoLoteActual === 'cancelado') {
        throw new ReglaContratacionError('El lote está cancelado');
    }
    // Se recalcula en vez de confiar en el estado guardado.
    if (estadoLote(estadoLoteActual, estadosCandidatos) !== 'listo') {
        const pendientes = estadosCandidatos.filter((e) => e === 'pendiente').length;
        throw new ReglaContratacionError(
            pendientes > 0
                ? `Hay ${pendientes} candidato(s) con secciones pendientes: complétalos o descártalos`
                : 'El lote no tiene candidatos para registrar'
        );
    }
}

module.exports = {
    ESTADOS_CANDIDATO,
    ESTADOS_LOTE,
    estadoCandidato,
    estadoLote,
    assertCandidatoEditable,
    assertSeccionValida,
    assertPuedeVerificar,
    assertPuedeDescartar,
    assertHydraPuedeActualizar,
    assertLoteRegistrable
};
