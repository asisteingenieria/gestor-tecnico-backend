const { test } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const P = require('../../utils/pasivoVacacional');

test('DAYS360 método US, como Excel', () => {
    assert.equal(P.days360('2023-08-08', '2026-11-19'), 1181); // fila 2 del Excel: 1181 + 1 = 1182
    assert.equal(P.days360('2024-01-31', '2024-03-01'), 31);   // inicio 31 → 30
    assert.equal(P.days360('2024-01-30', '2024-03-31'), 60);   // fin 31 con inicio 30 → 30
    assert.equal(P.days360('2024-01-15', '2024-03-31'), 76);   // fin 31 con inicio < 30 cuenta como el 1 siguiente
    assert.equal(P.days360('2024-02-29', '2024-03-31'), 30);   // inicio fin de febrero → 30
});

test('reproduce la fila del Excel en la fecha de corte', () => {
    const r = P.calcularEmpleado(
        { fecha_ingreso: new Date('2023-08-08T00:00:00Z'), salario: 3000000 },
        { fecha_corte: '2026-11-19', dias_disfrutados_corte: 18, dias_compensados: 0 },
        [], '2026-11-19'
    );
    assert.equal(r.dias_trabajados, 1182);
    assert.equal(r.dias_acumulados, 49.25);
    assert.equal(r.pasivo_dias, 31.25);
    assert.equal(r.valor_pasivo, Math.round(31.25 * 100000));
});

test('después del corte suma las vacaciones nuevas y las futuras van a programadas', () => {
    const saldo = { fecha_corte: '2026-11-19', dias_disfrutados_corte: 10, dias_compensados: 2 };
    const vac = [
        { fecha_inicial: '2026-11-10', total_dias: 5 },  // antes del corte: ya venía en el Excel
        { fecha_inicial: '2026-11-25', total_dias: 4 },  // entre el corte y la fecha: disfrutadas
        { fecha_inicial: '2026-12-20', total_dias: 6 }   // después de la fecha: programadas
    ];
    const r = P.calcularEmpleado({ fecha_ingreso: '2025-01-01' }, saldo, vac, '2026-11-30');
    assert.equal(r.dias_disfrutados, 14);
    assert.equal(r.dias_compensados, 2);
    assert.equal(r.dias_programados, 6);
    assert.equal(r.total_dias, P.redondear(r.pasivo_dias - 6));
    assert.equal(r.valor_pasivo, null); // sin salario no hay valor
});

test('antes del corte descuenta lo que empezó entre la fecha y el corte', () => {
    const saldo = { fecha_corte: '2026-11-19', dias_disfrutados_corte: 10, dias_compensados: 0 };
    const r = P.calcularEmpleado({ fecha_ingreso: '2025-01-01' }, saldo, [{ fecha_inicial: '2026-11-10', total_dias: 5 }], '2026-10-31');
    assert.equal(r.dias_disfrutados, 5);
    assert.equal(r.dias_programados, 5);
});

test('sin saldo inicial usa todas las novedades desde el ingreso del contrato vigente', () => {
    const vac = [
        { fecha_inicial: '2024-05-01', total_dias: 15 },  // de un contrato anterior: no cuenta
        { fecha_inicial: '2026-03-01', total_dias: 3 }
    ];
    const r = P.calcularEmpleado({ fecha_ingreso: '2025-06-01' }, null, vac, '2026-11-19');
    assert.equal(r.con_corte, false);
    assert.equal(r.dias_disfrutados, 3);
    assert.equal(r.dias_compensados, 0);
});

test('ingreso posterior a la fecha no acumula', () => {
    assert.equal(P.calcularEmpleado({ fecha_ingreso: '2026-12-01' }, null, [], '2026-11-19').dias_trabajados, 0);
});

test('calcular agrupa por empleado y totaliza', () => {
    const empleados = [
        { users_company_id: 1, fecha_ingreso: '2025-11-20', salario: 3000000, saldo_id: 9, fecha_corte: '2026-11-19', dias_disfrutados_corte: 5, dias_compensados: 0 },
        { users_company_id: 2, fecha_ingreso: '2026-11-01', salario: null }
    ];
    const { filas, totales } = P.calcular(empleados, [{ users_company_id: 2, fecha_inicial: '2026-12-01', total_dias: 2 }], '2026-11-19');
    assert.equal(filas[0].pasivo_dias, 10); // 360 días → 15 acumulados − 5
    assert.equal(filas[1].dias_programados, 2);
    assert.equal(totales.empleados, 2);
    assert.equal(totales.con_corte, 1);
    assert.equal(totales.sin_salario, 1);
    assert.equal(totales.valor_pasivo, 1000000);
});

