const db = require('../config/db');
const UserCompany = require('../models/UserCompany');

const CAMPOS_CONTRATO_OBLIGATORIOS = {
    campania_id: 'campaña', area_id: 'área', centro_costo_id: 'centro de costo',
    cargo_id: 'cargo', tipo_contrato_id: 'tipo de contrato', modalidad_id: 'modalidad',
    oleada_id: 'oleada', ciudad_id: 'ciudad del contrato', fecha_ingreso: 'fecha de ingreso'
};

function normalizar(s) {
    if (!s) return '';
    return String(s)
        .replace(/\([^)]*\)/g, '') // "EPS SURA (ANTES SUSALUD)" -> "EPS SURA"
        .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita tildes
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

// El match de catálogo es exacto (tras quitar tildes/paréntesis/mayúsculas) para no
// arriesgar fusiones incorrectas (ej. "Nueva EPS Movilidad" != "Nueva EPS"). Eso deja
// algunos casos reales del archivo sin matchear por diferencias de nombre menores;
// se resuelven aquí a mano en vez de con un algoritmo difuso general.
const SINONIMOS_BANCO = { BBVA: 'BBVA Colombia', 'CAJA SOCIAL': 'Banco Caja Social' };
const SINONIMOS_ENTIDAD_SS = {
    'ARL:SURA': 'ARL Sura',
    'CESANTIAS:PORVENIR': 'Porvenir Cesantías',
    'CESANTIAS:PROTECCION': 'Protección Cesantías'
};

function mapaDesdeFilas(rows) {
    const m = new Map();
    for (const r of rows) m.set(normalizar(r.nombre), r.id);
    return m;
}

// Catálogos con un conjunto cerrado de valores: nunca se crean filas nuevas, solo se
// busca. Si algo no matchea (no debería pasar porque utils/importEmpleadosExcel.js ya
// normaliza a estos nombres), se reporta como advertencia y el campo queda NULL.
async function cargarCatalogosFijos() {
    const [genero] = await db.query('SELECT idgenero AS id, nombre FROM genero');
    const [grupoSanguineo] = await db.query('SELECT idgrupo_sanguineo AS id, nombre FROM grupo_sanguineo');
    const [estadoCivil] = await db.query('SELECT idestado_civil AS id, nombre FROM estado_civil');
    const [modalidad] = await db.query('SELECT idmodalidad AS id, nombre FROM modalidad');
    const [tipoCuenta] = await db.query('SELECT idtipo_cuenta AS id, nombre FROM tipo_cuenta');
    const [area] = await db.query('SELECT idarea AS id, nombre FROM area');
    const [tipoDireccion] = await db.query('SELECT idtipo_direccion AS id, nombre FROM tipo_direccion');
    const [zonaDireccion] = await db.query('SELECT idzona_direccion AS id, nombre FROM zona_direccion');
    const [parentesco] = await db.query('SELECT idparentesco AS id, nombre FROM parentesco');
    const [tipoVacuna] = await db.query('SELECT idtipo_vacuna AS id, nombre FROM tipo_vacuna');
    const [tipoRecurso] = await db.query('SELECT idtipo_recurso AS id, nombre FROM tipo_recurso');
    const [estadoContrato] = await db.query("SELECT idestado_contrato AS id FROM estado_contrato WHERE nombre = 'activo'");

    // Catálogos nuevos de la migración 050 (Excel de nómina) — mismo criterio que el
    // resto de catálogos cerrados de esta función: solo lectura, nunca se crean filas
    // nuevas (ver nota de la migración: sembrados solo con lo visto en el ejemplo).
    const [empresa] = await db.query('SELECT idempresa AS id, nombre FROM empresa');
    const [claseContrato] = await db.query('SELECT idclase_contrato AS id, nombre FROM clase_contrato');
    const [periodoPago] = await db.query('SELECT idperiodo_pago AS id, nombre FROM periodo_pago');
    const [clasificacionDian] = await db.query('SELECT idclasificacion_dian AS id, nombre FROM clasificacion_dian');
    const [tipoSena] = await db.query('SELECT idtipo_sena AS id, nombre FROM tipo_sena');
    const [tipoCotizante] = await db.query('SELECT idtipo_cotizante AS id, nombre FROM tipo_cotizante');
    const [subtipoCotizante] = await db.query('SELECT idsubtipo_cotizante AS id, nombre FROM subtipo_cotizante');

    return {
        genero: mapaDesdeFilas(genero),
        grupoSanguineo: mapaDesdeFilas(grupoSanguineo),
        estadoCivil: mapaDesdeFilas(estadoCivil),
        modalidad: mapaDesdeFilas(modalidad),
        tipoCuenta: mapaDesdeFilas(tipoCuenta),
        area: mapaDesdeFilas(area),
        zonaDireccion: mapaDesdeFilas(zonaDireccion),
        parentesco: mapaDesdeFilas(parentesco),
        tipoVacuna: mapaDesdeFilas(tipoVacuna),
        tipoRecurso: mapaDesdeFilas(tipoRecurso),
        empresa: mapaDesdeFilas(empresa),
        claseContrato: mapaDesdeFilas(claseContrato),
        periodoPago: mapaDesdeFilas(periodoPago),
        clasificacionDian: mapaDesdeFilas(clasificacionDian),
        tipoSena: mapaDesdeFilas(tipoSena),
        tipoCotizante: mapaDesdeFilas(tipoCotizante),
        subtipoCotizante: mapaDesdeFilas(subtipoCotizante),
        tipoDireccionResidenciaId: tipoDireccion.find(r => normalizar(r.nombre) === normalizar('Residencia'))?.id ?? null,
        estadoContratoActivoId: estadoContrato[0]?.id ?? null
    };
}

