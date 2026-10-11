// Acceso por ruta ("contrato.cargo_id") a `datos_empleado`, el borrador con la forma
// del body de POST /api/users-company. Puro: nunca muta la entrada.

function obtener(objeto, ruta) {
    return ruta.split('.').reduce((actual, clave) => (actual == null ? undefined : actual[clave]), objeto);
}

function asignar(objeto, ruta, valor) {
    const claves = ruta.split('.');
    const ultima = claves.pop();
    let actual = objeto;
    for (const clave of claves) {
        if (actual[clave] == null || typeof actual[clave] !== 'object') actual[clave] = {};
        actual = actual[clave];
    }
    actual[ultima] = valor;
    return objeto;
}

// Mismo criterio que `val()` de models/UserCompany.js: '' y undefined cuentan como vacío.
function estaVacio(valor) {
    return valor === undefined || valor === null || (typeof valor === 'string' && valor.trim() === '');
}

module.exports = { obtener, asignar, estaVacio };