test('las novedades compensadas descuentan como compensados, no como disfrutados', () => {
    const saldo = { fecha_corte: '2026-11-19', dias_disfrutados_corte: 10, dias_compensados: 3 };
    const vac = [
        { fecha_inicial: '2026-11-25', total_dias: 10, modalidad_vacaciones: 'disfrutadas_compensadas', dias_disfrutados: 5, dias_compensados: 5 },
        { fecha_inicial: '2026-11-26', total_dias: 4, modalidad_vacaciones: 'compensadas', dias_disfrutados: 0, dias_compensados: 4 },
        { fecha_inicial: '2026-11-27', total_dias: 2 },  // de antes de la 107: cuenta como disfrutada
        { fecha_inicial: '2026-12-20', total_dias: 6, modalidad_vacaciones: 'disfrutadas_compensadas', dias_disfrutados: 4, dias_compensados: 2 }
    ];
    const r = P.calcularEmpleado({ fecha_ingreso: '2025-01-01' }, saldo, vac, '2026-11-30');
    assert.equal(r.dias_disfrutados, 17);  // 10 del corte + 5 + 2
    assert.equal(r.dias_compensados, 12);  // 3 del corte + 5 + 4
    assert.equal(r.dias_programados, 6);   // la de diciembre, las dos partes
    assert.equal(r.pasivo_dias, P.redondear(r.dias_acumulados - 17 - 12));

    const sinCorte = P.calcularEmpleado({ fecha_ingreso: '2025-01-01' }, null, vac, '2026-11-30');
    assert.equal(sinCorte.dias_disfrutados, 7);
    assert.equal(sinCorte.dias_compensados, 9);
});

test('lee el Excel de corte por nombre de columna', () => {
    const filas = [
        ['TIPO DE IDENTIFICACIÓN', 'IDENTIFICACIÓN', 'PRIMER NOMBRE', 'CARGO', 'AREA', 'CAMPAÑA', 'FECHA DE INGRESO', 'FECHA ACTUAL',
            'DIAS TRABAJADOS', 'DIAS ACUMULADOS', 'DIAS DISFRUTADOS', 'DIAS COMPENSADOS', 'PASIVO VACACIONAL', 'VACACIONES PROGRAMADAS', 'TOTAL'],
        ['CC', 9000000099, 'Ana', 'AGENTE', 'OPERATIVA', 'T&T', 45146, 46345, 1182, 49.25, 18, 0, 31.25, 0, 31.25],
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '']
    ];
    const { registros } = P.leerExcelCorte(filas);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].cedula, '9000000099');
    assert.equal(registros[0].ingreso, '2023-08-08');
    assert.equal(registros[0].fecha, '2026-11-19');
    assert.equal(registros[0].disfrutados, 18);
    assert.match(P.leerExcelCorte([['IDENTIFICACIÓN']]).error, /Falta la columna/);
});

test('RRHH no ve salario ni valores en pesos; financiera sí', () => {
    const resultado = P.calcular([{ users_company_id: 1, nombre: 'Ana', fecha_ingreso: '2025-11-20', salario: 3000000 }], [], '2026-11-19');
    const rrhh = P.sinValores(resultado);
    assert.equal('salario' in rrhh.filas[0], false);
    assert.equal('valor_pasivo' in rrhh.filas[0], false);
    assert.equal('valor_total' in rrhh.totales, false);
    assert.equal(rrhh.filas[0].pasivo_dias, 15);
    assert.equal(P.veValores({ role: 'financiera' }), true);
    assert.equal(P.veValores({ role: 'recursosHumanos' }), false);
    assert.equal(P.veValores({ role: 'admin' }), false);

    const libro = XLSX.read(P.generarLibro(resultado, '2026-11-19', 'ahora', XLSX, { conValores: false }), { type: 'buffer' });
    const [fila] = XLSX.utils.sheet_to_json(libro.Sheets['Pasivo vacacional']);
    assert.equal('Valor Pasivo' in fila, false);
    assert.equal('Salario' in fila, false);
    const resumen = XLSX.utils.sheet_to_json(libro.Sheets.Resumen, { header: 1 }).map((r) => r[0]);
    assert.equal(resumen.includes('Valor pasivo'), false);
});