// Núcleo de "buscar o crear" para catálogos abiertos (campaña, cargo, centro de costo,
// ciudad, banco, oleada, entidad de seguridad social, tipo de identificación...).
// `cache` vive durante todo el import para no repetir SELECTs ni crear el mismo valor
// dos veces dentro del mismo lote. En modo previsualización (dryRun) nunca inserta:
// devuelve un id negativo de marcador y solo registra qué se crearía.
function crearBuscadorAbierto(dryRun, nuevosPorTabla) {
    const cache = new Map();
    return async function buscarOCrear(cacheKey, cargar, crear, valorCrudo, etiqueta) {
        if (!valorCrudo) return null;
        if (!cache.has(cacheKey)) cache.set(cacheKey, await cargar());
        const mapa = cache.get(cacheKey);
        const norm = normalizar(valorCrudo);
        if (mapa.has(norm)) return mapa.get(norm);

        const valorLimpio = (valorCrudo.replace(/\([^)]*\)/g, '').trim() || valorCrudo.trim());
        if (dryRun) {
            const idFicticio = -(mapa.size + 1);
            mapa.set(norm, idFicticio);
            if (!nuevosPorTabla[etiqueta]) nuevosPorTabla[etiqueta] = [];
            nuevosPorTabla[etiqueta].push(valorLimpio);
            return idFicticio;
        }
        const id = await crear(valorLimpio);
        mapa.set(norm, id);
        if (!nuevosPorTabla[etiqueta]) nuevosPorTabla[etiqueta] = [];
        nuevosPorTabla[etiqueta].push(valorLimpio);
        return id;
    };
}

