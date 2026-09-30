const db = require('../../config/db');

// Requiere una conexión activa: solo tiene sentido dentro de una transacción.
async function findHoyParaActualizar(usersCompanyId, fecha, conn) {
    const [filas] = await conn.query(
        'SELECT * FROM jornada WHERE users_company_id = ? AND fecha = ? FOR UPDATE',
        [usersCompanyId, fecha]
    );
    return filas[0] ?? null;
}

// Requiere una conexión activa: solo tiene sentido dentro de una transacción.
async function findByIdParaActualizar(idjornada, conn) {
    const [filas] = await conn.query('SELECT * FROM jornada WHERE idjornada = ? FOR UPDATE', [idjornada]);
    return filas[0] ?? null;
}

async function findPorFecha(usersCompanyId, fecha, conn = db) {
    const [filas] = await conn.query(
        'SELECT * FROM jornada WHERE users_company_id = ? AND fecha = ?',
        [usersCompanyId, fecha]
    );
    return filas[0] ?? null;
}

async function findRango(usersCompanyId, desde, hasta, conn = db) {
    const [filas] = await conn.query(
        'SELECT * FROM jornada WHERE users_company_id = ? AND fecha BETWEEN ? AND ? ORDER BY fecha',
        [usersCompanyId, desde, hasta]
    );
    return filas;
}

async function crear({ usersCompanyId, fecha, horarioAsignadoId }, conn) {
    const [resultado] = await conn.query(
        "INSERT INTO jornada (users_company_id, fecha, horario_asignado_id, estado) VALUES (?, ?, ?, 'pendiente')",
        [usersCompanyId, fecha, horarioAsignadoId]
    );
    return resultado.insertId;
}

async function actualizarTotales(idjornada, totales, conn) {
    await conn.query(
        `UPDATE jornada SET
            estado = ?,
            hora_entrada_real = ?,
            hora_salida_real = ?,
            minutos_tarde = ?,
            minutos_trabajados = ?,
            minutos_pausa_bano = ?,
            minutos_pausa_almuerzo = ?,
            minutos_extra = ?,
            minutos_salida_anticipada = ?,
            desviacion_almuerzo_min = ?
         WHERE idjornada = ?`,
        [
            totales.estado,
            totales.horaEntradaReal,
            totales.horaSalidaReal,
            totales.minutosTarde,
            totales.minutosTrabajados,
            totales.minutosPausaBano,
            totales.minutosPausaAlmuerzo,
            totales.minutosExtra,
            totales.minutosSalidaAnticipada,
            totales.desviacionAlmuerzoMin,
            idjornada
        ]
    );
}

async function marcarCerradaAutomaticamente(idjornada, conn = db) {
    await conn.query('UPDATE jornada SET cerrada_automaticamente = 1 WHERE idjornada = ?', [idjornada]);
}

module.exports = {
    findHoyParaActualizar,
    findByIdParaActualizar,
    findPorFecha,
    findRango,
    crear,
    actualizarTotales,
    marcarCerradaAutomaticamente
};
