const Cargo = require('../models/Cargo');
const { validarCargo, compararConCatalogo } = require('../utils/cargosCatalogo');

// Catálogo de cargos para RRHH y financiera (claude/modulo recursoshumanos.md §61): crear, editar sus
// referencias por cliente y eliminar los que nadie usa. Rutas en routes/usersCompany.js (/cargos).

/** Revisa el cuerpo y que el nombre no repita otro cargo. Responde el error y devuelve null si algo falla. */
async function prepararCargo(req, res, excluirId = null) {
    const { errores, datos } = validarCargo(req.body);
    if (errores.length) {
        res.status(400).json({ success: false, message: errores.join('. '), errores });
        return null;
    }
    const existentes = await Cargo.clientesExistentes([...new Set(datos.referencias.map((r) => r.cliente_id))]);
    const faltante = datos.referencias.find((r) => !existentes.has(r.cliente_id));
    if (faltante) {
        res.status(400).json({ success: false, message: 'Uno de los clientes elegidos no existe' });
        return null;
    }
    const { igual, parecidos } = compararConCatalogo(datos.nombre, await Cargo.listarNombres(), excluirId);
    if (igual) {
        res.status(409).json({ success: false, codigo: 'CARGO_REPETIDO', message: `Ya existe el cargo "${igual.nombre}"` });
        return null;
    }
    // Un nombre muy parecido a otro casi siempre es el mismo cargo mal escrito: se pide confirmar.
    if (parecidos.length && !req.body.confirmar_parecido) {
        res.status(409).json({
            success: false,
            codigo: 'CARGO_PARECIDO',
            message: `Ya existe un cargo parecido: ${parecidos.map((p) => `"${p.nombre}"`).join(', ')}`,
            parecidos
        });
        return null;
    }
    return datos;
}

const cargoController = {
    async listar(req, res) {
        try {
            const [cargos, clientes] = await Promise.all([Cargo.listar(), Cargo.clientes()]);
            res.json({ success: true, cargos, clientes });
        } catch (error) {
            console.error('Error al listar cargos:', error);
            res.status(500).json({ success: false, message: 'Error al listar los cargos' });
        }
    },

    async crear(req, res) {
        try {
            const datos = await prepararCargo(req, res);
            if (!datos) return;
            const id = await Cargo.crear(datos);
            res.status(201).json({ success: true, id, message: `Cargo "${datos.nombre}" creado` });
        } catch (error) {
            console.error('Error al crear cargo:', error);
            res.status(500).json({ success: false, message: 'Error al crear el cargo' });
        }
    },

    async actualizar(req, res) {
        try {
            const id = Number(req.params.cargoId);
            const actual = await Cargo.getById(id);
            if (!actual) return res.status(404).json({ success: false, message: 'Cargo no encontrado' });
            const datos = await prepararCargo(req, res, id);
            if (!datos) return;
            // La pantalla no edita el código SSFF (solo nombre, clientes y sueldo): si no viene, se conserva.
            if (!Object.prototype.hasOwnProperty.call(req.body, 'codigo_ssff')) datos.codigo_ssff = actual.codigo_ssff;
            await Cargo.actualizar(id, datos);
            res.json({ success: true, message: `Cargo "${datos.nombre}" actualizado` });
        } catch (error) {
            console.error('Error al actualizar cargo:', error);
            res.status(500).json({ success: false, message: 'Error al actualizar el cargo' });
        }
    },

    async eliminar(req, res) {
        try {
            const id = Number(req.params.cargoId);
            const cargo = (await Cargo.listar()).find((c) => c.id === id);
            if (!cargo) return res.status(404).json({ success: false, message: 'Cargo no encontrado' });
            if (cargo.contratos_total > 0 || cargo.traspasos > 0) {
                const usos = [
                    cargo.contratos_total ? `${cargo.contratos_total} contrato${cargo.contratos_total === 1 ? '' : 's'}` : null,
                    cargo.traspasos ? `${cargo.traspasos} traspaso${cargo.traspasos === 1 ? '' : 's'}` : null
                ].filter(Boolean).join(' y ');
                return res.status(409).json({
                    success: false,
                    codigo: 'CARGO_EN_USO',
                    message: `No se puede eliminar "${cargo.nombre}": lo usan ${usos}. Puedes renombrarlo o cambiar el cargo de esos empleados.`
                });
            }
            await Cargo.eliminar(id);
            res.json({ success: true, message: `Cargo "${cargo.nombre}" eliminado` });
        } catch (error) {
            if (error.code === 'ER_ROW_IS_REFERENCED_2') {
                return res.status(409).json({ success: false, codigo: 'CARGO_EN_USO', message: 'No se puede eliminar: el cargo está en uso' });
            }
            console.error('Error al eliminar cargo:', error);
            res.status(500).json({ success: false, message: 'Error al eliminar el cargo' });
        }
    }
};

module.exports = cargoController;
