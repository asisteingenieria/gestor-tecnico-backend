/**
 * Seed de datos de prueba para el módulo de asistencia (ver asistencia.md).
 *
 * Crea 1 director de operaciones y 5 empleados a su cargo, con TODAS las tablas del
 * módulo de empleados pobladas:
 *   users_company (datos personales completos) · contrato · historial_salarial
 *   seguridad_social (EPS/ARL/AFP/cesantías/caja) · cuenta_bancaria · direccion
 *   contacto_emergencia
 *
 * Los 5 empleados quedan con contrato.jefe_inmediato_id apuntando al director, que es la
 * relación que el módulo de asistencia usa para saber quién está a cargo de quién.
 *
 * Además crea las cuentas de login, PERO solo si el ENUM users.role ya incluye los roles
 * 'director_operaciones' y 'empleado' (migración 043). Mientras esa migración no se haya
 * aplicado, crea solo las fichas de RRHH y avisa.
 *
 * Es idempotente: si el empleado ya existe lo actualiza en vez de duplicarlo.
 *
 *   node scripts/seedEmpleadosAsistencia.js
 */

const db = require('../config/db');
const UserCompany = require('../models/UserCompany');
const User = require('../models/User');

// Catálogos ya sembrados por las migraciones 035/036.
const CAT = {
    tipo_identificacion: { CC: 1 },
    ciudad: { bogota: 1, barranquilla: 4, medellin: null },
    campania: { claro: 1 },
    area: { operaciones: 1 },
    centro_costo: { claro: 1 },
    cargo: { agente: 1, coordinador: 3 },
    tipo_contrato: { indefinido: 1 },
    modalidad: { presencial: 1, remoto: 2, hibrido: 3 },
    oleada: { inicial: 1 },
    tipo_direccion: { residencia: 1 },
    tipo_cuenta: { ahorros: 1 },
    banco: { bancolombia: 1, bogota: 2, davivienda: 3, bbva: 4, av_villas: 8 },
    eps: { sura: 1, sanitas: 2, nueva: 3, salud_total: 4, compensar: 5 },
    arl: { sura: 8, positiva: 9, colmena: 10 },
    afp: { porvenir: 12, proteccion: 13, colfondos: 14 },
    cesantias: { porvenir: 17, proteccion: 18, fna: 19 },
    caja: { compensar: 20, colsubsidio: 21, cafam: 22 },
    estado_civil: { soltero: 1, casado: 2, union_libre: 3 },
    grupo_sanguineo: { 'O+': 1, 'A+': 3, 'B+': 5, 'AB+': 7, 'O-': 2 },
    genero: { masculino: 1, femenino: 2 },
    parentesco: { madre: 1, padre: 2, hermano: 3, conyuge: 5, companero: 6 }
};

const FECHA_INGRESO = '2026-09-01';