// Arma el "resolver" completo para una corrida de import (preview o commit). Comparte
// caché y el reporte de catálogos nuevos entre todas las filas del archivo.
async function crearResolver({ dryRun }) {
    const fijos = await cargarCatalogosFijos();
    const nuevosPorTabla = {};
    const buscarOCrear = crearBuscadorAbierto(dryRun, nuevosPorTabla);

    return {
        nuevosPorTabla,

        identificacion: (codigo) => buscarOCrear(
            'tipo_identificacion',
            () => db.query('SELECT idtipo_identificacion AS id, codigo AS nombre FROM tipo_identificacion').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO tipo_identificacion (nombre, codigo) VALUES (?, ?)', [valor, valor]);
                return r.insertId;
            },
            codigo, 'tipo_identificacion'
        ),

        ciudad: (nombre) => buscarOCrear(
            'ciudad',
            () => db.query('SELECT idciudad AS id, nombre FROM ciudad').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO ciudad (nombre) VALUES (?)', [valor]);
                return r.insertId;
            },
            nombre, 'ciudad'
        ),

        cliente: (nombre) => buscarOCrear(
            'cliente',
            () => db.query('SELECT idCliente AS id, nombre FROM cliente').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                // nit placeholder: el Excel no trae NIT real de los clientes nuevos (BEEMO, etc.)
                const nitPlaceholder = `SIN-NIT-${valor.replace(/\s+/g, '-').toUpperCase()}`;
                const [r] = await db.query('INSERT INTO cliente (nombre, nit) VALUES (?, ?)', [valor, nitPlaceholder]);
                return r.insertId;
            },
            nombre, 'cliente (sin NIT real, revisar manualmente)'
        ),

        campania: async (nombre, clienteId) => buscarOCrear(
            'campania',
            () => db.query('SELECT idcampania AS id, nombre FROM campania').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO campania (nombre, Cliente_idCliente) VALUES (?, ?)', [valor, clienteId]);
                return r.insertId;
            },
            nombre, 'campaña'
        ),

        centroCosto: (nombre, codigo) => buscarOCrear(
            'centro_costo',
            () => db.query('SELECT idcentro_costo AS id, nombre FROM centro_costo').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO centro_costo (codigo, nombre) VALUES (?, ?)', [codigo || valor, valor]);
                return r.insertId;
            },
            nombre, 'centro_costo'
        ),

        cargo: (nombre) => buscarOCrear(
            'cargo',
            () => db.query('SELECT idcargo AS id, nombre FROM cargo').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO cargo (nombre) VALUES (?)', [valor]);
                return r.insertId;
            },
            nombre, 'cargo'
        ),

        tipoContrato: (nombre) => buscarOCrear(
            'tipo_contrato',
            () => db.query('SELECT idtipo_contrato AS id, nombre FROM tipo_contrato').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO tipo_contrato (nombre) VALUES (?)', [valor]);
                return r.insertId;
            },
            nombre, 'tipo_contrato'
        ),

        banco: (nombre) => buscarOCrear(
            'banco',
            () => db.query('SELECT idbanco AS id, nombre FROM banco').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO banco (nombre) VALUES (?)', [valor]);
                return r.insertId;
            },
            SINONIMOS_BANCO[nombre?.toUpperCase()] || nombre, 'banco'
        ),

        // La oleada es NOT NULL fecha_inicio; al crear una nueva se usa la fecha de
        // ingreso más antigua vista en el archivo para ese nombre de oleada.
        oleada: (nombre, fechaIngresoProxy) => buscarOCrear(
            'oleada',
            () => db.query('SELECT idoleada AS id, nombre FROM oleada').then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO oleada (nombre, fecha_inicio) VALUES (?, ?)', [valor, fechaIngresoProxy]);
                return r.insertId;
            },
            nombre, 'oleada'
        ),

        entidadSeguridadSocial: (tipo, nombre) => buscarOCrear(
            `entidad_seguridad_social:${tipo}`,
            () => db.query('SELECT identidad_seguridad_social AS id, nombre FROM entidad_seguridad_social WHERE tipo = ?', [tipo]).then(([r]) => mapaDesdeFilas(r)),
            async (valor) => {
                const [r] = await db.query('INSERT INTO entidad_seguridad_social (tipo, nombre) VALUES (?, ?)', [tipo, valor]);
                return r.insertId;
            },
            SINONIMOS_ENTIDAD_SS[`${tipo}:${nombre?.toUpperCase()}`] || nombre, `entidad_seguridad_social (${tipo})`
        ),

        // ---- catálogos cerrados (solo lectura, no crean filas) ----
        genero: (nombre) => fijos.genero.get(normalizar(nombre)) ?? null,
        grupoSanguineo: (nombre) => fijos.grupoSanguineo.get(normalizar(nombre)) ?? null,
        estadoCivil: (nombre) => fijos.estadoCivil.get(normalizar(nombre)) ?? null,
        modalidad: (nombre) => fijos.modalidad.get(normalizar(nombre)) ?? null,
        tipoCuenta: (nombre) => fijos.tipoCuenta.get(normalizar(nombre)) ?? null,
        area: (nombre) => fijos.area.get(normalizar(nombre)) ?? null,
        zonaDireccion: (nombre) => fijos.zonaDireccion.get(normalizar(nombre)) ?? null,
        parentesco: (nombre) => fijos.parentesco.get(normalizar(nombre)) ?? fijos.parentesco.get(normalizar('Otro')) ?? null,
        tipoVacuna: (nombre) => fijos.tipoVacuna.get(normalizar(nombre)) ?? null,
        tipoRecursoId: (nombre) => fijos.tipoRecurso.get(normalizar(nombre)) ?? null,
        empresa: (nombre) => fijos.empresa.get(normalizar(nombre)) ?? null,
        claseContrato: (nombre) => fijos.claseContrato.get(normalizar(nombre)) ?? null,
        periodoPago: (nombre) => fijos.periodoPago.get(normalizar(nombre)) ?? null,
        clasificacionDian: (nombre) => fijos.clasificacionDian.get(normalizar(nombre)) ?? null,
        tipoSena: (nombre) => fijos.tipoSena.get(normalizar(nombre)) ?? null,
        tipoCotizante: (nombre) => fijos.tipoCotizante.get(normalizar(nombre)) ?? null,
        subtipoCotizante: (nombre) => fijos.subtipoCotizante.get(normalizar(nombre)) ?? null,
        tipoDireccionResidenciaId: () => fijos.tipoDireccionResidenciaId,
        estadoContratoActivoId: () => fijos.estadoContratoActivoId
    };
}

