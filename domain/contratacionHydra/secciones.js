// Secciones del checklist de contratación (conexionhydra.md §6.2).
//
// Cada campo es una ruta dentro de `datos_empleado`. Los obligatorios replican EXACTAMENTE
// lo que hoy exige `validarObligatorios` en controllers/userCompanyController.js, para que
// un lote verificado nunca falle al registrarse. Obligatorios de negocio adicionales se
// agregan aquí solo después de confirmarlos contra las dos hojas fuente de RRHH ("Nuevo
// Epleado" y "EJEMPLO" — ver claude/modulo recursoshumanos.md).
//
// `grupos`: conjuntos de campos que van todos o ninguno. UserCompany descarta EN SILENCIO
// una cuenta bancaria, dirección o contacto de emergencia incompletos
// (guardarCuentaBancaria/guardarDireccion/guardarContactoEmergencia); aquí se bloquea la
// verificación para que ese dato no se pierda sin que RRHH lo note.
//
// El orden de `campos` define el hash de la sección: agregar un campo invalida las
// verificaciones existentes de esa sección (comportamiento deseado).

const enRango = (min, max, mensaje) => (valor) => {
    const n = Number(valor);
    return Number.isNaN(n) || n < min || n > max ? mensaje : null;
};

const mayorACero = (mensaje) => (valor) => {
    const n = Number(valor);
    return Number.isNaN(n) || n <= 0 ? mensaje : null;
};