// Cédulas del rango 90000000xx para identificar y borrar fácil los datos de prueba.
const PERSONAS = [
    {
        rol_prueba: 'director',
        login: { username: 'director.operaciones', password: 'Prueba123*', role: 'director_operaciones' },
        numero_identificacion: '9000000001',
        fecha_expedicion: '2008-04-18', ciudad_expedicion_id: CAT.ciudad.bogota,
        primer_nombre: 'Marta', segundo_nombre: 'Lucía',
        primer_apellido: 'Rondón', segundo_apellido: 'Vega',
        fecha_nacimiento: '1990-02-11', ciudad_nacimiento_id: CAT.ciudad.bogota,
        numero_hijos: 2,
        estado_civil_id: CAT.estado_civil.casado,
        grupo_sanguineo_id: CAT.grupo_sanguineo['O+'],
        genero_id: CAT.genero.femenino,
        email: 'marta.rondon@prueba.local', telefono: '3001000001',
        usuario_ssff: 'mrondon',
        contrato: { cargo_id: CAT.cargo.coordinador, modalidad_id: CAT.modalidad.presencial, piso: 'Piso 3' },
        salario: { salario: 4800000, bono_no_prestacional: 400000, bono_cafeteria: 120000 },
        seguridad_social: { eps_id: CAT.eps.sura, arl_id: CAT.arl.sura, afp_id: CAT.afp.porvenir, cesantias_id: CAT.cesantias.porvenir, caja_id: CAT.caja.compensar },
        cuenta_bancaria: { numero_cuenta: '11223344551', banco_id: CAT.banco.bancolombia, tipo_cuenta_id: CAT.tipo_cuenta.ahorros },
        direccion: { direccion: 'Calle 100 # 15-42 Apto 501', barrio: 'Chicó Norte', ciudad_id: CAT.ciudad.bogota },
        contacto_emergencia: { nombre: 'Jorge Rondón Salas', telefono: '3111000001', parentesco_id: CAT.parentesco.padre }
    },
    {
        rol_prueba: 'empleado',
        login: { username: 'empleado1', password: 'Prueba123*', role: 'empleado' },
        numero_identificacion: '9000000002',
        fecha_expedicion: '2013-07-02', ciudad_expedicion_id: CAT.ciudad.bogota,
        primer_nombre: 'Andrés', segundo_nombre: 'Felipe',
        primer_apellido: 'Cárdenas', segundo_apellido: 'Mejía',
        fecha_nacimiento: '1995-05-23', ciudad_nacimiento_id: CAT.ciudad.bogota,
        numero_hijos: 0,
        estado_civil_id: CAT.estado_civil.soltero,
        grupo_sanguineo_id: CAT.grupo_sanguineo['A+'],
        genero_id: CAT.genero.masculino,
        email: 'andres.cardenas@prueba.local', telefono: '3001000002',
        usuario_ssff: 'acardenas',
        contrato: { cargo_id: CAT.cargo.agente, modalidad_id: CAT.modalidad.presencial, piso: 'Piso 2' },
        salario: { salario: 1423500, bono_no_prestacional: 0, bono_cafeteria: 100000 },
        seguridad_social: { eps_id: CAT.eps.sanitas, arl_id: CAT.arl.sura, afp_id: CAT.afp.porvenir, cesantias_id: CAT.cesantias.porvenir, caja_id: CAT.caja.compensar },
        cuenta_bancaria: { numero_cuenta: '11223344552', banco_id: CAT.banco.davivienda, tipo_cuenta_id: CAT.tipo_cuenta.ahorros },
        direccion: { direccion: 'Carrera 68 # 40-15', barrio: 'Salitre', ciudad_id: CAT.ciudad.bogota },
        contacto_emergencia: { nombre: 'Gloria Mejía Ruiz', telefono: '3111000002', parentesco_id: CAT.parentesco.madre }
    },
    {
        rol_prueba: 'empleado',
        login: { username: 'empleado2', password: 'Prueba123*', role: 'empleado' },
        numero_identificacion: '9000000003',
        fecha_expedicion: '2011-11-29', ciudad_expedicion_id: CAT.ciudad.bogota,
        primer_nombre: 'Laura', segundo_nombre: null,
        primer_apellido: 'Gutiérrez', segundo_apellido: 'Osorio',
        fecha_nacimiento: '1993-09-08', ciudad_nacimiento_id: CAT.ciudad.barranquilla,
        numero_hijos: 1,
        estado_civil_id: CAT.estado_civil.union_libre,
        grupo_sanguineo_id: CAT.grupo_sanguineo['B+'],
        genero_id: CAT.genero.femenino,
        email: 'laura.gutierrez@prueba.local', telefono: '3001000003',
        usuario_ssff: 'lgutierrez',
        contrato: { cargo_id: CAT.cargo.agente, modalidad_id: CAT.modalidad.hibrido, piso: 'Piso 2' },
        salario: { salario: 1423500, bono_no_prestacional: 150000, bono_cafeteria: 100000 },
        seguridad_social: { eps_id: CAT.eps.nueva, arl_id: CAT.arl.positiva, afp_id: CAT.afp.proteccion, cesantias_id: CAT.cesantias.proteccion, caja_id: CAT.caja.colsubsidio },
        cuenta_bancaria: { numero_cuenta: '11223344553', banco_id: CAT.banco.bancolombia, tipo_cuenta_id: CAT.tipo_cuenta.ahorros },
        direccion: { direccion: 'Calle 45 Sur # 78-12', barrio: 'Kennedy', ciudad_id: CAT.ciudad.bogota },
        contacto_emergencia: { nombre: 'Diego Ramírez Peña', telefono: '3111000003', parentesco_id: CAT.parentesco.companero }
    },
    {
        rol_prueba: 'empleado',
        login: { username: 'empleado3', password: 'Prueba123*', role: 'empleado' },
        numero_identificacion: '9000000004',
        fecha_expedicion: '2015-03-14', ciudad_expedicion_id: CAT.ciudad.bogota,
        primer_nombre: 'Julián', segundo_nombre: 'David',
        primer_apellido: 'Moreno', segundo_apellido: null,
        fecha_nacimiento: '1997-12-30', ciudad_nacimiento_id: CAT.ciudad.bogota,
        numero_hijos: 0,
        estado_civil_id: CAT.estado_civil.soltero,
        grupo_sanguineo_id: CAT.grupo_sanguineo['O-'],
        genero_id: CAT.genero.masculino,
        email: 'julian.moreno@prueba.local', telefono: '3001000004',
        usuario_ssff: 'jmoreno',
        contrato: { cargo_id: CAT.cargo.agente, modalidad_id: CAT.modalidad.presencial, piso: 'Piso 2' },
        salario: { salario: 1423500, bono_no_prestacional: 0, bono_cafeteria: 100000 },
        seguridad_social: { eps_id: CAT.eps.salud_total, arl_id: CAT.arl.colmena, afp_id: CAT.afp.colfondos, cesantias_id: CAT.cesantias.fna, caja_id: CAT.caja.cafam },
        cuenta_bancaria: { numero_cuenta: '11223344554', banco_id: CAT.banco.bbva, tipo_cuenta_id: CAT.tipo_cuenta.ahorros },
        direccion: { direccion: 'Transversal 93 # 53-48', barrio: 'Álamos', ciudad_id: CAT.ciudad.bogota },
        contacto_emergencia: { nombre: 'Sandra Moreno Ariza', telefono: '3111000004', parentesco_id: CAT.parentesco.madre }
    },
    {
        rol_prueba: 'empleado',
        login: { username: 'empleado4', password: 'Prueba123*', role: 'empleado' },
        numero_identificacion: '9000000005',
        fecha_expedicion: '2010-08-21', ciudad_expedicion_id: CAT.ciudad.bogota,
        primer_nombre: 'Daniela', segundo_nombre: null,
        primer_apellido: 'Sepúlveda', segundo_apellido: 'Rojas',
        fecha_nacimiento: '1992-06-17', ciudad_nacimiento_id: CAT.ciudad.bogota,
        numero_hijos: 2,
        estado_civil_id: CAT.estado_civil.casado,
        grupo_sanguineo_id: CAT.grupo_sanguineo['AB+'],
        genero_id: CAT.genero.femenino,
        email: 'daniela.sepulveda@prueba.local', telefono: '3001000005',
        usuario_ssff: 'dsepulveda',
        contrato: { cargo_id: CAT.cargo.agente, modalidad_id: CAT.modalidad.remoto, piso: null },
        salario: { salario: 1600000, bono_no_prestacional: 200000, bono_cafeteria: 100000 },
        seguridad_social: { eps_id: CAT.eps.compensar, arl_id: CAT.arl.sura, afp_id: CAT.afp.porvenir, cesantias_id: CAT.cesantias.porvenir, caja_id: CAT.caja.compensar },
        cuenta_bancaria: { numero_cuenta: '11223344555', banco_id: CAT.banco.bogota, tipo_cuenta_id: CAT.tipo_cuenta.ahorros },
        direccion: { direccion: 'Calle 134 # 55-30 Torre 2 Apto 802', barrio: 'Prado Veraniego', ciudad_id: CAT.ciudad.bogota },
        contacto_emergencia: { nombre: 'Ricardo Peña Luna', telefono: '3111000005', parentesco_id: CAT.parentesco.conyuge }
    },
    {
        rol_prueba: 'empleado',
        login: { username: 'empleado5', password: 'Prueba123*', role: 'empleado' },
        numero_identificacion: '9000000006',
        fecha_expedicion: '2014-01-09', ciudad_expedicion_id: CAT.ciudad.bogota,
        primer_nombre: 'Camilo', segundo_nombre: 'Esteban',
        primer_apellido: 'Villamil', segundo_apellido: 'Pardo',
        fecha_nacimiento: '1996-03-25', ciudad_nacimiento_id: CAT.ciudad.bogota,
        numero_hijos: 1,
        estado_civil_id: CAT.estado_civil.union_libre,
        grupo_sanguineo_id: CAT.grupo_sanguineo['A+'],
        genero_id: CAT.genero.masculino,
        email: 'camilo.villamil@prueba.local', telefono: '3001000006',
        usuario_ssff: 'cvillamil',
        contrato: { cargo_id: CAT.cargo.agente, modalidad_id: CAT.modalidad.presencial, piso: 'Piso 3' },
        salario: { salario: 1423500, bono_no_prestacional: 0, bono_cafeteria: 100000 },
        seguridad_social: { eps_id: CAT.eps.sura, arl_id: CAT.arl.positiva, afp_id: CAT.afp.proteccion, cesantias_id: CAT.cesantias.proteccion, caja_id: CAT.caja.colsubsidio },
        cuenta_bancaria: { numero_cuenta: '11223344556', banco_id: CAT.banco.av_villas, tipo_cuenta_id: CAT.tipo_cuenta.ahorros },
        direccion: { direccion: 'Diagonal 17 # 32-11', barrio: 'La Soledad', ciudad_id: CAT.ciudad.bogota },
        contacto_emergencia: { nombre: 'Paula Villamil Pardo', telefono: '3111000006', parentesco_id: CAT.parentesco.hermano }
    }
];

