/**
 * Reporte de jefaturas en Excel (claude/modulo recursoshumanos.md §51): por cada empleado vigente, su jefe
 * inmediato, jefe de área, director de área, gestor de asistencia y QUIÉN SUBE SU HORARIO, con alertas para
 * revisar la jefatura antes de repartir las mallas.
 *
 * Quién sube el horario = gestor de asistencia si lo tiene, si no el jefe de área: la misma regla con la que
 * asistencia decide el equipo directo (GESTOR en repositories/asistencia/equipoRepository.js, asistencia.md §44).
 *
 * Puro: recibe las filas de UserCompany.getJefaturas() y devuelve las hojas; `generarLibro` las escribe con xlsx.
 */

const ESTADOS_VIGENTES = ['activo', 'periodo_prueba'];

const vigente = (estado) => ESTADOS_VIGENTES.includes(estado);
const esDirector = (cargo) => /^\s*DIRECTOR/i.test(cargo || '');

/** Persona de la jefatura (prefijo ji/ja/da/ga) o null si no hay. */
function persona(fila, prefijo) {
    if (!fila[`${prefijo}_id`]) return null;
    return {
        id: fila[`${prefijo}_id`],
        cedula: fila[`${prefijo}_cedula`] || '',
        nombre: (fila[`${prefijo}_nombre`] || '').trim(),
        cargo: fila[`${prefijo}_cargo`] || '',
        estado: fila[`${prefijo}_estado`] || ''
    };
}

const nombreDe = (p) => (p ? p.nombre : '');
const fechaDia = (f) => {
    if (!f) return '';
    if (f instanceof Date) return Number.isNaN(f.getTime()) ? '' : f.toISOString().slice(0, 10);
    return String(f).slice(0, 10);
};

/** Alertas de la jefatura de un empleado, en el orden en que conviene revisarlas. */
function alertasDe(fila, jefes) {
    const { ji, ja, sube } = jefes;
    const alertas = [];
    if (!sube) alertas.push('Nadie puede subirle el horario (sin jefe de área ni gestor)');
    else {
        if (sube.id === fila.id) alertas.push('Se sube el horario a sí mismo');
        if (!vigente(sube.estado)) alertas.push('Quien sube el horario no está vigente');
        if (esDirector(sube.cargo)) alertas.push('Le sube el horario un director');
    }
    if (!ji) alertas.push('Sin jefe inmediato');
    else if (!vigente(ji.estado)) alertas.push('Jefe inmediato no vigente');
    if (ja && !vigente(ja.estado)) alertas.push('Jefe de área no vigente');
    return alertas;
}

/**
 * @param {Array<Object>} filas  UserCompany.getJefaturas()
 * @returns {{ empleados: Array<Object>, porQuienSube: Array<Object> }} filas de las dos hojas, con los
 *          encabezados en español como claves.
 */
function armarReporteJefaturas(filas) {
    const empleados = [];
    const grupos = new Map();

    for (const fila of filas || []) {
        const ji = persona(fila, 'ji');
        const ja = persona(fila, 'ja');
        const da = persona(fila, 'da');
        const ga = persona(fila, 'ga');
        const sube = ga || ja;
        const alertas = alertasDe(fila, { ji, ja, sube });

        empleados.push({
            'Cédula': fila.cedula || '',
            'Nombre': (fila.nombre || '').trim(),
            'Cargo': fila.cargo || '',
            'Campaña': fila.campania || '',
            'Centro de costo': fila.centro_costo || '',
            'Estado contrato': fila.estado_contrato || '',
            'Fecha ingreso': fechaDia(fila.fecha_ingreso),
            'Jefe inmediato': nombreDe(ji),
            'Cargo jefe inmediato': ji ? ji.cargo : '',
            'Jefe de área': nombreDe(ja),
            'Cargo jefe de área': ja ? ja.cargo : '',
            'Director de área': nombreDe(da),
            'Gestor de asistencia': nombreDe(ga),
            'SUBE EL HORARIO': nombreDe(sube),
            'Cédula de quien sube': sube ? sube.cedula : '',
            'Cargo de quien sube': sube ? sube.cargo : '',
            'Sube por': ga ? 'Gestor de asistencia' : (ja ? 'Jefe de área' : ''),
            'Alertas': alertas.join('; ')
        });

        const clave = sube ? sube.id : 0;
        if (!grupos.has(clave)) {
            grupos.set(clave, {
                'SUBE EL HORARIO': sube ? sube.nombre : '(nadie)',
                'Cédula': sube ? sube.cedula : '',
                'Cargo': sube ? sube.cargo : '',
                'Es director': sube && esDirector(sube.cargo) ? 'Sí' : '',
                'Empleados': 0,
                'Campañas': new Set()
            });
        }
        const g = grupos.get(clave);
        g['Empleados'] += 1;
        if (fila.campania) g['Campañas'].add(fila.campania);
    }

    const porQuienSube = [...grupos.values()]
        .map((g) => ({ ...g, 'Campañas': [...g['Campañas']].sort().join(', ') }))
        .sort((a, b) => b['Empleados'] - a['Empleados'] || a['SUBE EL HORARIO'].localeCompare(b['SUBE EL HORARIO']));

    return { empleados, porQuienSube };
}

const ANCHOS = { 'Nombre': 36, 'Jefe inmediato': 32, 'Jefe de área': 32, 'Director de área': 32, 'Gestor de asistencia': 32, 'SUBE EL HORARIO': 32, 'Alertas': 60, 'Campañas': 60 };

/** Escribe el libro .xlsx y devuelve el Buffer. */
function generarLibro({ empleados, porQuienSube }, XLSX = require('xlsx')) {
    const libro = XLSX.utils.book_new();
    const hoja = (filas, encabezados) => {
        const ws = XLSX.utils.json_to_sheet(filas, { header: encabezados });
        ws['!cols'] = encabezados.map((h) => ({ wch: ANCHOS[h] || Math.max(12, h.length + 2) }));
        ws['!autofilter'] = { ref: ws['!ref'] };
        return ws;
    };
    const encEmpleados = empleados.length ? Object.keys(empleados[0]) : ['Cédula', 'Nombre'];
    const encGrupos = ['SUBE EL HORARIO', 'Cédula', 'Cargo', 'Es director', 'Empleados', 'Campañas'];
    XLSX.utils.book_append_sheet(libro, hoja(empleados, encEmpleados), 'Empleados');
    XLSX.utils.book_append_sheet(libro, hoja(porQuienSube, encGrupos), 'Por quien sube');
    return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { armarReporteJefaturas, generarLibro, alertasDe, esDirector };
