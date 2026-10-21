/**
 * Backfill: crea el usuario de la pantalla gris de AsisLock (usuario y clave inicial = cédula,
 * cambio obligatorio en el primer ingreso) de cada ficha vigente que todavía no lo tiene, y
 * encola su aviso de alta a AsisLock (asistencia.md §31). Requiere la migración 071.
 *
 * Los empleados nuevos ya no lo necesitan: el usuario se crea solo al registrarlos
 * (UserCompany.crearEnConexion). Este script es para los que ya estaban registrados.
 *
 * Se salta las fichas retiradas o sin contrato y las cédulas que ya son el usuario de otra ficha
 * (se reportan para resolver a mano).
 *
 *   node scripts/crearUsuariosPantallaGris.js            (simulación: no crea nada)
 *   node scripts/crearUsuariosPantallaGris.js --aplicar  (crea los usuarios y encola los avisos)
 *
 * Es seguro de re-ejecutar: una ficha que ya tiene usuario nunca se toca.
 */

const db = require('../config/db');
const usuarioRepo = require('../repositories/asistencia/usuarioPantallaGrisRepository');
const pantallaGrisService = require('../services/asistencia/pantallaGrisService');
const { pantallaGris } = require('../domain/asistencia');

const APLICAR = process.argv.includes('--aplicar');

async function crear(ficha) {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        const r = await pantallaGrisService.crearEnConexion(conn, {
            usersCompanyId: ficha.users_company_id,
            cedula: ficha.cedula,
            nombre: ficha.nombre
        });
        await conn.commit();
        return r;
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

(async () => {
    try {
        const fichas = await usuarioRepo.findFichasSinUsuario();
        const resumen = { creados: [], retiradas: [], sinCedula: [], ocupados: [] };

        for (const f of fichas) {
            if (!pantallaGris.contratoVigente(f.estado_contrato)) { resumen.retiradas.push(f); continue; }
            if (!f.cedula) { resumen.sinCedula.push(f); continue; }
            if (!APLICAR) { resumen.creados.push(f); continue; }

            const r = await crear(f);
            if (r.creado) resumen.creados.push(f);
            else if (r.motivo === 'usuario_ocupado') resumen.ocupados.push(f);
            else if (r.motivo === 'sin_cedula') resumen.sinCedula.push(f);
        }

        console.log(APLICAR ? '=== Usuarios de pantalla gris creados ===' : '=== SIMULACIÓN (usa --aplicar para crear) ===');
        console.log(`${APLICAR ? 'Creados' : 'Se crearían'}: ${resumen.creados.length}`);
        console.log(`Saltadas por retiro o sin contrato: ${resumen.retiradas.length}`);
        console.log(`Sin cédula: ${resumen.sinCedula.length}`);
        if (resumen.ocupados.length > 0) {
            console.log(`Cédula ya usada por otra ficha (resolver a mano): ${resumen.ocupados.length}`);
            for (const f of resumen.ocupados) console.log(`  ficha ${f.users_company_id} · ${f.cedula} · ${f.nombre}`);
        }
        if (APLICAR && resumen.creados.length > 0) {
            console.log('Los avisos de alta quedaron en asislock_envio_saliente; salen con scripts/despacharEnviosAsislock.js.');
        }
        process.exitCode = 0;
    } catch (error) {
        console.error('Error:', error.message);
        if (error.code === 'ER_NO_SUCH_TABLE') console.error('Falta la migración 071. Aplícala antes de correr este script.');
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
