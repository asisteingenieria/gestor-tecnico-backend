const db = require('../config/db');

const SELECT_EMPLEADO = `
    SELECT
        uc.*,
        ti.nombre AS tipo_identificacion_nombre,
        ti.codigo AS tipo_identificacion_codigo,
        ec.nombre AS estado_civil_nombre,
        gs.nombre AS grupo_sanguineo_nombre,
        g.nombre  AS genero_nombre,
        cn.nombre AS ciudad_nacimiento_nombre,
        cex.nombre AS ciudad_expedicion_nombre,
        CONCAT_WS(' ', uc.primer_nombre, uc.segundo_nombre, uc.primer_apellido, uc.segundo_apellido) AS nombre_completo,
        (SELECT COUNT(*) FROM activos a WHERE a.agente_id = uc.id) AS total_activos,
        c.idcontrato,
        c.fecha_ingreso,
        cam.nombre  AS campania_nombre,
        car.nombre  AS cargo_nombre,
        ar.nombre   AS area_nombre,
        tc.nombre   AS tipo_contrato_nombre,
        esc.nombre  AS estado_contrato_nombre,
        hs.salario  AS salario,
        CONCAT_WS(' ', ana.primer_nombre, ana.segundo_nombre, ana.primer_apellido, ana.segundo_apellido) AS analista_encargado_nombre
    FROM users_company uc
    JOIN tipo_identificacion ti ON uc.tipo_identificacion_idtipo_identificacion = ti.idtipo_identificacion
    LEFT JOIN estado_civil    ec  ON uc.estado_civil_idestado_civil = ec.idestado_civil
    LEFT JOIN grupo_sanguineo gs  ON uc.grupo_sanguineo_idgrupo_sanguineo = gs.idgrupo_sanguineo
    LEFT JOIN genero          g   ON uc.genero_idgenero = g.idgenero
    LEFT JOIN ciudad          cn  ON uc.ciudad_nacimiento_id = cn.idciudad
    LEFT JOIN ciudad          cex ON uc.ciudad_expedicion_id = cex.idciudad
    LEFT JOIN contrato c ON c.idcontrato = (
        SELECT MAX(c2.idcontrato) FROM contrato c2 WHERE c2.users_company_id = uc.id
    )
    LEFT JOIN campania        cam ON c.campania_idcampania = cam.idcampania
    LEFT JOIN cargo           car ON c.cargo_idcargo = car.idcargo
    LEFT JOIN area            ar  ON c.area_idarea = ar.idarea
    LEFT JOIN tipo_contrato   tc  ON c.tipo_contrato_idtipo_contrato = tc.idtipo_contrato
    LEFT JOIN estado_contrato esc ON c.estado_contrato_idestado_contrato = esc.idestado_contrato
    LEFT JOIN historial_salarial hs ON hs.contrato_idcontrato = c.idcontrato AND hs.fecha_vigencia_fin IS NULL
    LEFT JOIN users_company  ana ON c.analista_encargado_id = ana.id
`;

// Mapea las claves del payload de seguridad social a su tipo en BD
const TIPOS_SEGURIDAD_SOCIAL = {
    eps_id: 'EPS',
    arl_id: 'ARL',
    afp_id: 'AFP',
    cesantias_id: 'CESANTIAS',
    caja_id: 'CAJA'
};

function val(x) {
    return x === undefined || x === null || x === '' ? null : x;
}

function nombrePropio(data) {
    return [data.primer_nombre, data.segundo_nombre, data.primer_apellido, data.segundo_apellido]
        .filter(Boolean)
        .join(' ');
}

function camposPersonales(data) {
    return [
        data.numero_identificacion, data.tipo_identificacion_id,
        val(data.numero_identificacion_secundaria), val(data.tipo_identificacion_secundaria_id),
        val(data.fecha_expedicion), val(data.ciudad_expedicion_id),
        data.primer_nombre, val(data.segundo_nombre), data.primer_apellido, val(data.segundo_apellido), nombrePropio(data),
        val(data.fecha_nacimiento), val(data.ciudad_nacimiento_id), data.numero_hijos ?? 0,
        val(data.estado_civil_id), val(data.grupo_sanguineo_id), val(data.genero_id),
        val(data.email), val(data.telefono), val(data.usuario_ssff), val(data.rut),
        data.declarante_renta ? 1 : 0, val(data.libreta_militar_numero)
    ];
}

async function clienteDeCampania(conn, campaniaId) {
    const [rows] = await conn.query('SELECT Cliente_idCliente FROM campania WHERE idcampania = ?', [campaniaId]);
    if (rows.length === 0) throw new Error('La campaña seleccionada no existe');
    return rows[0].Cliente_idCliente;
}

async function estadoContratoActivo(conn) {
    const [rows] = await conn.query("SELECT idestado_contrato FROM estado_contrato WHERE nombre = 'activo'");
    if (rows.length === 0) throw new Error("No existe el estado de contrato 'activo' (ejecutar migración 035)");
    return rows[0].idestado_contrato;
}