async function construirDataEmpleado(fila, resolver, advertencias) {
    const tipoIdentificacionId = await resolver.identificacion(fila.tipo_id_codigo);
    const tipoIdentificacionSecundariaId = fila.tipo_id_secundaria_codigo
        ? await resolver.identificacion(fila.tipo_id_secundaria_codigo)
        : null;

    const ciudadExpedicionId = fila.ciudad_expedicion_nombre ? await resolver.ciudad(fila.ciudad_expedicion_nombre) : null;
    const ciudadNacimientoId = fila.ciudad_nacimiento_nombre ? await resolver.ciudad(fila.ciudad_nacimiento_nombre) : null;
    // El Excel no trae una "ciudad de residencia" separada de "ciudad donde labora";
    // se usa la misma para el contrato y como ciudad de la dirección de residencia.
    const ciudadLaboraId = await resolver.ciudad(fila.ciudad_labora_nombre);

    const generoId = fila.genero_nombre ? resolver.genero(fila.genero_nombre) : null;
    const grupoSanguineoId = fila.grupo_sanguineo_nombre ? resolver.grupoSanguineo(fila.grupo_sanguineo_nombre) : null;

    let estadoCivilId = null;
    if (fila.estado_civil_raw) {
        estadoCivilId = resolver.estadoCivil(fila.estado_civil_raw);
        if (!estadoCivilId) advertencias.push(`Fila ${fila.numero_fila}: estado civil "${fila.estado_civil_raw}" no reconocido, se dejó vacío.`);
    }

    const clienteId = await resolver.cliente(fila.cliente_nombre);
    const campaniaId = await resolver.campania(fila.campania_nombre, clienteId);
    const centroCostoId = await resolver.centroCosto(fila.centro_costo_nombre, fila.centro_costo_codigo);
    const cargoId = await resolver.cargo(fila.cargo_nombre);
    const tipoContratoId = await resolver.tipoContrato(fila.tipo_contrato_nombre);
    const modalidadId = fila.modalidad_nombre ? resolver.modalidad(fila.modalidad_nombre) : null;
    const oleadaId = await resolver.oleada(fila.oleada_nombre, fila.fecha_ingreso);

    const areaId = fila.area_nombre ? resolver.area(fila.area_nombre) : null;
    if (fila.area_nombre && !areaId) advertencias.push(`Fila ${fila.numero_fila}: área "${fila.area_nombre}" no reconocida, se dejó vacía.`);

    const epsId = fila.eps_nombre ? await resolver.entidadSeguridadSocial('EPS', fila.eps_nombre) : null;
    const arlId = fila.arl_nombre ? await resolver.entidadSeguridadSocial('ARL', fila.arl_nombre) : null;
    const afpId = fila.afp_nombre ? await resolver.entidadSeguridadSocial('AFP', fila.afp_nombre) : null;
    const cesantiasId = fila.cesantias_nombre ? await resolver.entidadSeguridadSocial('CESANTIAS', fila.cesantias_nombre) : null;
    const cajaId = fila.caja_nombre ? await resolver.entidadSeguridadSocial('CAJA', fila.caja_nombre) : null;

    const bancoId = fila.banco_nombre ? await resolver.banco(fila.banco_nombre) : null;
    const tipoCuentaId = fila.cuenta_tipo_nombre ? resolver.tipoCuenta(fila.cuenta_tipo_nombre) : null;

    // Catálogos nuevos de la migración 050 — cerrados (solo lectura), advertencia si
    // el archivo trae un valor que no está sembrado, mismo criterio que estado_civil/área.
    const cerrado = (campo, nombre, etiqueta) => {
        if (!nombre) return null;
        const id = resolver[campo](nombre);
        if (!id) advertencias.push(`Fila ${fila.numero_fila}: ${etiqueta} "${nombre}" no está en el catálogo, se dejó vacío.`);
        return id;
    };
    const empresaId = cerrado('empresa', fila.empresa_nombre, 'empresa');
    const claseContratoId = cerrado('claseContrato', fila.clase_nombre, 'clase');
    const periodoPagoId = cerrado('periodoPago', fila.periodo_pago_nombre, 'periodo de pago');
    const clasificacionDianId = cerrado('clasificacionDian', fila.clasificacion_dian_nombre, 'clasificación Dian');
    const tipoSenaId = cerrado('tipoSena', fila.tipo_sena_nombre, 'tipo Sena');
    const tipoCotizanteId = cerrado('tipoCotizante', fila.tipo_cotizante_nombre, 'tipo cotizante');
    const subtipoCotizanteId = cerrado('subtipoCotizante', fila.subtipo_cotizante_nombre, 'subtipo de cotizante');

    const data = {
        numero_identificacion: fila.numero_identificacion,
        tipo_identificacion_id: tipoIdentificacionId,
        numero_identificacion_secundaria: fila.numero_identificacion_secundaria,
        tipo_identificacion_secundaria_id: tipoIdentificacionSecundariaId,
        fecha_expedicion: fila.fecha_expedicion,
        ciudad_expedicion_id: ciudadExpedicionId,
        primer_nombre: fila.primer_nombre,
        segundo_nombre: fila.segundo_nombre,
        primer_apellido: fila.primer_apellido,
        segundo_apellido: fila.segundo_apellido,
        fecha_nacimiento: fila.fecha_nacimiento,
        ciudad_nacimiento_id: ciudadNacimientoId,
        numero_hijos: fila.numero_hijos,
        estado_civil_id: estadoCivilId,
        grupo_sanguineo_id: grupoSanguineoId,
        genero_id: generoId,
        email: fila.email,
        telefono: fila.telefono,
        usuario_ssff: fila.usuario_ssff,
        rut: fila.rut,
        declarante_renta: fila.declarante_renta,
        libreta_militar_numero: fila.libreta_militar_numero,
        contrato: {
            campania_id: campaniaId,
            area_id: areaId,
            centro_costo_id: centroCostoId,
            cargo_id: cargoId,
            cargo_ssff: fila.cargo_ssff,
            tipo_contrato_id: tipoContratoId,
            modalidad_id: modalidadId,
            oleada_id: oleadaId,
            ciudad_id: ciudadLaboraId,
            piso: fila.piso,
            estado_contrato_id: resolver.estadoContratoActivoId(),
            fecha_ingreso: fila.fecha_ingreso,
            fecha_fin_periodo_prueba: fila.fecha_fin_periodo_prueba,
            fecha_fin_contrato: fila.fecha_fin_contrato,
            observaciones: fila.observaciones,
            fecha_entrega_certificacion_laboral: fila.fecha_entrega_certificacion_laboral,
            empresa_id: empresaId,
            clase_contrato_id: claseContratoId,
            periodo_pago_id: periodoPagoId,
            clasificacion_dian_id: clasificacionDianId,
            tipo_sena_id: tipoSenaId,
            tipo_cotizante_id: tipoCotizanteId,
            subtipo_cotizante_id: subtipoCotizanteId,
            aplica_dotacion: fila.aplica_dotacion
            // jefe_inmediato_id / jefe_area_id / director_area_id / analista_encargado_id:
            // se resuelven en una segunda pasada, una vez que todos los empleados del
            // lote ya existen (ver resolverJefesYAnalistas).
        },
        salario: {
            salario: fila.salario,
            bono_no_prestacional: fila.bono_no_prestacional,
            bono_cafeteria: fila.bono_cafeteria
        },
        seguridad_social: {
            eps_id: epsId, arl_id: arlId, afp_id: afpId, cesantias_id: cesantiasId, caja_id: cajaId,
            tarifa_arl: fila.tarifa_arl,
            eps_fecha_afiliacion: fila.eps_fecha_afiliacion,
            arl_fecha_afiliacion: fila.arl_fecha_afiliacion,
            afp_fecha_afiliacion: fila.afp_fecha_afiliacion,
            cesantias_fecha_afiliacion: fila.cesantias_fecha_afiliacion,
            caja_fecha_afiliacion: fila.caja_fecha_afiliacion
        },
        cuenta_bancaria: (bancoId && tipoCuentaId && fila.cuenta_numero)
            ? { numero_cuenta: fila.cuenta_numero, banco_id: bancoId, tipo_cuenta_id: tipoCuentaId }
            : {},
        direccion: fila.direccion
            ? {
                tipo_direccion_id: resolver.tipoDireccionResidenciaId(),
                direccion: fila.direccion,
                barrio: fila.barrio,
                ciudad_id: ciudadLaboraId,
                zona_direccion_id: fila.zona_direccion_nombre ? resolver.zonaDireccion(fila.zona_direccion_nombre) : null
            }
            : {},
        contacto_emergencia: fila.contacto_emergencia
            ? {
                nombre: fila.contacto_emergencia.nombre,
                telefono: fila.contacto_emergencia.telefono,
                parentesco_id: resolver.parentesco(fila.contacto_emergencia.parentesco_nombre)
            }
            : {}
    };

    return data;
}

