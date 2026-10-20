const db = require('../../config/db');

async function findByEmpleadoYFecha(usersCompanyId, fecha, conn = db) {
    const [filas] = await conn.query(
        'SELECT * FROM horario_asignado WHERE users_company_id = ? AND fecha = ?',
        [usersCompanyId, fecha]
    );
    return filas[0] ?? null;
}

async function findRango(usersCompanyId, desde, hasta, conn = db) {
    const [filas] = await conn.query(
        'SELECT * FROM horario_asignado WHERE users_company_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha',
        [usersCompanyId, desde, hasta]
    );
    return filas;
}

async function findById(id, conn = db) {
    const [filas] = await conn.query('SELECT * FROM horario_asignado WHERE idhorario_asignado = ?', [id]);
    return filas[0] ?? null;
}

// Igual que `insertar` pero varias filas por sentencia (asignación masiva: un equipo grande
// por un mes son miles de filas). Mismas columnas y mismo upsert por (users_company_id, fecha).
const LOTE_INSERCION = 500;
async function insertarVarios(filas, conn = db) {
    for (let i = 0; i < filas.length; i += LOTE_INSERCION) {
        const lote = filas.slice(i, i + LOTE_INSERCION);
        await conn.query(
            `INSERT INTO horario_asignado
                (users_company_id, fecha, horario_plantilla_id, hora_entrada, hora_salida, minutos_almuerzo, hora_almuerzo_inicio, tolerancia_entrada_min, es_descanso, creado_por_user_id, creado_por_cuenta_id, notas)
             VALUES ?
             ON DUPLICATE KEY UPDATE
                horario_plantilla_id = VALUES(horario_plantilla_id),
                hora_entrada = VALUES(hora_entrada),
                hora_salida = VALUES(hora_salida),
                minutos_almuerzo = VALUES(minutos_almuerzo),
                hora_almuerzo_inicio = VALUES(hora_almuerzo_inicio),
                tolerancia_entrada_min = VALUES(tolerancia_entrada_min),
                es_descanso = VALUES(es_descanso),
                creado_por_user_id = VALUES(creado_por_user_id),
                creado_por_cuenta_id = VALUES(creado_por_cuenta_id),
                notas = VALUES(notas)`,
            [lote.map((f) => [
                f.usersCompanyId, f.fecha, f.horarioPlantillaId ?? null, f.horaEntrada, f.horaSalida,
                f.minutosAlmuerzo ?? 60, f.horaAlmuerzoInicio ?? null, f.toleranciaEntradaMin ?? 5,
                f.esDescanso ? 1 : 0, f.creadoPor?.userId ?? null, f.creadoPor?.cuentaId ?? null, f.notas ?? null
            ])]
        );
    }
}

// Upsert por (users_company_id, fecha): una reasignación sobre un día ya asignado lo reemplaza.
async function insertar({ usersCompanyId, fecha, horarioPlantillaId, horaEntrada, horaSalida, minutosAlmuerzo, horaAlmuerzoInicio, toleranciaEntradaMin, esDescanso, creadoPor, notas }, conn = db) {
    const [resultado] = await conn.query(
        `INSERT INTO horario_asignado
            (users_company_id, fecha, horario_plantilla_id, hora_entrada, hora_salida, minutos_almuerzo, hora_almuerzo_inicio, tolerancia_entrada_min, es_descanso, creado_por_user_id, creado_por_cuenta_id, notas)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            horario_plantilla_id = VALUES(horario_plantilla_id),
            hora_entrada = VALUES(hora_entrada),
            hora_salida = VALUES(hora_salida),
            minutos_almuerzo = VALUES(minutos_almuerzo),
            hora_almuerzo_inicio = VALUES(hora_almuerzo_inicio),
            tolerancia_entrada_min = VALUES(tolerancia_entrada_min),
            es_descanso = VALUES(es_descanso),
            creado_por_user_id = VALUES(creado_por_user_id),
            creado_por_cuenta_id = VALUES(creado_por_cuenta_id),
            notas = VALUES(notas)`,
        [
            usersCompanyId, fecha, horarioPlantillaId ?? null, horaEntrada, horaSalida,
            minutosAlmuerzo ?? 60, horaAlmuerzoInicio ?? null, toleranciaEntradaMin ?? 5,
            esDescanso ? 1 : 0, creadoPor?.userId ?? null, creadoPor?.cuentaId ?? null, notas ?? null
        ]
    );
    return resultado.insertId || null;
}

async function actualizar(id, campos, conn = db) {
    const asignables = {
        hora_entrada: campos.horaEntrada,
        hora_salida: campos.horaSalida,
        minutos_almuerzo: campos.minutosAlmuerzo,
        hora_almuerzo_inicio: campos.horaAlmuerzoInicio,
        tolerancia_entrada_min: campos.toleranciaEntradaMin,
        es_descanso: campos.esDescanso === undefined ? undefined : (campos.esDescanso ? 1 : 0),
        notas: campos.notas
    };
    const entradas = Object.entries(asignables).filter(([, valor]) => valor !== undefined);
    if (entradas.length === 0) return false;

    const set = entradas.map(([columna]) => `${columna} = ?`).join(', ');
    const valores = entradas.map(([, valor]) => valor);
    const [resultado] = await conn.query(
        `UPDATE horario_asignado SET ${set} WHERE idhorario_asignado = ?`,
        [...valores, id]
    );
    return resultado.affectedRows > 0;
}

async function eliminar(id, conn = db) {
    const [resultado] = await conn.query('DELETE FROM horario_asignado WHERE idhorario_asignado = ?', [id]);
    return resultado.affectedRows > 0;
}

module.exports = { findByEmpleadoYFecha, findRango, findById, insertar, insertarVarios, actualizar, eliminar };