async function insertarContrato(conn, ucId, contrato) {
    const clienteId = await clienteDeCampania(conn, contrato.campania_id);
    const estadoId = val(contrato.estado_contrato_id) || await estadoContratoActivo(conn);

    const [result] = await conn.query(
        `INSERT INTO contrato (
            users_company_id, Cliente_idCliente, campania_idcampania,
            area_idarea, centro_costo_idcentro_costo, cargo_idcargo, cargo_ssff,
            tipo_contrato_idtipo_contrato, modalidad_idmodalidad, oleada_idoleada,
            ciudad_idciudad, piso, estado_contrato_idestado_contrato,
            jefe_inmediato_id, jefe_area_id, director_area_id, analista_encargado_id,
            fecha_ingreso, fecha_fin_periodo_prueba, fecha_fin_contrato, observaciones,
            fecha_entrega_certificacion_laboral,
            empresa_id, clase_contrato_id, periodo_pago_id, clasificacion_dian_id,
            tipo_sena_id, tipo_cotizante_id, subtipo_cotizante_id, aplica_dotacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            ucId, clienteId, contrato.campania_id,
            contrato.area_id, contrato.centro_costo_id, contrato.cargo_id, val(contrato.cargo_ssff),
            contrato.tipo_contrato_id, contrato.modalidad_id, contrato.oleada_id,
            contrato.ciudad_id, val(contrato.piso), estadoId,
            val(contrato.jefe_inmediato_id), val(contrato.jefe_area_id), val(contrato.director_area_id), val(contrato.analista_encargado_id),
            contrato.fecha_ingreso, val(contrato.fecha_fin_periodo_prueba),
            val(contrato.fecha_fin_contrato), val(contrato.observaciones),
            val(contrato.fecha_entrega_certificacion_laboral),
            val(contrato.empresa_id), val(contrato.clase_contrato_id), val(contrato.periodo_pago_id), val(contrato.clasificacion_dian_id),
            val(contrato.tipo_sena_id), val(contrato.tipo_cotizante_id), val(contrato.subtipo_cotizante_id),
            contrato.aplica_dotacion === false ? 0 : 1
        ]
    );
    return result.insertId;
}

async function insertarSalario(conn, contratoId, salario, fechaInicio) {
    await conn.query(
        `INSERT INTO historial_salarial (salario, bono_no_prestacional, bono_cafeteria, fecha_vigencia_inicio, contrato_idcontrato)
         VALUES (?, ?, ?, ?, ?)`,
        [salario.salario, salario.bono_no_prestacional ?? 0, salario.bono_cafeteria ?? 0, fechaInicio, contratoId]
    );
}

async function guardarSeguridadSocial(conn, ucId, seguridadSocial, fechaReferencia) {
    if (!seguridadSocial) return;

    for (const [clave, tipo] of Object.entries(TIPOS_SEGURIDAD_SOCIAL)) {
        const entidadId = val(seguridadSocial[clave]);
        if (!entidadId) continue;

        // Fecha de afiliación real del empleado (columna "Fecha Afil. X" del Excel de
        // nómina); si el formulario no la trae, se usa la fecha de referencia del
        // contrato como hasta ahora (comportamiento previo, sin romper el import masivo
        // ni datos ya cargados que no envían este campo).
        const fechaAfiliacion = val(seguridadSocial[`${clave.replace('_id', '')}_fecha_afiliacion`]) || fechaReferencia;

        const [actuales] = await conn.query(
            'SELECT idseguridad_social, entidad_seguridad_social_id, fecha_afiliacion FROM seguridad_social WHERE users_company_id = ? AND tipo = ? AND activa = 1',
            [ucId, tipo]
        );

        const tarifaArl = tipo === 'ARL' ? val(seguridadSocial.tarifa_arl) : null;
        const mismaEntidad = actuales.length > 0 && actuales[0].entidad_seguridad_social_id === Number(entidadId);
        const mismaFecha = actuales.length > 0 && String(actuales[0].fecha_afiliacion).substring(0, 10) === String(fechaAfiliacion).substring(0, 10);
        if (mismaEntidad && mismaFecha) continue;

        if (mismaEntidad) {
            // Solo cambió la fecha de afiliación (o la tarifa ARL): se actualiza en el
            // mismo registro, no es un traslado de entidad y no debe cerrar/abrir vigencia.
            await conn.query(
                'UPDATE seguridad_social SET fecha_afiliacion = ?, tarifa_arl = COALESCE(?, tarifa_arl), updated_at = CURRENT_TIMESTAMP WHERE idseguridad_social = ?',
                [fechaAfiliacion, tarifaArl, actuales[0].idseguridad_social]
            );
            continue;
        }

        if (actuales.length > 0) {
            await conn.query(
                'UPDATE seguridad_social SET activa = 0, fecha_fin = CURDATE() WHERE idseguridad_social = ?',
                [actuales[0].idseguridad_social]
            );
        }

        await conn.query(
            `INSERT INTO seguridad_social (tipo, fecha_afiliacion, tarifa_arl, fecha_inicio, activa, users_company_id, entidad_seguridad_social_id)
             VALUES (?, ?, ?, ?, 1, ?, ?)`,
            [tipo, fechaAfiliacion, tarifaArl, fechaReferencia, ucId, entidadId]
        );
    }
}

async function guardarCuentaBancaria(conn, ucId, cuenta) {
    if (!cuenta || !val(cuenta.numero_cuenta) || !val(cuenta.banco_id) || !val(cuenta.tipo_cuenta_id)) return;

    const [actuales] = await conn.query(
        'SELECT idcuenta_bancaria FROM cuenta_bancaria WHERE users_company_id = ? AND activa = 1',
        [ucId]
    );

    if (actuales.length > 0) {
        await conn.query(
            `UPDATE cuenta_bancaria SET numero_cuenta = ?, banco_idbanco = ?, tipo_cuenta_idtipo_cuenta = ?, updated_at = CURRENT_TIMESTAMP
             WHERE idcuenta_bancaria = ?`,
            [cuenta.numero_cuenta, cuenta.banco_id, cuenta.tipo_cuenta_id, actuales[0].idcuenta_bancaria]
        );
    } else {
        await conn.query(
            `INSERT INTO cuenta_bancaria (numero_cuenta, users_company_id, banco_idbanco, tipo_cuenta_idtipo_cuenta)
             VALUES (?, ?, ?, ?)`,
            [cuenta.numero_cuenta, ucId, cuenta.banco_id, cuenta.tipo_cuenta_id]
        );
    }
}

async function guardarDireccion(conn, ucId, direccion) {
    if (!direccion || !val(direccion.direccion) || !val(direccion.tipo_direccion_id)) return;

    const [actuales] = await conn.query(
        'SELECT iddireccion FROM direccion WHERE users_company_id = ? AND es_principal = 1',
        [ucId]
    );

    if (actuales.length > 0) {
        await conn.query(
            `UPDATE direccion SET tipo_direccion_idtipo_direccion = ?, direccion = ?, barrio = ?, ciudad_idciudad = ?, zona_direccion_id = ?, tipo_vivienda_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE iddireccion = ?`,
            [direccion.tipo_direccion_id, direccion.direccion, val(direccion.barrio), val(direccion.ciudad_id), val(direccion.zona_direccion_id), val(direccion.tipo_vivienda_id), actuales[0].iddireccion]
        );
    } else {
        await conn.query(
            `INSERT INTO direccion (tipo_direccion_idtipo_direccion, direccion, barrio, ciudad_idciudad, zona_direccion_id, tipo_vivienda_id, es_principal, users_company_id)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
            [direccion.tipo_direccion_id, direccion.direccion, val(direccion.barrio), val(direccion.ciudad_id), val(direccion.zona_direccion_id), val(direccion.tipo_vivienda_id), ucId]
        );
    }
}