function validarContrato(data) {
    const faltantes = Object.entries(CAMPOS_CONTRATO_OBLIGATORIOS)
        .filter(([campo]) => !data.contrato[campo])
        .map(([, nombre]) => nombre);
    if (faltantes.length > 0) return `Faltan campos obligatorios del contrato: ${faltantes.join(', ')}`;
    if (!data.salario.salario || Number(data.salario.salario) <= 0) return 'El salario es obligatorio y debe ser mayor a cero';
    return null;
}

async function previsualizar(filas) {
    const resolver = await crearResolver({ dryRun: true });
    const advertencias = [];
    let aCrear = 0;
    let aActualizar = 0;
    const errores = [];

    for (const fila of filas) {
        try {
            const data = await construirDataEmpleado(fila, resolver, advertencias);
            const errorValidacion = validarContrato(data);
            if (errorValidacion) {
                errores.push({ fila: fila.numero_fila, nombre: fila.nombre_completo, mensaje: errorValidacion });
                continue;
            }
            const existeId = await UserCompany.getIdByIdentificacion(data.tipo_identificacion_id, data.numero_identificacion);
            if (existeId) aActualizar++; else aCrear++;
        } catch (e) {
            errores.push({ fila: fila.numero_fila, nombre: fila.nombre_completo, mensaje: e.message });
        }
    }

    return {
        total_filas: filas.length,
        a_crear: aCrear,
        a_actualizar: aActualizar,
        catalogos_nuevos: resolver.nuevosPorTabla,
        advertencias: [...advertencias, ...filas.flatMap(f => f.advertencias)],
        errores
    };
}

