// Clave de un grupo sanguíneo (RH) para comparar el valor de un archivo con el catálogo
// `grupo_sanguineo` (O+, O-, A+, A-, B+, B-, AB+, AB-).
//
// No se puede usar la normalización general de los catálogos (que deja solo letras y números):
// borra el signo y "O+" y "O-" quedan iguales. Así se guardaron como negativos los RH positivos de
// los cargues masivos hasta el 2026-11-12 (claude/modulo recursoshumanos.md §54).
//
// Acepta: "O+", "o +", "O POSITIVO", "O POS", "ORH+", "O RH+", "0+" (cero por O), "AB NEGATIVO"...
// Devuelve "O+", "AB-", etc., o null si no es un grupo reconocible.
function claveGrupoSanguineo(valor) {
    if (valor === null || valor === undefined) return null;
    let t = String(valor)
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/RH/g, '')
        .replace(/POSITIVO|POS/g, '+')
        .replace(/NEGATIVO|NEG/g, '-')
        .replace(/[−–—]/g, '-'); // guiones tipográficos de Excel/Word
    const m = t.match(/^(AB|A|B|O|0)([+-])$/);
    if (!m) return null;
    return `${m[1] === '0' ? 'O' : m[1]}${m[2]}`;
}

module.exports = { claveGrupoSanguineo };