async function guardarVacunacion(conn, ucId, vacunacion) {
    if (!vacunacion || (!val(vacunacion.tipo_vacuna_id) && !val(vacunacion.primera_dosis_fecha) && !val(vacunacion.segunda_dosis_fecha))) return;

    await conn.query(
        `INSERT INTO vacunacion_covid (users_company_id, tipo_vacuna_idtipo_vacuna, primera_dosis_fecha, segunda_dosis_fecha)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE tipo_vacuna_idtipo_vacuna = VALUES(tipo_vacuna_idtipo_vacuna),
            primera_dosis_fecha = VALUES(primera_dosis_fecha), segunda_dosis_fecha = VALUES(segunda_dosis_fecha),
            updated_at = CURRENT_TIMESTAMP`,
        [ucId, val(vacunacion.tipo_vacuna_id), val(vacunacion.primera_dosis_fecha), val(vacunacion.segunda_dosis_fecha)]
    );
}

// dotacion es un historial (1:N) por diseño — guardar la misma talla dos veces no debe
// crear una entrega nueva cada vez (mismo criterio que el import masivo).
async function guardarDotacion(conn, ucId, dotacion) {
    if (!dotacion || !(val(dotacion.talla_camisa) || val(dotacion.talla_pantalon) || val(dotacion.talla_calzado))) return;

    const [ultimas] = await conn.query(
        'SELECT talla_camisa, talla_pantalon, talla_calzado FROM dotacion WHERE users_company_id = ? ORDER BY iddotacion DESC LIMIT 1',
        [ucId]
    );
    const ultima = ultimas[0];
    const igual = ultima
        && ultima.talla_camisa === val(dotacion.talla_camisa)
        && ultima.talla_pantalon === val(dotacion.talla_pantalon)
        && ultima.talla_calzado === val(dotacion.talla_calzado);
    if (igual) return;

    await conn.query(
        `INSERT INTO dotacion (users_company_id, talla_camisa, talla_pantalon, talla_calzado)
         VALUES (?, ?, ?, ?)`,
        [ucId, val(dotacion.talla_camisa), val(dotacion.talla_pantalon), val(dotacion.talla_calzado)]
    );
}

