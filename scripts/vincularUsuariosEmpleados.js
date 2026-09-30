/**
 * Backfill: vincula users.users_company_id con la ficha de RRHH correspondiente,
 * cruzando por nombre completo (ver asistencia.md §5, migración 043).
 *
 * Requiere que la migración 043 ya se haya aplicado (columna users_company_id existente).
 * Es seguro de re-ejecutar: solo toca usuarios con users_company_id NULL y nunca
 * sobreescribe un vínculo ya hecho. Los que no encuentran match único quedan reportados
 * para resolverlos a mano.
 *
 *   node scripts/vincularUsuariosEmpleados.js
 */

const db = require('../config/db');

function normalizar(nombre) {
    return (nombre || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

(async () => {
    try {
        const [usuarios] = await db.query(
            "SELECT id, username, full_name FROM users WHERE users_company_id IS NULL AND role != 'anonimo'"
        );

        const [empleados] = await db.query(
            `SELECT uc.id, uc.numero_identificacion, uc.nombre_propio
             FROM users_company uc
             WHERE uc.id NOT IN (
                 SELECT users_company_id FROM users WHERE users_company_id IS NOT NULL
             )`
        );

        const porNombre = new Map();
        for (const empleado of empleados) {
            const clave = normalizar(empleado.nombre_propio);
            if (!porNombre.has(clave)) porNombre.set(clave, []);
            porNombre.get(clave).push(empleado);
        }

        const vinculados = [];
        const ambiguos = [];
        const sinMatch = [];

        for (const usuario of usuarios) {
            const candidatos = porNombre.get(normalizar(usuario.full_name)) || [];

            if (candidatos.length === 1) {
                await db.query('UPDATE users SET users_company_id = ? WHERE id = ?', [candidatos[0].id, usuario.id]);
                vinculados.push({
                    usuario: usuario.username,
                    full_name: usuario.full_name,
                    users_company_id: candidatos[0].id,
                    cedula: candidatos[0].numero_identificacion
                });
            } else if (candidatos.length > 1) {
                ambiguos.push({ usuario: usuario.username, full_name: usuario.full_name, candidatos: candidatos.map(c => c.id).join(',') });
            } else {
                sinMatch.push({ usuario: usuario.username, full_name: usuario.full_name });
            }
        }

        console.log(`\n== Vinculados automáticamente (${vinculados.length}) ==`);
        console.table(vinculados);

        console.log(`\n== Ambiguos: mismo nombre en varias fichas de RRHH, resolver a mano (${ambiguos.length}) ==`);
        console.table(ambiguos);

        console.log(`\n== Sin ficha de RRHH con ese nombre, resolver a mano (${sinMatch.length}) ==`);
        console.table(sinMatch);

        process.exit(0);
    } catch (error) {
        console.error('\nError al vincular usuarios con empleados:', error.message);
        process.exit(1);
    }
})();
