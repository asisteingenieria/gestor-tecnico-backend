const db = require('../../config/db');

// Plantillas activas de un jefe (dueño = su ficha de RRHH, migración 066).
async function findPorDueno(duenoUsersCompanyId, conn = db) {
    const [filas] = await conn.query(
        'SELECT * FROM horario_plantilla WHERE activo = 1 AND dueno_users_company_id = ? ORDER BY nombre',
        [duenoUsersCompanyId]
    );
    return filas;
}

async function findById(id, conn = db) {
    const [filas] = await conn.query('SELECT * FROM horario_plantilla WHERE idhorario_plantilla = ?', [id]);
    return filas[0] ?? null;
}

async function crear({ nombre, horaEntrada, horaSalida, minutosAlmuerzo, horaAlmuerzoInicio, toleranciaEntradaMin, duenoUsersCompanyId, creadoPor }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO horario_plantilla
            (nombre, hora_entrada, hora_salida, minutos_almuerzo, hora_almuerzo_inicio, tolerancia_entrada_min, dueno_users_company_id, creado_por_user_id, creado_por_cuenta_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            nombre, horaEntrada, horaSalida, minutosAlmuerzo ?? 60, horaAlmuerzoInicio ?? null, toleranciaEntradaMin ?? 5,
            duenoUsersCompanyId, creadoPor?.userId ?? null, creadoPor?.cuentaId ?? null
        ]
    );
    return resultado.insertId;
}

async function actualizar(id, campos, conn = db) {
    const asignables = {
        nombre: campos.nombre,
        hora_entrada: campos.horaEntrada,
        hora_salida: campos.horaSalida,
        minutos_almuerzo: campos.minutosAlmuerzo,
        hora_almuerzo_inicio: campos.horaAlmuerzoInicio,
        tolerancia_entrada_min: campos.toleranciaEntradaMin
    };
    const entradas = Object.entries(asignables).filter(([, valor]) => valor !== undefined);
    if (entradas.length === 0) return false;

    const set = entradas.map(([columna]) => `${columna} = ?`).join(', ');
    const valores = entradas.map(([, valor]) => valor);
    const [resultado] = await conn.query(
        `UPDATE horario_plantilla SET ${set} WHERE idhorario_plantilla = ?`,
        [...valores, id]
    );
    return resultado.affectedRows > 0;
}

async function desactivar(id, conn = db) {
    const [resultado] = await conn.query('UPDATE horario_plantilla SET activo = 0 WHERE idhorario_plantilla = ?', [id]);
    return resultado.affectedRows > 0;
}

module.exports = { findPorDueno, findById, crear, actualizar, desactivar };