const SECCIONES = [
    {
        clave: 'personal',
        nombre: 'Datos personales',
        campos: [
            { ruta: 'tipo_identificacion_id', etiqueta: 'Tipo de identificación', requerido: true },
            { ruta: 'numero_identificacion', etiqueta: 'Número de identificación', requerido: true },
            { ruta: 'tipo_identificacion_secundaria_id', etiqueta: 'Tipo de identificación secundaria' },
            { ruta: 'numero_identificacion_secundaria', etiqueta: 'Número de identificación secundaria' },
            { ruta: 'fecha_expedicion', etiqueta: 'Fecha de expedición' },
            { ruta: 'ciudad_expedicion_id', etiqueta: 'Ciudad de expedición' },
            { ruta: 'primer_nombre', etiqueta: 'Primer nombre', requerido: true },
            { ruta: 'segundo_nombre', etiqueta: 'Segundo nombre' },
            { ruta: 'primer_apellido', etiqueta: 'Primer apellido', requerido: true },
            { ruta: 'segundo_apellido', etiqueta: 'Segundo apellido' },
            { ruta: 'fecha_nacimiento', etiqueta: 'Fecha de nacimiento' },
            { ruta: 'ciudad_nacimiento_id', etiqueta: 'Ciudad de nacimiento' },
            { ruta: 'numero_hijos', etiqueta: 'Número de hijos' },
            { ruta: 'estado_civil_id', etiqueta: 'Estado civil' },
            { ruta: 'grupo_sanguineo_id', etiqueta: 'Grupo sanguíneo' },
            { ruta: 'genero_id', etiqueta: 'Género' },
            { ruta: 'email', etiqueta: 'Email' },
            { ruta: 'telefono', etiqueta: 'Teléfono' },
            { ruta: 'usuario_ssff', etiqueta: 'Usuario SSFF' },
            { ruta: 'rut', etiqueta: 'RUT' },
            { ruta: 'declarante_renta', etiqueta: 'Declarante de renta' },
            { ruta: 'libreta_militar_numero', etiqueta: 'Libreta militar' }
        ],
        grupos: []
    },
    {
        clave: 'contrato',
        nombre: 'Contrato',
        campos: [
            { ruta: 'contrato.campania_id', etiqueta: 'Campaña', requerido: true },
            { ruta: 'contrato.area_id', etiqueta: 'Área', requerido: true },
            { ruta: 'contrato.centro_costo_id', etiqueta: 'Centro de costo', requerido: true },
            { ruta: 'contrato.cargo_id', etiqueta: 'Cargo', requerido: true },
            { ruta: 'contrato.cargo_ssff', etiqueta: 'Cargo SSFF' },
            { ruta: 'contrato.tipo_contrato_id', etiqueta: 'Tipo de contrato', requerido: true },
            { ruta: 'contrato.modalidad_id', etiqueta: 'Modalidad', requerido: true },
            { ruta: 'contrato.oleada_id', etiqueta: 'Oleada', requerido: true },
            { ruta: 'contrato.ciudad_id', etiqueta: 'Ciudad del contrato', requerido: true },
            { ruta: 'contrato.piso', etiqueta: 'Piso' },
            { ruta: 'contrato.estado_contrato_id', etiqueta: 'Estado del contrato' },
            { ruta: 'contrato.jefe_inmediato_id', etiqueta: 'Jefe inmediato' },
            { ruta: 'contrato.jefe_area_id', etiqueta: 'Jefe de área' },
            { ruta: 'contrato.director_area_id', etiqueta: 'Director de área' },
            { ruta: 'contrato.analista_encargado_id', etiqueta: 'Analista encargado' },
            { ruta: 'contrato.fecha_ingreso', etiqueta: 'Fecha de ingreso', requerido: true },
            { ruta: 'contrato.fecha_fin_periodo_prueba', etiqueta: 'Fin de periodo de prueba' },
            { ruta: 'contrato.fecha_fin_contrato', etiqueta: 'Fin de contrato' },
            { ruta: 'contrato.observaciones', etiqueta: 'Observaciones' },
            { ruta: 'contrato.fecha_entrega_certificacion_laboral', etiqueta: 'Entrega de certificación laboral' },
            { ruta: 'contrato.empresa_id', etiqueta: 'Empresa' },
            { ruta: 'contrato.clase_contrato_id', etiqueta: 'Clase de contrato' },
            { ruta: 'contrato.periodo_pago_id', etiqueta: 'Periodo de pago' },
            { ruta: 'contrato.clasificacion_dian_id', etiqueta: 'Clasificación DIAN' },
            { ruta: 'contrato.tipo_sena_id', etiqueta: 'Tipo SENA' },
            { ruta: 'contrato.tipo_cotizante_id', etiqueta: 'Tipo de cotizante' },
            { ruta: 'contrato.subtipo_cotizante_id', etiqueta: 'Subtipo de cotizante' }
        ],
        grupos: []
    },
    {
        clave: 'salario',
        nombre: 'Salario',
        campos: [
            {
                ruta: 'salario.salario', etiqueta: 'Salario', requerido: true,
                validar: mayorACero('El salario debe ser mayor a cero')
            },
            { ruta: 'salario.bono_no_prestacional', etiqueta: 'Bono no prestacional' },
            { ruta: 'salario.bono_cafeteria', etiqueta: 'Bono de cafetería' }
        ],
        grupos: []
    },
    {
        clave: 'seguridad_social',
        nombre: 'Seguridad social',
        campos: [
            { ruta: 'seguridad_social.eps_id', etiqueta: 'EPS' },
            { ruta: 'seguridad_social.eps_fecha_afiliacion', etiqueta: 'Fecha de afiliación EPS' },
            { ruta: 'seguridad_social.afp_id', etiqueta: 'AFP' },
            { ruta: 'seguridad_social.afp_fecha_afiliacion', etiqueta: 'Fecha de afiliación AFP' },
            { ruta: 'seguridad_social.arl_id', etiqueta: 'ARL' },
            { ruta: 'seguridad_social.arl_fecha_afiliacion', etiqueta: 'Fecha de afiliación ARL' },
            {
                ruta: 'seguridad_social.tarifa_arl', etiqueta: 'Tarifa ARL (%)',
                validar: enRango(0, 100, 'La tarifa ARL debe ser un porcentaje entre 0 y 100')
            },
            { ruta: 'seguridad_social.cesantias_id', etiqueta: 'Cesantías' },
            { ruta: 'seguridad_social.cesantias_fecha_afiliacion', etiqueta: 'Fecha de afiliación cesantías' },
            { ruta: 'seguridad_social.caja_id', etiqueta: 'Caja de compensación' },
            { ruta: 'seguridad_social.caja_fecha_afiliacion', etiqueta: 'Fecha de afiliación caja' }
        ],
        grupos: []
    },
    {
        clave: 'cuenta_bancaria',
        nombre: 'Cuenta bancaria',
        campos: [
            { ruta: 'cuenta_bancaria.banco_id', etiqueta: 'Banco' },
            { ruta: 'cuenta_bancaria.tipo_cuenta_id', etiqueta: 'Tipo de cuenta' },
            { ruta: 'cuenta_bancaria.numero_cuenta', etiqueta: 'Número de cuenta' }
        ],
        grupos: [
            {
                etiqueta: 'Cuenta bancaria',
                rutas: ['cuenta_bancaria.banco_id', 'cuenta_bancaria.tipo_cuenta_id', 'cuenta_bancaria.numero_cuenta']
            }
        ]
    },
    {
        clave: 'direccion_contacto',
        nombre: 'Dirección y contacto de emergencia',
        campos: [
            { ruta: 'direccion.tipo_direccion_id', etiqueta: 'Tipo de dirección' },
            { ruta: 'direccion.direccion', etiqueta: 'Dirección' },
            { ruta: 'direccion.barrio', etiqueta: 'Barrio' },
            { ruta: 'direccion.ciudad_id', etiqueta: 'Ciudad de residencia' },
            { ruta: 'direccion.zona_direccion_id', etiqueta: 'Zona' },
            { ruta: 'direccion.tipo_vivienda_id', etiqueta: 'Tipo de vivienda' },
            { ruta: 'contacto_emergencia.nombre', etiqueta: 'Nombre del contacto de emergencia' },
            { ruta: 'contacto_emergencia.telefono', etiqueta: 'Teléfono del contacto de emergencia' },
            { ruta: 'contacto_emergencia.parentesco_id', etiqueta: 'Parentesco del contacto de emergencia' }
        ],
        grupos: [
            {
                etiqueta: 'Dirección',
                rutas: ['direccion.tipo_direccion_id', 'direccion.direccion']
            },
            {
                etiqueta: 'Contacto de emergencia',
                rutas: ['contacto_emergencia.nombre', 'contacto_emergencia.telefono', 'contacto_emergencia.parentesco_id']
            }
        ]
    },
    {
        clave: 'dotacion',
        nombre: 'Dotación',
        campos: [
            { ruta: 'contrato.aplica_dotacion', etiqueta: 'Aplica dotación' },
            { ruta: 'dotacion.talla_camisa', etiqueta: 'Talla de camisa' },
            { ruta: 'dotacion.talla_pantalon', etiqueta: 'Talla de pantalón' },
            { ruta: 'dotacion.talla_calzado', etiqueta: 'Talla de calzado' }
        ],
        grupos: []
    }
];

const CLAVES_SECCION = SECCIONES.map((s) => s.clave);

const seccionesPorClave = new Map(SECCIONES.map((s) => [s.clave, s]));

function obtenerSeccion(clave) {
    return seccionesPorClave.get(clave) ?? null;
}

// Sección a la que pertenece una ruta de `datos_empleado` (para ubicar los valores de
// Hydra sin mapear en la sección correcta del checklist).
function seccionDeRuta(ruta) {
    const seccion = SECCIONES.find((s) => s.campos.some((c) => c.ruta === ruta));
    return seccion ? seccion.clave : null;
}

module.exports = { SECCIONES, CLAVES_SECCION, obtenerSeccion, seccionDeRuta };