function nombreCompleto(p) {
    return [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido]
        .filter(Boolean).join(' ');
}

/** Arma el payload anidado que esperan UserCompany.create / .update */
function payload(p, jefeInmediatoId) {
    return {
        numero_identificacion: p.numero_identificacion,
        tipo_identificacion_id: CAT.tipo_identificacion.CC,
        fecha_expedicion: p.fecha_expedicion,
        ciudad_expedicion_id: p.ciudad_expedicion_id,
        primer_nombre: p.primer_nombre,
        segundo_nombre: p.segundo_nombre,
        primer_apellido: p.primer_apellido,
        segundo_apellido: p.segundo_apellido,
        fecha_nacimiento: p.fecha_nacimiento,
        ciudad_nacimiento_id: p.ciudad_nacimiento_id,
        numero_hijos: p.numero_hijos,
        estado_civil_id: p.estado_civil_id,
        grupo_sanguineo_id: p.grupo_sanguineo_id,
        genero_id: p.genero_id,
        email: p.email,
        telefono: p.telefono,
        usuario_ssff: p.usuario_ssff,
        contrato: {
            campania_id: CAT.campania.claro,
            area_id: CAT.area.operaciones,
            centro_costo_id: CAT.centro_costo.claro,
            cargo_id: p.contrato.cargo_id,
            tipo_contrato_id: CAT.tipo_contrato.indefinido,
            modalidad_id: p.contrato.modalidad_id,
            oleada_id: CAT.oleada.inicial,
            ciudad_id: CAT.ciudad.bogota,
            piso: p.contrato.piso,
            jefe_inmediato_id: jefeInmediatoId,
            jefe_area_id: jefeInmediatoId,
            fecha_ingreso: FECHA_INGRESO,
            fecha_fin_periodo_prueba: '2026-11-01',
            observaciones: 'Datos de prueba — módulo de asistencia'
        },
        salario: p.salario,
        seguridad_social: p.seguridad_social,
        cuenta_bancaria: p.cuenta_bancaria,
        direccion: {
            tipo_direccion_id: CAT.tipo_direccion.residencia,
            direccion: p.direccion.direccion,
            barrio: p.direccion.barrio,
            ciudad_id: p.direccion.ciudad_id
        },
        contacto_emergencia: p.contacto_emergencia
    };
}

