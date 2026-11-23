/**
 * Listas desplegables (validación de datos) en un .xlsx generado con SheetJS (asistencia.md §75). La edición
 * comunitaria de SheetJS no escribe validaciones, así que se agregan al XML de la hoja dentro del zip ya generado.
 * Lógica pura sobre el buffer, sin E/S.
 */

const escaparXml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// En el XML de la hoja, <dataValidations> va antes de estos elementos (orden del esquema de OOXML).
const DESPUES = ['hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks',
    'customProperties', 'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF',
    'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];

/** XML de las validaciones: [{ rango: 'I2:I500', opciones: [...], titulo, mensaje }]. */
function xmlValidaciones(listas) {
    const items = listas.map(({ rango, opciones, titulo, mensaje }) => {
        const formula = `"${opciones.join(',')}"`;
        if (formula.length > 257) throw new Error('La lista desplegable supera los 255 caracteres que admite Excel');
        const ayuda = titulo || mensaje
            ? ` showInputMessage="1" promptTitle="${escaparXml(titulo ?? '').slice(0, 32)}" prompt="${escaparXml(mensaje ?? '').slice(0, 255)}"`
            : '';
        return `<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Valor no permitido"`
            + ` error="${escaparXml(`Elige una opción de la lista: ${opciones.join(', ')}`).slice(0, 255)}"${ayuda} sqref="${rango}">`
            + `<formula1>${escaparXml(formula)}</formula1></dataValidation>`;
    });
    return `<dataValidations count="${items.length}">${items.join('')}</dataValidations>`;
}

/** Inserta las validaciones en el XML de una hoja, en el lugar que exige el esquema. */
function insertarEnHoja(xml, listas) {
    const bloque = xmlValidaciones(listas);
    for (const etiqueta of DESPUES) {
        const i = xml.indexOf(`<${etiqueta}`);
        if (i >= 0) return xml.slice(0, i) + bloque + xml.slice(i);
    }
    return xml.replace('</worksheet>', `${bloque}</worksheet>`);
}

/**
 * @param {Buffer} buffer   .xlsx generado por XLSX.write
 * @param {number} hoja     número de hoja (1 = la primera)
 * @param {Array}  listas   [{ rango, opciones, titulo?, mensaje? }]
 * @returns {Buffer}
 */
function agregarListas(buffer, hoja, listas, XLSX = require('xlsx')) {
    if (!listas.length) return buffer;
    const zip = XLSX.CFB.read(buffer, { type: 'buffer' });
    const ruta = `/xl/worksheets/sheet${hoja}.xml`;
    const i = zip.FullPaths.findIndex((p) => p.endsWith(ruta));
    if (i < 0) throw new Error(`No se encontró la hoja ${hoja} en el libro`);
    const entrada = zip.FileIndex[i];
    entrada.content = Buffer.from(insertarEnHoja(Buffer.from(entrada.content).toString('utf8'), listas), 'utf8');
    entrada.size = entrada.content.length;
    return Buffer.from(XLSX.CFB.write(zip, { type: 'buffer', fileType: 'zip', compression: true }));
}

module.exports = { agregarListas, insertarEnHoja, xmlValidaciones };
