// Configuración de la entrada de marcaciones del molinete por intermediario (asistencia.md §80).
//
// El servidor del Gestor no alcanza la red privada de la oficina donde está el molinete (§54.1):
// un programa en el servidor del molinete (HADES) lee su Postgres local y empuja las marcaciones
// nuevas a este endpoint, igual que AsisLock empuja sus logins.
//
// Variables de entorno (en .env, NUNCA en el repo):
//   MOLINETE_API_KEY            clave con la que el intermediario se identifica (cabecera x-api-key)
//   MOLINETE_API_KEY_ANTERIOR   opcional: se acepta también durante una rotación de clave
//   MOLINETE_IPS_PERMITIDAS     opcional: IPs públicas desde las que se aceptan envíos, separadas
//                               por coma. Vacía = cualquier IP (solo la clave protege).
//
// Sin MOLINETE_API_KEY el endpoint responde 503: el resto del sistema arranca igual.

require('dotenv').config({ quiet: true });

const clavesAceptadas = [process.env.MOLINETE_API_KEY, process.env.MOLINETE_API_KEY_ANTERIOR]
    .map((c) => c?.trim())
    .filter(Boolean);

const ipsPermitidas = (process.env.MOLINETE_IPS_PERMITIDAS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

module.exports = Object.freeze({
    clavesAceptadas,
    configurada: clavesAceptadas.length > 0,
    ipsPermitidas,
    maxMarcacionesPorEnvio: 500,
    limiteCuerpo: '1mb'
});
