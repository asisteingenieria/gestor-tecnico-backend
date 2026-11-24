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
//   MOLINETE_SOLO_HTTPS         opcional: 1 = rechaza lo que no llegue por HTTPS a través de nginx
//                               (X-Forwarded-Proto, ver `trust proxy` en index.js). Se activa cuando
//                               el intermediario ya use la URL https (§80.1).
//   MOLINETE_ALERTA_MIN         opcional: minutos sin contacto del intermediario antes de registrar
//                               una alerta en el log (por defecto 10).
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

const alertaMin = Number(process.env.MOLINETE_ALERTA_MIN);

module.exports = Object.freeze({
    clavesAceptadas,
    configurada: clavesAceptadas.length > 0,
    ipsPermitidas,
    soloHttps: process.env.MOLINETE_SOLO_HTTPS === '1',
    alertaSinContactoMin: Number.isFinite(alertaMin) && alertaMin > 0 ? alertaMin : 10,
    maxMarcacionesPorEnvio: 500,
    // Lo que se le pide al intermediario por envío (GET /estado). Menos que el máximo aceptado para
    // que cada envío se procese en pocos segundos, lejos del tiempo de espera del cliente.
    lotePorEnvio: 200,
    limiteCuerpo: '1mb'
});
