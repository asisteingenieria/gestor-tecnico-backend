class AppError extends Error {
    constructor(message, statusCode = 400, codigo = 'ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.codigo = codigo;
    }
}

class NoAutorizadoError extends AppError {
    constructor(message = 'No autorizado') {
        super(message, 403, 'NO_AUTORIZADO');
    }
}

class NoEncontradoError extends AppError {
    constructor(message = 'No encontrado') {
        super(message, 404, 'NO_ENCONTRADO');
    }
}

class ConflictoJornadaError extends AppError {
    constructor(message = 'Conflicto de jornada') {
        super(message, 409, 'CONFLICTO_JORNADA');
    }
}

class ReglaAsistenciaError extends AppError {
    constructor(message = 'Regla de asistencia violada') {
        super(message, 422, 'REGLA_ASISTENCIA');
    }
}

class ValidacionError extends AppError {
    constructor(message = 'Datos inválidos', detalles = []) {
        super(message, 400, 'VALIDACION');
        this.detalles = detalles;
    }
}

module.exports = {
    AppError,
    NoAutorizadoError,
    NoEncontradoError,
    ConflictoJornadaError,
    ReglaAsistenciaError,
    ValidacionError
};
