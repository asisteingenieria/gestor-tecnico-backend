// Configuración de la conexión Hydra ⇄ Gestor (conexionhydra.md §5).
//
// Variables de entorno (en .env, NUNCA en el repo):
//   HYDRA_API_KEY            clave con la que Hydra se identifica ante Gestor
//   HYDRA_HMAC_SECRET        secreto con el que Hydra firma lo que envía a Gestor
//   HYDRA_API_KEY_ANTERIOR   } opcionales: se aceptan también durante una rotación,
//   HYDRA_HMAC_SECRET_ANTERIOR }  hasta que Hydra termine de cambiar a las nuevas
//
// Si falta la credencial principal, los endpoints de integración responden 503 en vez
// de quedar abiertos: el resto del sistema arranca igual.
//
// Sentido Gestor → Hydra (avisos del outbox, conexionhydra.md §5.2). Credenciales DISTINTAS
// a las de entrada:
//   HYDRA_CALLBACK_URL          base de la API de Hydra, p. ej.
//                               http://<host-hydra>:3000/api/integraciones/gestor/v1
//   HYDRA_CALLBACK_API_KEY      clave con la que Gestor se identifica ante Hydra
//   HYDRA_CALLBACK_HMAC_SECRET  secreto con el que Gestor firma lo que envía a Hydra
// Sin ellas, los avisos se acumulan en hydra_envio_saliente y salen cuando se configuren.

require('dotenv').config({ quiet: true });

function credencial(apiKey, secreto) {
    return apiKey && secreto ? { apiKey, secreto } : null;
}

const credencialesEntrantes = [
    credencial(process.env.HYDRA_API_KEY, process.env.HYDRA_HMAC_SECRET),
    credencial(process.env.HYDRA_API_KEY_ANTERIOR, process.env.HYDRA_HMAC_SECRET_ANTERIOR)
].filter(Boolean);

const salida = Object.freeze({
    url: process.env.HYDRA_CALLBACK_URL?.replace(/\/+$/, '') ?? null,
    apiKey: process.env.HYDRA_CALLBACK_API_KEY ?? null,
    secreto: process.env.HYDRA_CALLBACK_HMAC_SECRET ?? null
});

module.exports = Object.freeze({
    credencialesEntrantes,
    configurada: credencialesEntrantes.length > 0,
    // Ventana anti-replay: una firma con más de 5 minutos de diferencia se rechaza.
    toleranciaTimestampSegundos: 300,
    maxCandidatosPorLote: 200,
    limiteCuerpo: '1mb',
    // Un documento (migración 087) viaja en base64: 10 MB de archivo son ~13,4 MB de JSON.
    limiteCuerpoDocumento: '15mb',

    salida,
    salidaConfigurada: Boolean(salida.url && salida.apiKey && salida.secreto),
    outbox: Object.freeze({
        maxIntentos: 10,          // después, el envío queda 'fallido' y espera "Reintentar"
        backoffMaximoMinutos: 60, // 1, 2, 4, 8… minutos, con tope de una hora
        enviosPorCorrida: 20,
        timeoutMs: 10000
    })
});
