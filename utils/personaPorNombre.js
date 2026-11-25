// Busca a un empleado por el nombre escrito en el Excel de cargue (jefe inmediato, jefe de área, director,
// analista encargado). Puro: recibe la lista de empleados (claude/modulo recursoshumanos.md §61).
//
// Antes solo valía el nombre completo exacto, con las mismas tildes: "ANGIE GISETHE RODRIGUEZ" no encontraba
// a "Angie Gisethe Rodriguez Franco" y el contrato quedaba sin analista. Ahora, en orden:
//   1. nombre completo igual, sin tildes ni mayúsculas;
//   2. el nombre del Excel está contenido en el de una ficha (todas sus palabras, al menos dos, en el mismo
//      orden): "ANGIE GISETHE RODRIGUEZ" → "ANGIE GISETHE RODRIGUEZ FRANCO". Si hay varias fichas así, se
//      prefieren las activas; si aun así hay más de una, no se adivina: queda ambiguo y se avisa;
//   3. también se acepta la cédula en la columna.

const palabras = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9Ñ]+/)
    .filter(Boolean);

/** ¿Están todas las palabras de `buscadas`, en orden (no necesariamente seguidas), dentro de `nombre`? */
function contenidasEnOrden(buscadas, nombre) {
    let i = 0;
    for (const p of nombre) {
        if (p === buscadas[i]) i++;
        if (i === buscadas.length) return true;
    }
    return false;
}

/**
 * empleados: [{ id, nombre_completo, cedula, activo }]. Devuelve una función buscar(texto) →
 * `{ id }` | `{ ambiguos: [nombres] }` | null.
 */
function crearBuscador(empleados) {
    const filas = empleados.map((e) => ({
        id: e.id,
        nombre: e.nombre_completo,
        palabras: palabras(e.nombre_completo),
        clave: palabras(e.nombre_completo).join(' '),
        cedula: String(e.cedula ?? '').replace(/\D/g, ''),
        activo: Boolean(e.activo)
    }));

    const elegir = (candidatos) => {
        if (candidatos.length === 1) return { id: candidatos[0].id };
        const activos = candidatos.filter((c) => c.activo);
        if (activos.length === 1) return { id: activos[0].id };
        if (candidatos.length > 1) return { ambiguos: (activos.length ? activos : candidatos).map((c) => c.nombre) };
        return null;
    };

    return function buscar(texto) {
        const buscadas = palabras(texto);
        if (!buscadas.length) return null;

        const soloDigitos = String(texto).replace(/\D/g, '');
        if (buscadas.length === 1 && soloDigitos.length >= 6 && soloDigitos === buscadas[0]) {
            return elegir(filas.filter((f) => f.cedula === soloDigitos));
        }

        const exactos = filas.filter((f) => f.clave === buscadas.join(' '));
        if (exactos.length) return elegir(exactos);

        if (buscadas.length < 2) return null;
        return elegir(filas.filter((f) => contenidasEnOrden(buscadas, f.palabras)));
    };
}

module.exports = { crearBuscador, palabras };
