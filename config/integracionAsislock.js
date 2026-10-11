// Configuración de la integración AsisLock → asistencia (asistencia.md §18).
//
// Variables de entorno (en .env, NUNCA en el repo):
//   ASISLOCK_API_KEY            clave con la que AsisLock se identifica (cabecera x-api-key)
//   ASISLOCK_API_KEY_ANTERIOR   opcional: se acepta también durante una rotación de clave
//   ASISLOCK_IPS_PERMITIDAS     opcional: IPs desde las que se aceptan avisos, separadas por
//                               coma. Vacía = cualquier IP (solo la clave protege).
//
// Sin ASISLOCK_API_KEY el endpoint responde 503: el resto del sistema arranca igual.

require('dotenv').config({ quiet: true });

const clavesAceptadas = [process.env.ASISLOCK_API_KEY, process.env.ASISLOCK_API_KEY_ANTERIOR]
    .map((c) => c?.trim())
    .filter(Boolean);

const ipsPermitidas = (process.env.ASISLOCK_IPS_PERMITIDAS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

module.exports = Object.freeze({
    clavesAceptadas,
    configurada: clavesAceptadas.length > 0,
    ipsPermitidas,
    maxRegistrosPorEnvio: 500,
    limiteCuerpo: '1mb'
});
