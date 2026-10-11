// Reglas mínimas para crear un empleado (users_company + contrato + salario).
// Compartidas por el alta manual (controllers/userCompanyController.js) y el registro de
// lotes de Hydra (services/contratacionHydra/registroService.js), para que las dos vías
// no puedan divergir. domain/contratacionHydra/secciones.js replica estos obligatorios.

const CAMPOS_CONTRATO_OBLIGATORIOS = {
    campania_id: 'campaña',
    area_id: 'área',
    centro_costo_id: 'centro de costo',
    cargo_id: 'cargo',
    tipo_contrato_id: 'tipo de contrato',
    modalidad_id: 'modalidad',
    oleada_id: 'oleada',
    ciudad_id: 'ciudad del contrato',
    fecha_ingreso: 'fecha de ingreso'
};

// Devuelve el mensaje del primer problema encontrado, o null si los datos sirven.
function validarObligatorios(data) {
    if (!data.numero_identificacion || !data.tipo_identificacion_id || !data.primer_nombre || !data.primer_apellido) {
        return 'Los campos tipo de identificación, número de identificación, primer nombre y primer apellido son obligatorios';
    }

    const faltantes = Object.entries(CAMPOS_CONTRATO_OBLIGATORIOS)
        .filter(([campo]) => !data.contrato[campo])
        .map(([, nombre]) => nombre);
    if (faltantes.length > 0) {
        return `Faltan campos obligatorios del contrato: ${faltantes.join(', ')}`;
    }

    if (!data.salario.salario || Number(data.salario.salario) <= 0) {
        return 'El salario es obligatorio y debe ser mayor a cero';
    }

    const tarifaArl = data.seguridad_social?.tarifa_arl;
    if (tarifaArl !== undefined && tarifaArl !== null && tarifaArl !== '' &&
        (isNaN(Number(tarifaArl)) || Number(tarifaArl) < 0 || Number(tarifaArl) > 100)) {
        return 'La tarifa ARL debe ser un porcentaje entre 0 y 100';
    }

    return null;
}

module.exports = { CAMPOS_CONTRATO_OBLIGATORIOS, validarObligatorios };
