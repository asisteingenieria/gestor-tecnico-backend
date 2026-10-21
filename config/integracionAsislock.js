// Configuración de la integración AsisLock → asistencia (asistencia.md §18).
//
// Variables de entorno (en .env, NUNCA en el repo):
//   ASISLOCK_API_KEY            clave con la que AsisLock se identifica (cabecera x-api-key)
//   ASISLOCK_API_KEY_ANTERIOR   opcional: se acepta también durante una rotación de clave
//   ASISLOCK_IPS_PERMITIDAS     opcional: IPs desde las que se aceptan avisos, separadas por
//                               coma. Vacía = cualquier IP (solo la clave protege).
//
// Sin ASISLOCK_API_KEY el endpoint responde 503: el resto del sistema arranca igual.
//
// Sentido Gestor → AsisLock (avisos de usuarios de la pantalla gris, asistencia.md §31):
//   ASISLOCK_CALLBACK_URL       base de la API de AsisLock que recibe los avisos; Gestor hace
//                               POST <url>/usuarios
//   ASISLOCK_CALLBACK_API_KEY   clave con la que Gestor se identifica ante AsisLock (x-api-key)
// Sin ellas, los avisos se acumulan en asislock_envio_saliente y salen cuando se configuren.

require('dotenv').config({ quiet: true });

const clavesAceptadas = [process.env.ASISLOCK_API_KEY, process.env.ASISLOCK_API_KEY_ANTERIOR]
    .map((c) => c?.trim())
    .filter(Boolean);

const ipsPermitidas = (process.env.ASISLOCK_IPS_PERMITIDAS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

const salida = Object.freeze({
    url: process.env.ASISLOCK_CALLBACK_URL?.trim().replace(/\/+$/, '') || null,
    apiKey: process.env.ASISLOCK_CALLBACK_API_KEY?.trim() || null
});

module.exports = Object.freeze({
    clavesAceptadas,
    configurada: clavesAceptadas.length > 0,
    ipsPermitidas,
    maxRegistrosPorEnvio: 500,
    limiteCuerpo: '1mb',

    pantallaGris: Object.freeze({
        maxIntentosFallidos: 5, // seguidos; después el usuario queda bloqueado
        minutosBloqueo: 15,
        largoMinimoClave: 6     // igual que la cuenta del portal (authController)
    }),

    salida,
    salidaConfigurada: Boolean(salida.url && salida.apiKey),
    outbox: Object.freeze({
        maxIntentos: 10,          // después, el aviso queda 'fallido'
        backoffMaximoMinutos: 60, // 1, 2, 4, 8… minutos, con tope de una hora
        enviosPorCorrida: 50,
        timeoutMs: 10000
    })
});
