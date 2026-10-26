// Costo de nómina por mes (asistencia.md §38-§40): salarios prorrateados por días, bonos, auxilio
// de transporte, prestaciones sociales (sobre el salario básico, más el auxilio en las que lo
// incluyen) y aportes de seguridad social y parafiscales (sobre el IBC; el auxilio no es base). Puro: recibe los tramos salariales ya leídos, los factores, los SMMLV y la fecha
// de hoy. Las fechas son 'YYYY-MM-DD' de columnas DATE (sin zona horaria).
//
// Convención de nómina en Colombia: mes comercial de 30 días. Un mes completo vale 30 días (también
// febrero); el día 31 no se cuenta; un tramo parcial vale los días que cubre, con su último día del
// mes contado como el 30.

const DIAS_MES_COMERCIAL = 30;

// Ley 1393 de 2010 art. 30: los pagos no salariales (bonos) solo suman al IBC en lo que pasen del
// 40 % de la remuneración total.
const TOPE_NO_SALARIAL_PCT = 40;
// Art. 114-1 E.T.: salud, ICBF y SENA no se pagan por quien gana menos de 10 SMMLV.
const SMMLV_EXONERACION = 10;
// Ley 15 de 1959: el auxilio de transporte lo recibe quien gana hasta 2 SMMLV.
const SMMLV_AUXILIO = 2;
// Rango legal de la tarifa ARL (clase I mínima a clase V máxima). Fuera de él es un dato mal
// cargado y se usa la tarifa por defecto del factor.
const TARIFA_ARL_MIN = 0.348;
const TARIFA_ARL_MAX = 8.7;
const CODIGO_ARL = 'arl';

const CATEGORIAS = { prestacion: 'prestaciones', aporte: 'aportes' };

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

/** IBC mensual: salario + la parte de los bonos que pasa del 40 % de la remuneración total. */
function ibcMensual(salario, bonos) {
    const exceso = bonos - ((salario + bonos) * TOPE_NO_SALARIAL_PCT) / 100;
    return salario + Math.max(0, exceso);
}

/** Valor de `campo` del año (o del último año cargado antes). null si no hay ninguno. */
function vigenteDe(salariosMinimos, anio, campo) {
    let valor = null;
    for (const s of salariosMinimos) if (s.anio <= anio && s[campo] != null) valor = s[campo];
    return valor;
}

/** SMMLV del año. null si no hay ninguno: no se exonera ni se paga auxilio. */
const salarioMinimoDe = (salariosMinimos, anio) => vigenteDe(salariosMinimos, anio, 'valor');
const auxilioTransporteDe = (salariosMinimos, anio) => vigenteDe(salariosMinimos, anio, 'auxilio_transporte');

const tarifaDe = (factor, tramo) => {
    const propia = tramo.tarifa_arl;
    if (factor.codigo === CODIGO_ARL && propia >= TARIFA_ARL_MIN && propia <= TARIFA_ARL_MAX) return propia;
    return factor.porcentaje;
};

const sumaVacia = () => ({ salarios: 0, bonos: 0, auxilio: 0, ibc: 0, factores: new Map(), empleados: new Set(), conAuxilio: new Set() });

/**
 * Costo de un mes. `corte` (opcional) limita el cálculo hasta ese día: es lo causado a la fecha.
 * Devuelve totales, el detalle de cada prestación y aporte, y el desglose por campaña.
 */