// Igual que dotación: no crea una asignación activa duplicada del mismo recurso si ya
// hay una vigente con el mismo identificador para este empleado (mismo criterio que el
// import masivo — ver services/importEmpleadosService.js::guardarRecursos).
async function guardarRecursos(conn, ucId, recursos) {
    if (!recursos) return;

    const [tipos] = await conn.query('SELECT idtipo_recurso, nombre FROM tipo_recurso');
    const tipoIdPorNombre = (nombre) => tipos.find(t => t.nombre === nombre)?.idtipo_recurso ?? null;

    const candidatos = [];
    if (val(recursos.diadema_serial)) candidatos.push({ tipoRecursoId: tipoIdPorNombre('diadema'), identificador: val(recursos.diadema_serial) });
    if (val(recursos.locker_numero)) candidatos.push({ tipoRecursoId: tipoIdPorNombre('locker'), identificador: val(recursos.locker_numero) });
    if (recursos.carnet_entregado) candidatos.push({ tipoRecursoId: tipoIdPorNombre('carnet'), identificador: null });

    for (const { tipoRecursoId, identificador } of candidatos) {
        if (!tipoRecursoId) continue;
        const [activos] = await conn.query(
            `SELECT idasignacion_recurso FROM asignacion_recurso
             WHERE users_company_id = ? AND tipo_recurso_idtipo_recurso = ? AND activa = 1
                AND identificador ${identificador === null ? 'IS NULL' : '= ?'}`,
            identificador === null ? [ucId, tipoRecursoId] : [ucId, tipoRecursoId, identificador]
        );
        if (activos.length > 0) continue;
        await conn.query(
            `INSERT INTO asignacion_recurso (users_company_id, tipo_recurso_idtipo_recurso, identificador, activa)
             VALUES (?, ?, ?, 1)`,
            [ucId, tipoRecursoId, identificador]
        );
    }
}

async function guardarContactoEmergencia(conn, ucId, contacto) {
    if (!contacto || !val(contacto.nombre) || !val(contacto.telefono) || !val(contacto.parentesco_id)) return;

    const [actuales] = await conn.query(
        'SELECT idcontacto_emergencia FROM contacto_emergencia WHERE users_company_id = ? ORDER BY idcontacto_emergencia LIMIT 1',
        [ucId]
    );

    if (actuales.length > 0) {
        await conn.query(
            `UPDATE contacto_emergencia SET nombre = ?, telefono = ?, parentesco_idparentesco = ?, updated_at = CURRENT_TIMESTAMP
             WHERE idcontacto_emergencia = ?`,
            [contacto.nombre, contacto.telefono, contacto.parentesco_id, actuales[0].idcontacto_emergencia]
        );
    } else {
        await conn.query(
            `INSERT INTO contacto_emergencia (nombre, telefono, parentesco_idparentesco, users_company_id)
             VALUES (?, ?, ?, ?)`,
            [contacto.nombre, contacto.telefono, contacto.parentesco_id, ucId]
        );
    }
}

class UserCompany {
    // `soloSinUsuario`: excluye empleados que ya tienen una cuenta de login vinculada
    // (users.users_company_id) — usado por el selector de creación de usuarios de los
    // roles director_operaciones/empleado, para no ofrecer una ficha ya tomada.
    static async getAll({ soloSinUsuario = false } = {}) {
        let query = SELECT_EMPLEADO;
        if (soloSinUsuario) {
            query += ' LEFT JOIN users usr ON usr.users_company_id = uc.id WHERE usr.id IS NULL';
        }
        query += ' ORDER BY uc.primer_apellido ASC, uc.primer_nombre ASC';
        const [rows] = await db.query(query);
        return rows;
    }

    static async getById(id) {
        const [rows] = await db.query(`
            ${SELECT_EMPLEADO}
            WHERE uc.id = ?
        `, [id]);
        return rows[0];
    }

    // Usado por el import masivo (services/importEmpleadosService.js) para decidir
    // si una fila del Excel es alta o actualización, por la misma llave única que ya
    // usa create()/update().
    static async getIdByIdentificacion(tipoIdentificacionId, numeroIdentificacion) {
        const [rows] = await db.query(
            'SELECT id FROM users_company WHERE tipo_identificacion_idtipo_identificacion = ? AND numero_identificacion = ?',
            [tipoIdentificacionId, numeroIdentificacion]
        );
        return rows[0]?.id ?? null;
    }

    // Mapa nombre_propio normalizado -> id, para resolver por nombre referencias como
    // jefe_area/jefe_inmediato/analista_encargado que el Excel trae como texto libre.
    static async getMapaIdsPorNombre() {
        const [rows] = await db.query(
            "SELECT id, CONCAT_WS(' ', primer_nombre, segundo_nombre, primer_apellido, segundo_apellido) AS nombre_completo FROM users_company"
        );
        const mapa = new Map();
        for (const r of rows) {
            const norm = r.nombre_completo.trim().toUpperCase().replace(/\s+/g, ' ');
            mapa.set(norm, r.id);
        }
        return mapa;
    }

