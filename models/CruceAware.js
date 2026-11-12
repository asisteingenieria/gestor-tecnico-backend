const db = require('../config/db');

class CruceAware {
    // Cada ficha con el estado, campaña y cargo de su último contrato (la misma regla de "contrato
    // vigente" que SELECT_EMPLEADO en models/UserCompany.js). Solo lo que necesita el cruce con Aware:
    // cédula y nombre, nada más de la ficha.
    static async listarEmpleados() {
        const [rows] = await db.query(`
            SELECT uc.id,
                   uc.numero_identificacion AS cedula,
                   CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido) AS nombre,
                   esc.nombre AS estado,
                   cam.nombre AS campania,
                   car.nombre AS cargo
              FROM users_company uc
              LEFT JOIN contrato c ON c.idcontrato = (
                    SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = uc.id)
              LEFT JOIN estado_contrato esc ON c.estado_contrato_idestado_contrato = esc.idestado_contrato
              LEFT JOIN campania cam ON c.campania_idcampania = cam.idcampania
              LEFT JOIN cargo car ON c.cargo_idcargo = car.idcargo
        `);
        return rows;
    }
}

module.exports = CruceAware;
