/**
 * Cierre nocturno de asistencia (asistencia.md §10): cierra con una salida de origen='sistema'
 * las jornadas del día que quedaron sin marcar salida, y crea jornadas 'ausente' para quienes
 * tenían horario asignado y nunca marcaron entrada. Pensado para correr por cron a las 23:30
 * hora Bogotá (04:30 UTC). No reimplementa nada: delega todo en cierreService.
 *
 *   node scripts/cerrarJornadasDelDia.js
 */
const db = require('../config/db');
const cierreService = require('../services/asistencia/cierreService');
const { fechaLaboral } = require('../utils/fechaBogota');

async function empleadosActivos() {
    const [filas] = await db.query(
        `SELECT DISTINCT uc.id
         FROM users_company uc
         JOIN contrato c ON c.users_company_id = uc.id
         JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
         WHERE ec.nombre IN ('activo', 'periodo_prueba')`
    );
    return filas.map((f) => f.id);
}

(async () => {
    try {
        const ahora = new Date();
        const fecha = fechaLaboral(ahora);
        const empleados = await empleadosActivos();

        console.log(`Cerrando jornadas de ${fecha} para ${empleados.length} empleados activos...`);

        let cerradas = 0;
        let ausentes = 0;
        for (const usersCompanyId of empleados) {
            const resultado = await cierreService.normalizarJornada(usersCompanyId, fecha, ahora);
            if (!resultado) continue;
            if (resultado.estado === 'ausente') ausentes += 1;
            else cerradas += 1;
        }

        console.log(`Listo: ${cerradas} jornada(s) cerrada(s) automáticamente, ${ausentes} marcada(s) ausente.`);
        process.exit(0);
    } catch (error) {
        console.error('Error en el cierre nocturno de asistencia:', error.message);
        process.exit(1);
    }
})();