function costoDelMes(tramos, factores, periodo, { corte = null, salariosMinimos = [] } = {}) {
    const anio = Number(periodo.slice(0, 4));
    const smmlv = salarioMinimoDe(salariosMinimos, anio);
    const auxilioMensual = auxilioTransporteDe(salariosMinimos, anio);
    const total = sumaVacia();
    const porCampania = new Map();
    for (const t of tramos) {
        const dias = diasEnMes(t, periodo, corte);
        if (dias === 0) continue;
        const proporcion = dias / DIAS_MES_COMERCIAL;
        const salarioMes = Number(t.salario) || 0;
        const bonosMes = Number(t.bonos) || 0;
        const salario = salarioMes * proporcion;
        const bonos = bonosMes * proporcion;
        const ibc = ibcMensual(salarioMes, bonosMes) * proporcion;
        const exonerado = smmlv != null && salarioMes < SMMLV_EXONERACION * smmlv;
        const tieneAuxilio = smmlv != null && auxilioMensual != null && salarioMes > 0 && salarioMes <= SMMLV_AUXILIO * smmlv;
        const auxilio = tieneAuxilio ? auxilioMensual * proporcion : 0;

        const clave = t.idcampania ?? 'sin';
        if (!porCampania.has(clave)) porCampania.set(clave, { idcampania: t.idcampania ?? null, campania: t.campania || 'Sin campaña', ...sumaVacia() });
        for (const acc of [total, porCampania.get(clave)]) {
            acc.salarios += salario;
            acc.bonos += bonos;
            acc.auxilio += auxilio;
            acc.ibc += ibc;
            acc.empleados.add(t.users_company_id);
            if (tieneAuxilio) acc.conAuxilio.add(t.users_company_id);
            for (const f of factores) {
                const esAporte = f.categoria === 'aporte';
                const base = esAporte ? ibc : salario + (f.incluye_auxilio ? auxilio : 0);
                const valor = esAporte && f.exonerable && exonerado ? 0 : (base * tarifaDe(f, t)) / 100;
                acc.factores.set(f.codigo, (acc.factores.get(f.codigo) || 0) + valor);
            }
        }
    }

    const cerrar = (acc) => {
        const salarios = Math.round(acc.salarios);
        const bonos = Math.round(acc.bonos);
        const auxilio = Math.round(acc.auxilio);
        const resultado = {
            salarios, auxilio_transporte: auxilio, prestaciones: 0, aportes: 0, bonos, total: 0,
            empleados: acc.empleados.size, empleados_con_auxilio: acc.conAuxilio.size, detalle_prestaciones: [], detalle_aportes: []
        };
        for (const f of factores) {
            const grupo = CATEGORIAS[f.categoria] || 'prestaciones';
            const valor = Math.round(acc.factores.get(f.codigo) || 0);
            const base = grupo === 'aportes' ? acc.ibc : acc.salarios + (f.incluye_auxilio ? acc.auxilio : 0);
            resultado[grupo] += valor;
            resultado[`detalle_${grupo}`].push({
                codigo: f.codigo, nombre: f.nombre, porcentaje: f.porcentaje, exonerable: !!f.exonerable,
                // Lo que de verdad pesó sobre la base (con exoneraciones y ARL de cada empleado).
                porcentaje_efectivo: base > 0 ? Math.round((valor / base) * 100000) / 1000 : 0,
                valor
            });
        }
        resultado.total = salarios + auxilio + resultado.prestaciones + resultado.aportes + bonos;
        return resultado;
    };

    return {
        periodo,
        ...cerrar(total),
        por_campania: [...porCampania.values()].map((c) => {
            const { detalle_prestaciones: _p, detalle_aportes: _a, ...resto } = cerrar(c);
            return { idcampania: c.idcampania, campania: c.campania, ...resto };
        }).sort((a, b) => b.total - a.total)
    };
}

/**
 * Histórico mes a mes. Los meses futuros no se calculan. El mes en curso trae el costo proyectado
 * al cierre (con la nómina vigente hoy) y, aparte, lo causado hasta `hoy`.
 */
function historico(tramos, factores, periodos, hoy, { salariosMinimos = [] } = {}) {
    const mesHoy = hoy.slice(0, 7);
    return periodos.filter((p) => p <= mesHoy).map((p) => {
        const { por_campania: _pc, detalle_prestaciones: _p, detalle_aportes: _a, ...mes } = costoDelMes(tramos, factores, p, { salariosMinimos });
        if (p !== mesHoy) return { ...mes, en_curso: false };
        const causado = costoDelMes(tramos, factores, p, { corte: hoy, salariosMinimos });
        return {
            ...mes,
            en_curso: true,
            causado: {
                salarios: causado.salarios, auxilio_transporte: causado.auxilio_transporte, prestaciones: causado.prestaciones,
                aportes: causado.aportes, bonos: causado.bonos, total: causado.total
            }
        };
    });
}

module.exports = { DIAS_MES_COMERCIAL, diasEnMes, ibcMensual, salarioMinimoDe, auxilioTransporteDe, costoDelMes, historico };