// ---- tablas auxiliares (vacunación / dotación / recursos) — mejor esfuerzo, no
// revierten el alta del empleado si fallan. ----

async function guardarVacunacion(ucId, fila, resolver, advertencias) {
    if (!fila.vacunacion) return;
    const tipoVacunaId = resolver.tipoVacuna(fila.vacunacion.tipo_vacuna_nombre);
    if (!tipoVacunaId) advertencias.push(`Fila ${fila.numero_fila}: vacuna "${fila.vacunacion.tipo_vacuna_nombre}" no está en el catálogo, se guardó sin tipo.`);
    await db.query(
        `INSERT INTO vacunacion_covid (users_company_id, tipo_vacuna_idtipo_vacuna, primera_dosis_fecha, segunda_dosis_fecha)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tipo_vacuna_idtipo_vacuna = VALUES(tipo_vacuna_idtipo_vacuna),
            primera_dosis_fecha = VALUES(primera_dosis_fecha), segunda_dosis_fecha = VALUES(segunda_dosis_fecha)`,
        [ucId, tipoVacunaId, fila.vacunacion.primera_dosis, fila.vacunacion.segunda_dosis]
    );
}

// dotacion es un historial (1:N) por diseño — pero reimportar el mismo Excel sin
// cambios no debe crear una entrega nueva cada vez. Solo inserta si la última entrega
// registrada trae tallas distintas.
async function guardarDotacion(ucId, fila) {
    if (!fila.dotacion) return;
    const [ultimas] = await db.query(
        'SELECT talla_camisa, talla_pantalon, talla_calzado FROM dotacion WHERE users_company_id = ? ORDER BY iddotacion DESC LIMIT 1',
        [ucId]
    );
    const ultima = ultimas[0];
    const igual = ultima
        && ultima.talla_camisa === fila.dotacion.talla_camisa
        && ultima.talla_pantalon === fila.dotacion.talla_pantalon
        && ultima.talla_calzado === fila.dotacion.talla_calzado;
    if (igual) return;
    await db.query(
        `INSERT INTO dotacion (users_company_id, talla_camisa, talla_pantalon, talla_calzado)
         VALUES (?, ?, ?, ?)`,
        [ucId, fila.dotacion.talla_camisa, fila.dotacion.talla_pantalon, fila.dotacion.talla_calzado]
    );
}

