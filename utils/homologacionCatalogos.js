// Homologación de catálogos en el cargue masivo de empleados: cuando un valor del Excel no
// coincide exacto con ningún nombre del catálogo, se toma el más parecido si es claramente ese
// ("AGENTE DE CALL CENTER" → "AGENTE CALL CENTER"); si no, el cargue se rechaza (§45).
// Puro: sin base de datos, para poder probarlo solo.

function normalizar(s) {
    if (!s) return '';
    return String(s)
        .replace(/\([^)]*\)/g, '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

// Palabras sin tildes ni signos, para comparar por palabras completas.
const palabras = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

function bigramas(s) {
    const lista = [];
    for (let i = 0; i < s.length - 1; i++) lista.push(s.slice(i, i + 2));
    return lista;
}

/** Parecido entre 0 y 1: coeficiente de Dice sobre bigramas, con bono si uno contiene al otro. */
function similitud(a, b) {
    const x = normalizar(a);
    const y = normalizar(b);
    if (!x || !y) return 0;
    if (x === y) return 1;
    const bx = bigramas(x);
    const by = bigramas(y);
    if (bx.length === 0 || by.length === 0) return 0;
    const restantes = [...by];
    let comunes = 0;
    for (const g of bx) {
        const i = restantes.indexOf(g);
        if (i !== -1) { comunes++; restantes.splice(i, 1); }
    }
    let puntaje = (2 * comunes) / (bx.length + by.length);
    // "AGENTE CALL" dentro de "AGENTE CALL CENTER", o todas las palabras de uno en el otro.
    const px = palabras(a);
    const py = palabras(b);
    const todasEn = (p, q) => p.length > 0 && p.every(w => q.includes(w));
    if (x.includes(y) || y.includes(x) || todasEn(px, py) || todasEn(py, px)) puntaje = Math.max(puntaje, 0.75);
    return Math.round(puntaje * 100) / 100;
}

/**
 * Los `limite` nombres del catálogo más parecidos a `valor`, con su puntaje, de mayor a menor.
 * Descarta los muy lejanos (< `minimo`).
 */
function sugerencias(valor, filas, { limite = 3, minimo = 0.3 } = {}) {
    return filas
        .map(f => ({ id: f.id, nombre: f.nombre, puntaje: similitud(valor, f.nombre) }))
        .filter(s => s.puntaje >= minimo)
        .sort((a, b) => b.puntaje - a.puntaje || a.nombre.localeCompare(b.nombre))
        .slice(0, limite);
}

// Para tomar el más parecido: puntaje mínimo y ventaja mínima sobre el segundo, para no elegir a
// ciegas entre dos nombres casi iguales.
const UMBRAL = 0.8;
const VENTAJA = 0.1;

// Los números tienen que ser los mismos: "OLD 142" no es "OLD 141" ni "CBAT 2" es "CBAT 1".
const numeros = (s) => (String(s || '').match(/\d+/g) || []).map(Number).join(',');

/**
 * El nombre del catálogo que corresponde a `valor`, o null si ninguno es claramente ese. Solo se usa
 * cuando no hubo coincidencia exacta (sin tildes, signos ni mayúsculas).
 */
function homologar(valor, filas) {
    const [primero, segundo] = sugerencias(valor, filas, { limite: 2, minimo: 0 });
    if (!primero || primero.puntaje < UMBRAL) return null;
    if (segundo && primero.puntaje - segundo.puntaje < VENTAJA) return null;
    if (numeros(valor) !== numeros(primero.nombre)) return null;
    return primero;
}

module.exports = { normalizar, similitud, sugerencias, homologar };
