// Cliente de VoxPro para los usuarios activos de Aware. El Gestor no alcanza la red privada de Aware
// (10.255.255.x); VoxPro sí, por el túnel SSH de Kraken, y expone la lista en
// GET /api/gestor/aware-agentes con un token de servicio (repo voxpro-backend,
// src/routes/gestorAware.routes.js). VoxPro guarda la lista 10 minutos en caché.
//
// .env del Gestor:
//   VOXPRO_API_URL=http://200.91.204.51/api
//   VOXPRO_GESTOR_TOKEN=<el mismo valor que GESTOR_AWARE_TOKEN en el .env de VoxPro>

// Consultar los 8 servidores Aware por el túnel tarda; VoxPro corta cada servidor a los 60 s.
const TIMEOUT_MS = 90 * 1000;

class VoxproNoConfiguradoError extends Error {}

function configurado() {
    return Boolean(process.env.VOXPRO_API_URL && process.env.VOXPRO_GESTOR_TOKEN);
}

async function obtenerAgentesActivos({ refrescar = false } = {}) {
    if (!configurado()) {
        throw new VoxproNoConfiguradoError('Falta VOXPRO_API_URL o VOXPRO_GESTOR_TOKEN en el .env del backend');
    }
    const base = process.env.VOXPRO_API_URL.replace(/\/+$/, '');
    const url = `${base}/gestor/aware-agentes${refrescar ? '?refrescar=1' : ''}`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.VOXPRO_GESTOR_TOKEN}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(`VoxPro respondió ${res.status} al pedir los usuarios de Aware`);
    }
    const datos = await res.json();
    if (!Array.isArray(datos?.agentes) || !Array.isArray(datos?.fuentes)) {
        throw new Error('VoxPro devolvió una respuesta sin la lista de agentes');
    }
    return datos;
}

module.exports = { obtenerAgentesActivos, configurado, VoxproNoConfiguradoError };