// Igual que dotación: no crea una asignación activa duplicada del mismo recurso si ya
// hay una vigente con el mismo identificador para este empleado.
async function guardarRecursos(ucId, fila, resolver) {
    const candidatos = [];
    if (fila.diadema_serial) candidatos.push({ tipoRecursoId: resolver.tipoRecursoId('diadema'), identificador: fila.diadema_serial });
    if (fila.locker_numero) candidatos.push({ tipoRecursoId: resolver.tipoRecursoId('locker'), identificador: fila.locker_numero });
    if (fila.carnet_entregado) candidatos.push({ tipoRecursoId: resolver.tipoRecursoId('carnet'), identificador: null });

    for (const { tipoRecursoId, identificador } of candidatos) {
        if (!tipoRecursoId) continue;
        const [activos] = await db.query(
            `SELECT idasignacion_recurso FROM asignacion_recurso
             WHERE users_company_id = ? AND tipo_recurso_idtipo_recurso = ? AND activa = 1
                AND identificador ${identificador === null ? 'IS NULL' : '= ?'}`,
            identificador === null ? [ucId, tipoRecursoId] : [ucId, tipoRecursoId, identificador]
        );
        if (activos.length > 0) continue;
        await db.query(
            `INSERT INTO asignacion_recurso (users_company_id, tipo_recurso_idtipo_recurso, identificador, activa)
             VALUES (?, ?, ?, 1)`,
            [ucId, tipoRecursoId, identificador]
        );
    }
}