    // Empleado con todos sus registros relacionados (para el formulario de edición)
    static async getByIdCompleto(id) {
        const empleado = await this.getById(id);
        if (!empleado) return null;

        const [contratos] = await db.query(
            'SELECT * FROM contrato WHERE users_company_id = ? ORDER BY idcontrato DESC LIMIT 1',
            [id]
        );
        const contrato = contratos[0] || null;

        let salario = null;
        if (contrato) {
            const [salarios] = await db.query(
                'SELECT * FROM historial_salarial WHERE contrato_idcontrato = ? AND fecha_vigencia_fin IS NULL ORDER BY idhistorial_salarial DESC LIMIT 1',
                [contrato.idcontrato]
            );
            salario = salarios[0] || null;
        }

        const [segSocial] = await db.query(
            `SELECT ss.tipo, ss.entidad_seguridad_social_id, ss.tarifa_arl, ss.fecha_afiliacion, ess.nombre AS entidad_nombre
             FROM seguridad_social ss
             JOIN entidad_seguridad_social ess ON ss.entidad_seguridad_social_id = ess.identidad_seguridad_social
             WHERE ss.users_company_id = ? AND ss.activa = 1`,
            [id]
        );
        const seguridad_social = {};
        for (const [clave, tipo] of Object.entries(TIPOS_SEGURIDAD_SOCIAL)) {
            const row = segSocial.find(s => s.tipo === tipo);
            seguridad_social[clave] = row ? row.entidad_seguridad_social_id : null;
            seguridad_social[`${clave.replace('_id', '')}_fecha_afiliacion`] = row ? row.fecha_afiliacion : null;
            if (tipo === 'ARL' && row) seguridad_social.tarifa_arl = row.tarifa_arl;
        }

        const [cuentas] = await db.query(
            'SELECT * FROM cuenta_bancaria WHERE users_company_id = ? AND activa = 1 LIMIT 1',
            [id]
        );

        const [direcciones] = await db.query(
            'SELECT * FROM direccion WHERE users_company_id = ? AND es_principal = 1 LIMIT 1',
            [id]
        );

        const [contactos] = await db.query(
            'SELECT * FROM contacto_emergencia WHERE users_company_id = ? ORDER BY idcontacto_emergencia LIMIT 1',
            [id]
        );

        const [vacunaciones] = await db.query(
            `SELECT v.*, tv.nombre AS tipo_vacuna_nombre
             FROM vacunacion_covid v
             LEFT JOIN tipo_vacuna tv ON v.tipo_vacuna_idtipo_vacuna = tv.idtipo_vacuna
             WHERE v.users_company_id = ?`,
            [id]
        );

        const [dotaciones] = await db.query(
            'SELECT * FROM dotacion WHERE users_company_id = ? ORDER BY iddotacion DESC',
            [id]
        );

        const [recursos] = await db.query(
            `SELECT ar.*, tr.nombre AS tipo_recurso_nombre
             FROM asignacion_recurso ar
             JOIN tipo_recurso tr ON ar.tipo_recurso_idtipo_recurso = tr.idtipo_recurso
             WHERE ar.users_company_id = ? AND ar.activa = 1
             ORDER BY ar.idasignacion_recurso DESC`,
            [id]
        );

        return {
            ...empleado,
            contrato,
            salario_actual: salario,
            seguridad_social,
            cuenta_bancaria: cuentas[0] || null,
            direccion: direcciones[0] || null,
            contacto_emergencia: contactos[0] || null,
            vacunacion: vacunaciones[0] || null,
            dotaciones,
            recursos_asignados: recursos
        };
    }

