const config = require('../../config/integracionHydra');
const { firmar } = require('../../utils/firmaHydra');

// Cliente HTTP Gestor → Hydra. Firma cada petición con el mismo esquema que Gestor exige
// a Hydra (conexionhydra.md §5.3), con las credenciales de salida. Nunca lanza por una
// respuesta HTTP: devuelve { status, codigo, error } para que el despachador decida.

async function enviar(ruta, payload, idempotencyKey) {
    const cuerpo = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
        const respuesta = await fetch(`${config.salida.url}${ruta}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': config.salida.apiKey,
                'X-Timestamp': timestamp,
                'X-Signature': firmar(config.salida.secreto, timestamp, cuerpo),
                'Idempotency-Key': idempotencyKey
            },
            body: cuerpo,
            signal: AbortSignal.timeout(config.outbox.timeoutMs)
        });

        let codigo = null;
        let mensaje = null;
        try {
            const json = await respuesta.json();
            codigo = json?.codigo ?? json?.error?.codigo ?? null;
            mensaje = json?.message ?? json?.error?.mensaje ?? null;
        } catch {
            // Cuerpo vacío o no JSON: basta con el status.
        }
        return {
            status: respuesta.status,
            codigo,
            error: respuesta.ok ? null : `HTTP ${respuesta.status}${codigo ? ` ${codigo}` : ''}${mensaje ? `: ${mensaje}` : ''}`
        };
    } catch (error) {
        // Red caída, DNS, conexión rechazada o timeout.
        return { status: null, codigo: null, error: `Sin respuesta de Hydra: ${error.cause?.code ?? error.name}` };
    }
}

module.exports = { enviar };