async function buscarPorIdentificacion(numero) {
    const [rows] = await db.query(
        'SELECT id FROM users_company WHERE numero_identificacion = ? AND tipo_identificacion_idtipo_identificacion = ?',
        [numero, CAT.tipo_identificacion.CC]
    );
    return rows[0]?.id ?? null;
}

async function guardarEmpleado(persona, jefeInmediatoId) {
    const datos = payload(persona, jefeInmediatoId);
    const existente = await buscarPorIdentificacion(persona.numero_identificacion);

    if (existente) {
        await UserCompany.update(existente, datos);
        console.log(`  ~ ${nombreCompleto(persona)} actualizado (users_company.id=${existente})`);
        return existente;
    }

    const creado = await UserCompany.create(datos);
    const id = creado?.id ?? await buscarPorIdentificacion(persona.numero_identificacion);
    console.log(`  + ${nombreCompleto(persona)} creado (users_company.id=${id})`);
    return id;
}

async function rolesListos() {
    const [rows] = await db.query(
        "SELECT COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'"
    );
    const ct = rows[0]?.ct ?? '';
    return ct.includes("'empleado'") && ct.includes("'director_operaciones'");
}

async function crearLogin(persona) {
    const existente = await User.getByUsername(persona.login.username);
    if (existente) {
        console.log(`  = login '${persona.login.username}' ya existe (users.id=${existente.id})`);
        return existente.id;
    }
    const creado = await User.create({
        username: persona.login.username,
        password: persona.login.password,
        full_name: nombreCompleto(persona),
        role: persona.login.role,
        sede: 'bogota'
    });
    console.log(`  + login '${persona.login.username}' (${persona.login.role})`);
    return creado?.id ?? creado;
}