    static async create(data) {
        const [existing] = await db.query(
            'SELECT id FROM users_company WHERE tipo_identificacion_idtipo_identificacion = ? AND numero_identificacion = ?',
            [data.tipo_identificacion_id, data.numero_identificacion]
        );
        if (existing.length > 0) {
            throw new Error(`Ya existe un empleado con la identificación '${data.numero_identificacion}'`);
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.query(
                `INSERT INTO users_company (
                    numero_identificacion, tipo_identificacion_idtipo_identificacion,
                    numero_identificacion_secundaria, tipo_identificacion_secundaria_id,
                    fecha_expedicion, ciudad_expedicion_id,
                    primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, nombre_propio,
                    fecha_nacimiento, ciudad_nacimiento_id, numero_hijos,
                    estado_civil_idestado_civil, grupo_sanguineo_idgrupo_sanguineo, genero_idgenero,
                    email, telefono, usuario_ssff, rut, declarante_renta, libreta_militar_numero
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                camposPersonales(data)
            );
            const ucId = result.insertId;

            const contratoId = await insertarContrato(conn, ucId, data.contrato);
            await insertarSalario(conn, contratoId, data.salario, data.contrato.fecha_ingreso);
            await guardarSeguridadSocial(conn, ucId, data.seguridad_social, data.contrato.fecha_ingreso);
            await guardarCuentaBancaria(conn, ucId, data.cuenta_bancaria);
            await guardarDireccion(conn, ucId, data.direccion);
            await guardarContactoEmergencia(conn, ucId, data.contacto_emergencia);
            await guardarVacunacion(conn, ucId, data.vacunacion);
            await guardarDotacion(conn, ucId, data.dotacion);
            await guardarRecursos(conn, ucId, data.recursos);

            await conn.commit();
            return { id: ucId, ...data };
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async update(id, data) {
        const [existing] = await db.query(
            'SELECT id FROM users_company WHERE tipo_identificacion_idtipo_identificacion = ? AND numero_identificacion = ? AND id != ?',
            [data.tipo_identificacion_id, data.numero_identificacion, id]
        );
        if (existing.length > 0) {
            throw new Error(`Ya existe otro empleado con la identificación '${data.numero_identificacion}'`);
        }

        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.query(
                `UPDATE users_company SET
                    numero_identificacion = ?, tipo_identificacion_idtipo_identificacion = ?,
                    numero_identificacion_secundaria = ?, tipo_identificacion_secundaria_id = ?,
                    fecha_expedicion = ?, ciudad_expedicion_id = ?,
                    primer_nombre = ?, segundo_nombre = ?, primer_apellido = ?, segundo_apellido = ?, nombre_propio = ?,
                    fecha_nacimiento = ?, ciudad_nacimiento_id = ?, numero_hijos = ?,
                    estado_civil_idestado_civil = ?, grupo_sanguineo_idgrupo_sanguineo = ?, genero_idgenero = ?,
                    email = ?, telefono = ?, usuario_ssff = ?, rut = ?, declarante_renta = ?, libreta_militar_numero = ?,
                    updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [...camposPersonales(data), id]
            );

            // Contrato: actualizar el vigente o crearlo si no existe
            const [contratos] = await conn.query(
                'SELECT idcontrato FROM contrato WHERE users_company_id = ? ORDER BY idcontrato DESC LIMIT 1',
                [id]
            );
            let contratoId;
            if (contratos.length > 0) {
                contratoId = contratos[0].idcontrato;
                const clienteId = await clienteDeCampania(conn, data.contrato.campania_id);
                const estadoId = val(data.contrato.estado_contrato_id) || await estadoContratoActivo(conn);
                await conn.query(
                    `UPDATE contrato SET
                        Cliente_idCliente = ?, campania_idcampania = ?,
                        area_idarea = ?, centro_costo_idcentro_costo = ?, cargo_idcargo = ?, cargo_ssff = ?,
                        tipo_contrato_idtipo_contrato = ?, modalidad_idmodalidad = ?, oleada_idoleada = ?,
                        ciudad_idciudad = ?, piso = ?, estado_contrato_idestado_contrato = ?,
                        jefe_inmediato_id = ?, jefe_area_id = ?, director_area_id = ?, analista_encargado_id = ?,
                        fecha_ingreso = ?, fecha_fin_periodo_prueba = ?, fecha_fin_contrato = ?, observaciones = ?,
                        fecha_entrega_certificacion_laboral = ?,
                        empresa_id = ?, clase_contrato_id = ?, periodo_pago_id = ?, clasificacion_dian_id = ?,
                        tipo_sena_id = ?, tipo_cotizante_id = ?, subtipo_cotizante_id = ?, aplica_dotacion = ?,
                        updated_at = CURRENT_TIMESTAMP
                     WHERE idcontrato = ?`,
                    [
                        clienteId, data.contrato.campania_id,
                        data.contrato.area_id, data.contrato.centro_costo_id, data.contrato.cargo_id, val(data.contrato.cargo_ssff),
                        data.contrato.tipo_contrato_id, data.contrato.modalidad_id, data.contrato.oleada_id,
                        data.contrato.ciudad_id, val(data.contrato.piso), estadoId,
                        val(data.contrato.jefe_inmediato_id), val(data.contrato.jefe_area_id), val(data.contrato.director_area_id), val(data.contrato.analista_encargado_id),
                        data.contrato.fecha_ingreso, val(data.contrato.fecha_fin_periodo_prueba),
                        val(data.contrato.fecha_fin_contrato), val(data.contrato.observaciones),
                        val(data.contrato.fecha_entrega_certificacion_laboral),
                        val(data.contrato.empresa_id), val(data.contrato.clase_contrato_id), val(data.contrato.periodo_pago_id), val(data.contrato.clasificacion_dian_id),
                        val(data.contrato.tipo_sena_id), val(data.contrato.tipo_cotizante_id), val(data.contrato.subtipo_cotizante_id),
                        data.contrato.aplica_dotacion === false ? 0 : 1,
                        contratoId
                    ]
                );
            } else {
                contratoId = await insertarContrato(conn, id, data.contrato);
            }

            // Salario: si cambió, cerrar la vigencia actual y abrir una nueva (historial)
            const [vigentes] = await conn.query(
                'SELECT * FROM historial_salarial WHERE contrato_idcontrato = ? AND fecha_vigencia_fin IS NULL ORDER BY idhistorial_salarial DESC LIMIT 1',
                [contratoId]
            );
            const nuevoSalario = {
                salario: Number(data.salario.salario),
                bono_no_prestacional: Number(data.salario.bono_no_prestacional ?? 0),
                bono_cafeteria: Number(data.salario.bono_cafeteria ?? 0)
            };
            if (vigentes.length === 0) {
                await insertarSalario(conn, contratoId, nuevoSalario, data.contrato.fecha_ingreso);
            } else {
                const actual = vigentes[0];
                const cambio = Number(actual.salario) !== nuevoSalario.salario
                    || Number(actual.bono_no_prestacional) !== nuevoSalario.bono_no_prestacional
                    || Number(actual.bono_cafeteria) !== nuevoSalario.bono_cafeteria;
                if (cambio) {
                    await conn.query(
                        'UPDATE historial_salarial SET fecha_vigencia_fin = CURDATE() WHERE idhistorial_salarial = ?',
                        [actual.idhistorial_salarial]
                    );
                    await insertarSalario(conn, contratoId, nuevoSalario, new Date().toISOString().substring(0, 10));
                }
            }

            await guardarSeguridadSocial(conn, id, data.seguridad_social, data.contrato.fecha_ingreso);
            await guardarCuentaBancaria(conn, id, data.cuenta_bancaria);
            await guardarDireccion(conn, id, data.direccion);
            await guardarContactoEmergencia(conn, id, data.contacto_emergencia);
            await guardarVacunacion(conn, id, data.vacunacion);
            await guardarDotacion(conn, id, data.dotacion);
            await guardarRecursos(conn, id, data.recursos);

            await conn.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async delete(id) {
        // contrato tiene FK RESTRICT hacia users_company: eliminar primero la cadena laboral
        const conn = await db.getConnection();
        try {
            await conn.beginTransaction();
            await conn.query('DELETE FROM contrato WHERE users_company_id = ?', [id]);
            const [result] = await conn.query('DELETE FROM users_company WHERE id = ?', [id]);
            await conn.commit();
            return result.affectedRows > 0;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async getCatalogos() {
        const [tiposIdentificacion] = await db.query('SELECT idtipo_identificacion AS id, nombre, codigo FROM tipo_identificacion ORDER BY nombre');
        const [estadosCiviles] = await db.query('SELECT idestado_civil AS id, nombre FROM estado_civil ORDER BY idestado_civil');
        const [gruposSanguineos] = await db.query('SELECT idgrupo_sanguineo AS id, nombre FROM grupo_sanguineo ORDER BY idgrupo_sanguineo');
        const [generos] = await db.query('SELECT idgenero AS id, nombre FROM genero ORDER BY idgenero');
        const [ciudades] = await db.query('SELECT idciudad AS id, nombre FROM ciudad ORDER BY nombre');
        const [campanias] = await db.query(`
            SELECT cam.idcampania AS id, cam.nombre, cam.Cliente_idCliente AS cliente_id, cli.nombre AS cliente_nombre
            FROM campania cam JOIN cliente cli ON cam.Cliente_idCliente = cli.idCliente
            ORDER BY cam.nombre
        `);
        const [areas] = await db.query('SELECT idarea AS id, nombre FROM area ORDER BY nombre');
        const [centrosCosto] = await db.query('SELECT idcentro_costo AS id, codigo, nombre FROM centro_costo ORDER BY codigo');
        const [cargos] = await db.query('SELECT idcargo AS id, nombre FROM cargo ORDER BY nombre');
        const [tiposContrato] = await db.query('SELECT idtipo_contrato AS id, nombre FROM tipo_contrato ORDER BY idtipo_contrato');
        const [modalidades] = await db.query('SELECT idmodalidad AS id, nombre FROM modalidad ORDER BY idmodalidad');
        const [oleadas] = await db.query('SELECT idoleada AS id, nombre, fecha_inicio FROM oleada ORDER BY fecha_inicio DESC');
        const [estadosContrato] = await db.query('SELECT idestado_contrato AS id, nombre FROM estado_contrato ORDER BY idestado_contrato');
        const [entidades] = await db.query('SELECT identidad_seguridad_social AS id, tipo, nombre FROM entidad_seguridad_social ORDER BY tipo, nombre');
        const [bancos] = await db.query('SELECT idbanco AS id, nombre FROM banco ORDER BY nombre');
        const [tiposCuenta] = await db.query('SELECT idtipo_cuenta AS id, nombre FROM tipo_cuenta ORDER BY idtipo_cuenta');
        const [tiposDireccion] = await db.query('SELECT idtipo_direccion AS id, nombre FROM tipo_direccion ORDER BY idtipo_direccion');
        const [zonasDireccion] = await db.query('SELECT idzona_direccion AS id, nombre FROM zona_direccion ORDER BY idzona_direccion');
        const [tiposVivienda] = await db.query('SELECT idtipo_vivienda AS id, nombre FROM tipo_vivienda ORDER BY nombre');
        const [parentescos] = await db.query('SELECT idparentesco AS id, nombre FROM parentesco ORDER BY idparentesco');
        const [tiposNovedad] = await db.query('SELECT idtipo_novedad AS id, categoria, nombre FROM tipo_novedad ORDER BY categoria, nombre');
        const [tiposRetiro] = await db.query('SELECT idtipo_retiro AS id, nombre, motivo_sugerido, requiere_justificacion FROM tipo_retiro ORDER BY idtipo_retiro');
        const [salariosReferencia] = await db.query('SELECT Cliente_idCliente AS cliente_id, cargo_idcargo AS cargo_id, salario FROM salario_referencia');
        const [tiposVacuna] = await db.query('SELECT idtipo_vacuna AS id, nombre FROM tipo_vacuna ORDER BY nombre');
        const [tiposRecurso] = await db.query('SELECT idtipo_recurso AS id, nombre FROM tipo_recurso ORDER BY nombre');
        const [empresas] = await db.query('SELECT idempresa AS id, nombre FROM empresa ORDER BY nombre');
        const [clasesContrato] = await db.query('SELECT idclase_contrato AS id, nombre FROM clase_contrato ORDER BY nombre');
        const [periodosPago] = await db.query('SELECT idperiodo_pago AS id, nombre FROM periodo_pago ORDER BY nombre');
        const [clasificacionesDian] = await db.query('SELECT idclasificacion_dian AS id, nombre FROM clasificacion_dian ORDER BY nombre');
        const [tiposSena] = await db.query('SELECT idtipo_sena AS id, nombre FROM tipo_sena ORDER BY nombre');
        const [tiposCotizante] = await db.query('SELECT idtipo_cotizante AS id, nombre FROM tipo_cotizante ORDER BY nombre');
        const [subtiposCotizante] = await db.query('SELECT idsubtipo_cotizante AS id, nombre FROM subtipo_cotizante ORDER BY nombre');
        const [empleados] = await db.query(`
            SELECT id, CONCAT_WS(' ', primer_nombre, segundo_nombre, primer_apellido, segundo_apellido) AS nombre_completo
            FROM users_company ORDER BY primer_apellido, primer_nombre
        `);

        // "Jefe inmediato"/"Jefe de área"/"Director de área" en AgentForm.jsx no deben ofrecer los
        // ~400 empleados como candidatos: solo quienes YA son jefe/director de alguien en un
        // contrato real (34/8/4 personas respectivamente, no 397). Se deriva de los propios datos
        // de contrato en vez de mantener un catalogo aparte.
        //
        // Cada fila trae además la campaña (y, para jefe inmediato, el cargo) del contrato real
        // que sustenta esa relación -- una misma persona puede aparecer en varias filas si es
        // jefe en más de una campaña. El frontend usa esto para filtrar los 3 selectores según
        // la Campaña/Cargo ya elegidos del empleado que se está registrando, en vez de ofrecer
        // los 34/8/4 candidatos completos sin importar a qué campaña pertenecen. Verificado contra
        // datos reales: "Jefe inmediato" varía por Campaña+Cargo (ej. T&T+Agente call center trae
        // 7 candidatos distintos, T&T+Coordinador Call trae solo 1), mientras que "Jefe de área" y
        // "Director de área" varían casi siempre solo por Campaña (1 persona cubre toda la
        // campaña sin importar el cargo del subordinado) -- por eso el cargo solo se expone para
        // jefe inmediato. Ver claude/modulo recursoshumanos.md para el detalle de la sesión.
        const empleadosPorRol = async (columna, incluirCargo) => {
            const [rows] = await db.query(`
                SELECT DISTINCT u.id, CONCAT_WS(' ', u.primer_nombre, u.segundo_nombre, u.primer_apellido, u.segundo_apellido) AS nombre_completo,
                       c.campania_idcampania AS campania_id${incluirCargo ? ', c.cargo_idcargo AS cargo_id' : ''}
                FROM contrato c JOIN users_company u ON u.id = c.${columna}
                WHERE c.${columna} IS NOT NULL
                ORDER BY nombre_completo
            `);
            return rows;
        };
        const [jefesInmediatos, jefesArea, directoresArea] = await Promise.all([
            empleadosPorRol('jefe_inmediato_id', true),
            empleadosPorRol('jefe_area_id', false),
            empleadosPorRol('director_area_id', false)
        ]);

        return {
            tipos_identificacion: tiposIdentificacion,
            estados_civiles: estadosCiviles,
            grupos_sanguineos: gruposSanguineos,
            generos,
            ciudades,
            campanias,
            areas,
            centros_costo: centrosCosto,
            cargos,
            tipos_contrato: tiposContrato,
            modalidades,
            oleadas,
            estados_contrato: estadosContrato,
            entidades_eps: entidades.filter(e => e.tipo === 'EPS'),
            entidades_arl: entidades.filter(e => e.tipo === 'ARL'),
            entidades_afp: entidades.filter(e => e.tipo === 'AFP'),
            entidades_cesantias: entidades.filter(e => e.tipo === 'CESANTIAS'),
            entidades_caja: entidades.filter(e => e.tipo === 'CAJA'),
            bancos,
            tipos_cuenta: tiposCuenta,
            tipos_direccion: tiposDireccion,
            zonas_direccion: zonasDireccion,
            tipos_vivienda: tiposVivienda,
            parentescos,
            tipos_novedad: tiposNovedad,
            tipos_retiro: tiposRetiro,
            salarios_referencia: salariosReferencia,
            tipos_vacuna: tiposVacuna,
            tipos_recurso: tiposRecurso,
            empresas,
            clases_contrato: clasesContrato,
            periodos_pago: periodosPago,
            clasificaciones_dian: clasificacionesDian,
            tipos_sena: tiposSena,
            tipos_cotizante: tiposCotizante,
            subtipos_cotizante: subtiposCotizante,
            empleados,
            jefes_inmediatos: jefesInmediatos,
            jefes_area: jefesArea,
            directores_area: directoresArea
        };
    }

    static async getGastoTotal() {
        const [rows] = await db.query(`
            SELECT
                (SELECT COUNT(*) FROM users_company) AS total_empleados,
                SUM(hs.salario)      AS gasto_mensual_total,
                SUM(hs.salario) * 12 AS gasto_anual_total,
                AVG(hs.salario)      AS salario_promedio
            FROM historial_salarial hs
            JOIN contrato c ON hs.contrato_idcontrato = c.idcontrato
            WHERE hs.fecha_vigencia_fin IS NULL
        `);
        return rows[0];
    }

    static async getActivos(ucId) {
        const [rows] = await db.query(`
            SELECT
                a.*,
                u.full_name AS created_by_name
            FROM activos a
            LEFT JOIN users u ON a.created_by_id = u.id
            WHERE a.agente_id = ?
            ORDER BY a.created_at DESC
        `, [ucId]);
        return rows;
    }

    static async assignActivo(ucId, activoId) {
        const [result] = await db.query(
            'UPDATE activos SET agente_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [ucId, activoId]
        );
        return result.affectedRows > 0;
    }

    static async unassignActivo(activoId) {
        const [result] = await db.query(
            'UPDATE activos SET agente_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [activoId]
        );
        return result.affectedRows > 0;
    }
}

module.exports = UserCompany;
