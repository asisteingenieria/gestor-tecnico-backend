const db = require('../config/db');

// Catálogo de cargos que administra RRHH (claude/modulo recursoshumanos.md §61): el cargo y sus
// referencias por cliente (`salario_referencia`), que filtran el cargo por cliente en el formulario.
class Cargo {
    /** Todos los cargos con cuántos contratos los usan (activos y en total) y sus referencias por cliente. */
    static async listar() {
        const [cargos] = await db.query(`
            SELECT c.idcargo AS id, c.nombre, c.codigo_ssff,
                   (SELECT COUNT(*) FROM contrato k WHERE k.cargo_idcargo = c.idcargo) AS contratos_total,
                   (SELECT COUNT(*) FROM contrato k
                      JOIN estado_contrato ec ON ec.idestado_contrato = k.estado_contrato_idestado_contrato
                     WHERE k.cargo_idcargo = c.idcargo AND ec.nombre = 'activo') AS contratos_activos,
                   (SELECT COUNT(*) FROM traspaso t WHERE t.cargo_anterior_id = c.idcargo OR t.cargo_nuevo_id = c.idcargo) AS traspasos
            FROM cargo c
            ORDER BY c.nombre
        `);
        const [refs] = await db.query(`
            SELECT sr.idsalario_referencia AS id, sr.cargo_idcargo AS cargo_id, sr.Cliente_idCliente AS cliente_id,
                   cli.nombre AS cliente_nombre, sr.salario
            FROM salario_referencia sr
            JOIN cliente cli ON cli.idCliente = sr.Cliente_idCliente
            ORDER BY cli.nombre, sr.salario
        `);
        const porCargo = new Map();
        for (const r of refs) {
            if (!porCargo.has(r.cargo_id)) porCargo.set(r.cargo_id, []);
            porCargo.get(r.cargo_id).push({ id: r.id, cliente_id: r.cliente_id, cliente_nombre: r.cliente_nombre, salario: Number(r.salario) });
        }
        return cargos.map((c) => ({
            ...c,
            contratos_total: Number(c.contratos_total),
            contratos_activos: Number(c.contratos_activos),
            traspasos: Number(c.traspasos),
            referencias: porCargo.get(c.id) || []
        }));
    }

    static async listarNombres() {
        const [rows] = await db.query('SELECT idcargo AS id, nombre FROM cargo');
        return rows;
    }

    static async getById(id) {
        const [rows] = await db.query('SELECT idcargo AS id, nombre, codigo_ssff FROM cargo WHERE idcargo = ?', [id]);
        return rows[0] || null;
    }

    static async clientes() {
        const [rows] = await db.query('SELECT idCliente AS id, nombre FROM cliente ORDER BY nombre');
        return rows;
    }

    /** Ids de cliente que existen, para validar las referencias. */
    static async clientesExistentes(ids) {
        if (!ids.length) return new Set();
        const [rows] = await db.query('SELECT idCliente AS id FROM cliente WHERE idCliente IN (?)', [ids]);
        return new Set(rows.map((r) => r.id));
    }

    static async crear({ nombre, codigo_ssff, referencias }) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            const [res] = await conn.query('INSERT INTO cargo (nombre, codigo_ssff) VALUES (?, ?)', [nombre, codigo_ssff]);
            await Cargo.reemplazarReferencias(conn, res.insertId, referencias);
            await conn.commit();
            return res.insertId;
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    static async actualizar(id, { nombre, codigo_ssff, referencias }) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('UPDATE cargo SET nombre = ?, codigo_ssff = ? WHERE idcargo = ?', [nombre, codigo_ssff, id]);
            await Cargo.reemplazarReferencias(conn, id, referencias);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }

    // Las referencias del cargo son la lista que manda RRHH: se reemplazan completas.
    static async reemplazarReferencias(conn, cargoId, referencias) {
        await conn.query('DELETE FROM salario_referencia WHERE cargo_idcargo = ?', [cargoId]);
        for (const r of referencias) {
            await conn.query(
                'INSERT INTO salario_referencia (Cliente_idCliente, cargo_idcargo, salario) VALUES (?, ?, ?)',
                [r.cliente_id, cargoId, r.salario]
            );
        }
    }

    /**
     * Borra el cargo y sus referencias, solo si ningún contrato ni traspaso lo usa (las llaves foráneas
     * de `contrato` y `traspaso` lo impiden de todos modos; el controlador lo revisa antes para avisar).
     */
    static async eliminar(id) {
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM salario_referencia WHERE cargo_idcargo = ?', [id]);
            await conn.query('DELETE FROM cargo WHERE idcargo = ?', [id]);
            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    }
}

module.exports = Cargo;