(async () => {
    try {
        const director = PERSONAS.find(p => p.rol_prueba === 'director');
        const empleados = PERSONAS.filter(p => p.rol_prueba === 'empleado');

        console.log('\n== Fichas de RRHH ==');
        const directorId = await guardarEmpleado(director, null);
        for (const persona of empleados) {
            await guardarEmpleado(persona, directorId);
        }

        console.log('\n== Cuentas de login ==');
        if (await rolesListos()) {
            for (const persona of PERSONAS) await crearLogin(persona);
            console.log("\n  ! Falta vincular users.users_company_id con las fichas (migración 043).");
        } else {
            console.log("  ! Los roles 'director_operaciones' y 'empleado' aún no existen en el ENUM users.role.");
            console.log('    Aplica la migración 043 y vuelve a ejecutar este script para crear los logins.');
        }

        console.log('\n== Resumen ==');
        const [filas] = await db.query(
            `SELECT uc.id,
                    uc.numero_identificacion            AS cedula,
                    uc.nombre_propio                    AS nombre,
                    ca.nombre                           AS cargo,
                    mo.nombre                           AS modalidad,
                    c.jefe_inmediato_id                 AS jefe,
                    hs.salario,
                    (SELECT COUNT(*) FROM seguridad_social ss WHERE ss.users_company_id = uc.id AND ss.activa = 1) AS seg_social,
                    (SELECT COUNT(*) FROM cuenta_bancaria cb WHERE cb.users_company_id = uc.id AND cb.activa = 1)  AS cuentas,
                    (SELECT COUNT(*) FROM direccion d WHERE d.users_company_id = uc.id)                            AS direcciones,
                    (SELECT COUNT(*) FROM contacto_emergencia ce WHERE ce.users_company_id = uc.id)                AS contactos
             FROM users_company uc
             JOIN contrato c        ON c.users_company_id = uc.id
             JOIN cargo ca          ON ca.idcargo = c.cargo_idcargo
             JOIN modalidad mo      ON mo.idmodalidad = c.modalidad_idmodalidad
             LEFT JOIN historial_salarial hs ON hs.contrato_idcontrato = c.idcontrato AND hs.fecha_vigencia_fin IS NULL
             WHERE uc.numero_identificacion LIKE '90000000%'
             ORDER BY uc.id`
        );
        console.table(filas);
        process.exit(0);
    } catch (error) {
        console.error('\nError al crear los datos de prueba:', error.message);
        process.exit(1);
    }
})();
