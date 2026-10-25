// Costo de nómina por mes (asistencia.md §38): salarios prorrateados por días, bonos y prestaciones
// sociales (porcentaje sobre el salario básico). Puro: recibe los tramos salariales ya leídos, los
// factores y la fecha de hoy. Las fechas son 'YYYY-MM-DD' de columnas DATE (sin zona horaria).
//
// Convención de nómina en Colombia: mes comercial de 30 días. Un mes completo vale 30 días (también
// febrero); el día 31 no se cuenta; un tramo parcial vale los días que cubre, con su último día del
// mes contado como el 30.

const DIAS_MES_COMERCIAL = 30;

const ultimoDiaDelMes = (periodo) => {
    const [a, m] = periodo.split('-').map(Number);
    return new Date(Date.UTC(a, m, 0)).getUTCDate();
};

/** Días comerciales (0-30) que el tramo [desde, hasta] cubre dentro del mes, sin pasar de `corte`. */
function diasEnMes(tramo, periodo, corte = null) {
    const ultimo = ultimoDiaDelMes(periodo);
    const inicioMes = `${periodo}-01`;
    let finMes = `${periodo}-${String(ultimo).padStart(2, '0')}`;
    if (corte && corte < finMes) finMes = corte;
    const desde = tramo.desde > inicioMes ? tramo.desde : inicioMes;
    const hasta = tramo.hasta < finMes ? tramo.hasta : finMes;
    if (desde > hasta) return 0;
    const diaIni = Math.min(Number(desde.slice(8, 10)), DIAS_MES_COMERCIAL);
    const diaFinCalendario = Number(hasta.slice(8, 10));
    const diaFin = diaFinCalendario === ultimo ? DIAS_MES_COMERCIAL : Math.min(diaFinCalendario, DIAS_MES_COMERCIAL);
    return Math.max(0, diaFin - diaIni + 1);
}

const sumaVacia = () => ({ salarios: 0, bonos: 0, empleados: new Set() });

/**
 * Costo de un mes. `corte` (opcional) limita el cálculo hasta ese día: es lo causado a la fecha.
 * Devuelve totales, el detalle de cada prestación y el desglose por campaña.
 */
function costoDelMes(tramos, factores, periodo, { corte = null } = {}) {
    const total = sumaVacia();
    const porCampania = new Map();
    for (const t of tramos) {
        const dias = diasEnMes(t, periodo, corte);
        if (dias === 0) continue;
        const proporcion = dias / DIAS_MES_COMERCIAL;
        const salario = (Number(t.salario) || 0) * proporcion;
        const bonos = (Number(t.bonos) || 0) * proporcion;
        const clave = t.idcampania ?? 'sin';
        if (!porCampania.has(clave)) porCampania.set(clave, { idcampania: t.idcampania ?? null, campania: t.campania || 'Sin campaña', ...sumaVacia() });
        for (const acc of [total, porCampania.get(clave)]) {
            acc.salarios += salario;
            acc.bonos += bonos;
            acc.empleados.add(t.users_company_id);
        }
    }
    const cerrar = (acc) => {
        const detalle = factores.map((f) => ({ codigo: f.codigo, nombre: f.nombre, porcentaje: f.porcentaje, valor: Math.round(acc.salarios * f.porcentaje / 100) }));
        const salarios = Math.round(acc.salarios);
        const bonos = Math.round(acc.bonos);
        const prestaciones = detalle.reduce((a, d) => a + d.valor, 0);
        return { salarios, prestaciones, bonos, total: salarios + prestaciones + bonos, empleados: acc.empleados.size, detalle_prestaciones: detalle };
    };
    return {
        periodo,
        ...cerrar(total),
        por_campania: [...porCampania.values()].map((c) => {
            const { detalle_prestaciones: _detalle, ...resto } = cerrar(c);
            return { idcampania: c.idcampania, campania: c.campania, ...resto };
        }).sort((a, b) => b.total - a.total)
    };
}

/**
 * Histórico mes a mes. Los meses futuros no se calculan. El mes en curso trae el costo proyectado
 * al cierre (con la nómina vigente hoy) y, aparte, lo causado hasta `hoy`.
 */
function historico(tramos, factores, periodos, hoy) {
    const mesHoy = hoy.slice(0, 7);
    return periodos.filter((p) => p <= mesHoy).map((p) => {
        const { por_campania: _pc, ...mes } = costoDelMes(tramos, factores, p);
        if (p !== mesHoy) return { ...mes, en_curso: false };
        const causado = costoDelMes(tramos, factores, p, { corte: hoy });
        return { ...mes, en_curso: true, causado: { salarios: causado.salarios, prestaciones: causado.prestaciones, bonos: causado.bonos, total: causado.total } };
    });
}

module.exports = { DIAS_MES_COMERCIAL, diasEnMes, costoDelMes, historico };