test('el libro trae la hoja del pasivo y el resumen', () => {
    const resultado = P.calcular([{ users_company_id: 1, nombre: 'Ana', fecha_ingreso: '2025-11-20', salario: 3000000 }], [], '2026-11-19');
    const libro = XLSX.read(P.generarLibro(resultado, '2026-11-19', 'ahora', XLSX), { type: 'buffer' });
    assert.deepEqual(libro.SheetNames, ['Pasivo vacacional', 'Resumen']);
    const [fila] = XLSX.utils.sheet_to_json(libro.Sheets['Pasivo vacacional']);
    assert.equal(fila['Fecha De Cálculo'], 46345); // fecha real de Excel (§60)
    assert.equal(XLSX.utils.sheet_to_json(libro.Sheets['Pasivo vacacional'], { raw: false })[0]['Fecha De Cálculo'], '19/11/2026');
    assert.equal(fila['Pasivo Vacacional (días)'], 15);
    assert.equal(fila['Valor Pasivo'], 1500000);
});

test('ajuste de financiera: valida fecha, días y motivo (§58.2)', () => {
    const ok = P.validarAjuste({ fecha_corte: '2026-11-19', dias_disfrutados: '12,5', dias_compensados: 0, nota: 'Revisado con GH' }, '2026-11-20');
    assert.deepEqual(ok.datos, { fecha_corte: '2026-11-19', dias_disfrutados: 12.5, dias_compensados: 0, nota: 'Revisado con GH' });
    assert.match(P.validarAjuste({ fecha_corte: '2026-11-25', dias_disfrutados: 1, dias_compensados: 0, nota: 'motivo' }, '2026-11-20').error, /futura/);
    assert.match(P.validarAjuste({ fecha_corte: '2026-11-19', dias_disfrutados: -1, dias_compensados: 0, nota: 'motivo' }).error, /disfrutados/);
    assert.match(P.validarAjuste({ fecha_corte: '2026-11-19', dias_disfrutados: 1, dias_compensados: '', nota: 'motivo' }).error, /compensados/);
    assert.match(P.validarAjuste({ fecha_corte: '2026-11-19', dias_disfrutados: 1, dias_compensados: 0, nota: 'x' }).error, /motivo/);
    assert.equal(P.esFinanciera({ role: 'financiera' }), true);
    assert.equal(P.esFinanciera({ role: 'recursosHumanos' }), false);
});

test('un saldo ajustado por financiera quita la observación y descuenta lo ajustado', () => {
    const empleado = { users_company_id: 1, nombre: 'Ana', fecha_ingreso: '2023-11-20', salario: 3000000 };
    const sinSaldo = P.calcular([empleado], [], '2026-11-19').filas[0];
    assert.equal(sinSaldo.con_corte, false);
    assert.equal(sinSaldo.pasivo_dias, 45);
    const ajustado = P.calcular([{ ...empleado, saldo_id: 9, fecha_corte: '2026-11-19', dias_disfrutados_corte: 30, dias_compensados: 5, origen: 'financiera', nota: 'Revisado' }], [], '2026-11-19').filas[0];
    assert.equal(ajustado.con_corte, true);
    assert.equal(ajustado.origen_saldo, 'financiera');
    assert.equal(ajustado.pasivo_dias, 10);
    assert.equal(ajustado.saldo_disfrutados_corte, 30);
});

test('sin saldo del Excel: con observación solo quien llevaba un año o más al corte (§58.5)', () => {
    const conSaldo = { users_company_id: 1, nombre: 'A', fecha_ingreso: '2024-01-10', saldo_id: 1, fecha_corte: '2026-11-19', dias_disfrutados_corte: 0, dias_compensados: 0, origen: 'excel' };
    const antiguo = { users_company_id: 2, nombre: 'B', fecha_ingreso: '2023-07-17' };
    const unAnioJusto = { users_company_id: 3, nombre: 'C', fecha_ingreso: '2025-11-19' };
    const deMayo = { users_company_id: 4, nombre: 'D', fecha_ingreso: '2026-05-05' };
    const r = P.calcular([conSaldo, antiguo, unAnioJusto, deMayo], [], '2026-11-20');
    const por = Object.fromEntries(r.filas.map((f) => [f.nombre, f]));
    assert.equal(por.A.con_observacion, false);
    assert.equal(por.B.con_observacion, true);
    assert.equal(por.C.con_observacion, true);
    assert.equal(por.D.con_observacion, false);
    assert.equal(por.D.ingreso_reciente, true);
    assert.equal(r.totales.con_observacion, 2);
    assert.equal(r.totales.ingreso_reciente, 1);
    // Sin ningún saldo cargado no hay corte: todo el que no tiene saldo queda con observación.
    assert.equal(P.calcular([deMayo], [], '2026-11-20').filas[0].con_observacion, true);
});
