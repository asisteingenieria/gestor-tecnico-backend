// Catálogo de cargos que administra RRHH (claude/modulo recursoshumanos.md §61). Puro: sin base de datos.
//
// Un cargo tiene nombre, código SSFF opcional y sus referencias: en qué clientes se usa y con qué sueldo.
// Las referencias (`salario_referencia`) no son un adorno: el formulario de empleados filtra los cargos por
// cliente con ellas (AgentForm.jsx, utils/catalogosRRHH.js del frontend), así que un cargo sin referencia
// para un cliente no aparece al elegir ese cliente (salvo clientes que no tienen ninguna referencia).

const { normalizar, similitud } = require('./homologacionCatalogos');

const MAX_NOMBRE = 80; // cargo.nombre VARCHAR(80)
const MAX_CODIGO = 45; // cargo.codigo_ssff VARCHAR(45)
const SALARIO_MAX = 999999999.99; // DECIMAL(12,2)
// Desde este parecido se avisa antes de crear o renombrar (mismo umbral que la homologación del cargue).
const UMBRAL_PARECIDO = 0.8;

/** Nombre como se guarda: sin espacios de más y en mayúsculas, como el resto del catálogo. */
function nombreCargo(valor) {
    return String(valor ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Valida el cuerpo de crear/editar. Devuelve `{ errores, datos }`; `datos` solo sirve si no hay errores.
 * referencias: [{ cliente_id, salario }]; el salario en pesos, se aceptan "1.423.500" o "1423500".
 */
function validarCargo(body = {}) {
    const errores = [];
    const nombre = nombreCargo(body.nombre);
    if (!nombre) errores.push('El nombre del cargo es obligatorio');
    else if (nombre.length > MAX_NOMBRE) errores.push(`El nombre admite hasta ${MAX_NOMBRE} caracteres`);

    const codigo = String(body.codigo_ssff ?? '').trim();
    if (codigo.length > MAX_CODIGO) errores.push(`El código SSFF admite hasta ${MAX_CODIGO} caracteres`);

    const crudas = Array.isArray(body.referencias) ? body.referencias : [];
    const referencias = [];
    const vistas = new Set();
    crudas.forEach((r, i) => {
        const n = i + 1;
        const clienteId = Number(r?.cliente_id);
        const salario = aNumero(r?.salario);
        if (!Number.isInteger(clienteId) || clienteId <= 0) { errores.push(`Referencia ${n}: elige el cliente`); return; }
        if (salario == null || salario <= 0) { errores.push(`Referencia ${n}: el sueldo debe ser mayor que cero`); return; }
        if (salario > SALARIO_MAX) { errores.push(`Referencia ${n}: el sueldo es demasiado alto`); return; }
        const clave = `${clienteId}|${salario}`;
        if (vistas.has(clave)) { errores.push(`Referencia ${n}: ese cliente con ese sueldo ya está en la lista`); return; }
        vistas.add(clave);
        referencias.push({ cliente_id: clienteId, salario });
    });

    return { errores, datos: { nombre, codigo_ssff: codigo || null, referencias } };
}

function aNumero(valor) {
    if (valor == null || valor === '') return null;
    if (typeof valor === 'number') return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : null;
    // "1.423.500" / "1,423,500" / "$ 1.423.500" → 1423500. Los centavos no se usan en estos sueldos.
    const limpio = String(valor).replace(/[^\d]/g, '');
    if (!limpio) return null;
    return Number(limpio);
}

/**
 * Compara `nombre` con los cargos existentes (excepto `excluirId`, el que se edita).
 * `igual`: uno con el mismo nombre sin tildes, signos ni mayúsculas → no se permite.
 * `parecidos`: nombres muy parecidos → se avisa y se pide confirmar.
 */
function compararConCatalogo(nombre, cargos, excluirId = null) {
    const clave = normalizar(nombre);
    const otros = cargos.filter((c) => Number(c.id) !== Number(excluirId));
    const igual = otros.find((c) => normalizar(c.nombre) === clave) || null;
    const parecidos = igual ? [] : otros
        .map((c) => ({ id: c.id, nombre: c.nombre, puntaje: similitud(nombre, c.nombre) }))
        .filter((c) => c.puntaje >= UMBRAL_PARECIDO)
        .sort((a, b) => b.puntaje - a.puntaje)
        .slice(0, 3);
    return { igual, parecidos };
}

module.exports = { nombreCargo, validarCargo, compararConCatalogo, aNumero };