async function resolverJefesYAnalistas(resultadosExitosos, filasPorNumero, advertencias) {
    const mapaNombres = await UserCompany.getMapaIdsPorNombre();
    const buscarPorNombre = (nombre) => {
        if (!nombre) return null;
        const norm = nombre.trim().toUpperCase().replace(/\s+/g, ' ');
        return mapaNombres.get(norm) ?? null;
    };

    const noResueltos = new Set();
    for (const resultado of resultadosExitosos) {
        const fila = filasPorNumero.get(resultado.fila);
        if (!fila) continue;
        const jefeInmediatoId = buscarPorNombre(fila.jefe_inmediato_nombre);
        const jefeAreaId = buscarPorNombre(fila.jefe_area_nombre);
        const directorAreaId = buscarPorNombre(fila.director_area_nombre);
        const analistaId = buscarPorNombre(fila.analista_encargado_nombre);

        if (fila.jefe_inmediato_nombre && !jefeInmediatoId) noResueltos.add(fila.jefe_inmediato_nombre);
        if (fila.jefe_area_nombre && !jefeAreaId) noResueltos.add(fila.jefe_area_nombre);
        if (fila.director_area_nombre && !directorAreaId) noResueltos.add(fila.director_area_nombre);
        if (fila.analista_encargado_nombre && !analistaId) noResueltos.add(fila.analista_encargado_nombre);

        if (!jefeInmediatoId && !jefeAreaId && !directorAreaId && !analistaId) continue;

        await db.query(
            `UPDATE contrato SET jefe_inmediato_id = COALESCE(?, jefe_inmediato_id),
                jefe_area_id = COALESCE(?, jefe_area_id),
                director_area_id = COALESCE(?, director_area_id),
                analista_encargado_id = COALESCE(?, analista_encargado_id)
             WHERE idcontrato = (SELECT idcontrato FROM (SELECT idcontrato FROM contrato WHERE users_company_id = ? ORDER BY idcontrato DESC LIMIT 1) t)`,
            [jefeInmediatoId, jefeAreaId, directorAreaId, analistaId, resultado.id]
        );
    }

    if (noResueltos.size > 0) {
        advertencias.push(`No se encontraron como empleados (jefe/analista sin vincular, se dejó NULL): ${[...noResueltos].join(', ')}`);
    }
}

async function confirmar(filas) {
    const resolver = await crearResolver({ dryRun: false });
    const advertencias = [];
    const resultados = [];
    const filasPorNumero = new Map(filas.map(f => [f.numero_fila, f]));

    for (const fila of filas) {
        try {
            const data = await construirDataEmpleado(fila, resolver, advertencias);
            const errorValidacion = validarContrato(data);
            if (errorValidacion) {
                resultados.push({ fila: fila.numero_fila, cedula: fila.numero_identificacion, nombre: fila.nombre_completo, accion: 'error', mensaje: errorValidacion });
                continue;
            }

            const existeId = await UserCompany.getIdByIdentificacion(data.tipo_identificacion_id, data.numero_identificacion);
            let ucId;
            let accion;
            if (existeId) {
                await UserCompany.update(existeId, data);
                ucId = existeId;
                accion = 'actualizado';
            } else {
                const creado = await UserCompany.create(data);
                ucId = creado.id;
                accion = 'creado';
            }

            await guardarVacunacion(ucId, fila, resolver, advertencias);
            await guardarDotacion(ucId, fila);
            await guardarRecursos(ucId, fila, resolver);

            resultados.push({ fila: fila.numero_fila, cedula: fila.numero_identificacion, nombre: fila.nombre_completo, id: ucId, accion });
        } catch (e) {
            resultados.push({ fila: fila.numero_fila, cedula: fila.numero_identificacion, nombre: fila.nombre_completo, accion: 'error', mensaje: e.message });
        }
    }

    const exitosos = resultados.filter(r => r.accion !== 'error');
    await resolverJefesYAnalistas(exitosos, filasPorNumero, advertencias);

    return {
        total_filas: filas.length,
        creados: resultados.filter(r => r.accion === 'creado').length,
        actualizados: resultados.filter(r => r.accion === 'actualizado').length,
        con_error: resultados.filter(r => r.accion === 'error').length,
        catalogos_nuevos: resolver.nuevosPorTabla,
        advertencias: [...advertencias, ...filas.flatMap(f => f.advertencias)],
        resultados
    };
}

module.exports = { previsualizar, confirmar };
