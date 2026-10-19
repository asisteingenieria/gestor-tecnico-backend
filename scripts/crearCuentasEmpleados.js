/**
 * Backfill: crea el usuario de empleado de cada ficha de RRHH vigente que todavía no tiene
 * cuenta vinculada (asistencia.md §19, migración 063). Usuario y contraseña inicial = cédula,
 * con cambio de contraseña obligatorio en el primer ingreso.
 *
 * Los empleados nuevos ya no necesitan esto: la cuenta se crea sola al registrarlos
 * (UserCompany.crearEnConexion). Este script es para los que ya estaban registrados.
 *
 * Se salta:
 *   - fichas que ya tienen una cuenta vinculada (empleado, director_operaciones o RRHH);
 *   - fichas retiradas (contrato más reciente 'retirado' o 'inactivo') o sin contrato;
 *   - cédulas que ya son el usuario de otra cuenta (se reportan para resolver a mano).
 *
 * Por defecto SOLO SIMULA y muestra qué haría. Para crear las cuentas:
 *   node scripts/crearCuentasEmpleados.js            (simulación)
 *   node scripts/crearCuentasEmpleados.js --aplicar  (crea las cuentas)
 *
 * Es seguro de re-ejecutar: una ficha que ya tiene cuenta nunca se toca.
 */

const db = require('../config/db');
const User = require('../models/User');

const APLICAR = process.argv.includes('--aplicar');

(async () => {
    try {
        const [columna] = await db.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'debe_cambiar_password'"
        );
        if (columna.length === 0) {
            console.error('Falta la migración 063 (users.debe_cambiar_password). Aplícala antes de correr este script.');
            process.exit(1);
        }

        const [fichas] = await db.query(
            `SELECT uc.id, uc.numero_identificacion, uc.nombre_propio,
                    TRIM(CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido)) AS nombre_completo,
                    (SELECT ec.nombre
                       FROM contrato c
                       JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
                      WHERE c.users_company_id = uc.id
                      ORDER BY c.idcontrato DESC LIMIT 1) AS estado_contrato,
                    u.id AS cuenta_id, u.username AS cuenta_username, u.role AS cuenta_role
               FROM users_company uc
               LEFT JOIN users u ON u.users_company_id = uc.id
              ORDER BY uc.id`
        );

        const resumen = { creadas: [], yaTenian: [], retiradas: [], usuarioOcupado: [], sinCedula: [] };

        for (const f of fichas) {
            const nombre = f.nombre_propio || f.nombre_completo;
            if (f.cuenta_id) { resumen.yaTenian.push(f); continue; }
            if (!f.estado_contrato || ['retirado', 'inactivo'].includes(f.estado_contrato)) { resumen.retiradas.push(f); continue; }

            if (!APLICAR) {
                const cedula = String(f.numero_identificacion ?? '').trim();
                if (!cedula) { resumen.sinCedula.push(f); continue; }
                const [ocupado] = await db.query('SELECT username, role FROM users WHERE username = ? LIMIT 1', [cedula]);
                if (ocupado.length > 0) { resumen.usuarioOcupado.push({ ...f, ocupadoPor: ocupado[0].role }); continue; }
                resumen.creadas.push(f);
                continue;
            }

            const r = await User.crearCuentaEmpleadoEnConexion(db, { usersCompanyId: f.id, cedula: f.numero_identificacion, nombre });
            if (r.creada) resumen.creadas.push(f);
            else if (r.motivo === 'usuario_ocupado') resumen.usuarioOcupado.push(f);
            else if (r.motivo === 'sin_cedula') resumen.sinCedula.push(f);
            else resumen.yaTenian.push(f);
        }

        console.log(APLICAR ? '\n== Cuentas de empleado creadas ==' : '\n== SIMULACIÓN (no se creó nada; usa --aplicar) ==');
        console.log(`  ${APLICAR ? 'Creadas' : 'Se crearían'}: ${resumen.creadas.length}`);
        console.log(`  Ya tenían cuenta vinculada: ${resumen.yaTenian.length}`);
        const porRol = {};
        for (const f of resumen.yaTenian) porRol[f.cuenta_role ?? '?'] = (porRol[f.cuenta_role ?? '?'] ?? 0) + 1;
        for (const [rol, n] of Object.entries(porRol)) console.log(`    - ${rol}: ${n}`);
        console.log(`  Retiradas o sin contrato (sin cuenta): ${resumen.retiradas.length}`);

        if (resumen.usuarioOcupado.length > 0) {
            console.log(`\n  ! La cédula ya es el usuario de otra cuenta (${resumen.usuarioOcupado.length}), resolver a mano:`);
            for (const f of resumen.usuarioOcupado) console.log(`    - ficha ${f.id} · ${f.nombre_propio || f.nombre_completo} · CC ${f.numero_identificacion}`);
        }
        if (resumen.sinCedula.length > 0) {
            console.log(`\n  ! Fichas sin número de identificación (${resumen.sinCedula.length}):`);
            for (const f of resumen.sinCedula) console.log(`    - ficha ${f.id} · ${f.nombre_propio || f.nombre_completo}`);
        }
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
})();
