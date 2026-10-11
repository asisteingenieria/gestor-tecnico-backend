// Simula a Hydra llamando a la API de integración de Gestor, con firma HMAC real.
// Solo para desarrollo/pruebas: usa cédulas ficticias 9100000001..., nunca datos reales.
//
// Requiere en el entorno las mismas credenciales que el servidor (HYDRA_API_KEY y
// HYDRA_HMAC_SECRET, leídas del .env) y opcionalmente GESTOR_URL (default localhost:5001).
//
//   node scripts/simularEnvioHydra.js lote [loteExternoId] [cantidad]
//   node scripts/simularEnvioHydra.js reenviar <hydraCandidatoId> [version]
//   node scripts/simularEnvioHydra.js cancelar <hydraCandidatoId> [motivo]
//   node scripts/simularEnvioHydra.js consultar <hydraCandidatoId>

require('dotenv').config({ quiet: true });
const { randomUUID } = require('node:crypto');
const { firmar } = require('../utils/firmaHydra');

const BASE = `${process.env.GESTOR_URL || 'http://localhost:5001'}/api/integraciones/hydra/v1`;
const API_KEY = process.env.HYDRA_API_KEY;
const SECRETO = process.env.HYDRA_HMAC_SECRET;

const NOMBRES = [
    ['Laura', 'Gómez', 'Ruiz', 'femenino'], ['Carlos', 'Pérez', 'Díaz', 'masculino'],
    ['Andrea', 'Martínez', 'López', 'femenino'], ['Jorge', 'Rodríguez', 'Castro', 'masculino'],
    ['Paola', 'Hernández', 'Vargas', 'femenino']
];

function candidatoFicticio(indice, version = 1) {
    const [nombre, apellido1, apellido2, genero] = NOMBRES[indice % NOMBRES.length];
    const n = 900 + indice + 1;
    return {
        hydra_candidato_id: n,
        version,
        identificacion: { tipo: 'CC', numero: `91000000${String(indice + 1).padStart(2, '0')}` },
        nombres: { primer_nombre: nombre, segundo_nombre: null, primer_apellido: apellido1, segundo_apellido: apellido2 },
        contacto: { email: `prueba${n}@example.com`, celular: `300000${String(n).padStart(4, '0')}` },
        personal: { fecha_nacimiento: '2000-01-15', genero, estado_civil: 'soltero', grupo_sanguineo: 'O+' },
        seguridad_social: { eps: 'Sanitas EPS', afp: 'Porvenir' },
        direccion: { direccion: `Calle ${10 + indice} # 20-30`, barrio: 'Chapinero' },
        contacto_emergencia: { nombre: 'Contacto Prueba', telefono: '3100000000', parentesco: 'madre' },
        dotacion: { talla_camisa: 'M' },
        proceso: { cliente: 'Hogar', cargo: 'Agente Call Center', aprobado_final_en: new Date().toISOString() },
        consentimiento: { fecha: '2026-09-20', ciudad: 'Bogotá' }
    };
}

async function llamar(metodo, ruta, cuerpo) {
    const texto = cuerpo === undefined ? '' : JSON.stringify(cuerpo);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = {
        'X-Api-Key': API_KEY,
        'X-Timestamp': timestamp,
        'X-Signature': firmar(SECRETO, timestamp, texto)
    };
    if (texto) headers['Content-Type'] = 'application/json';
    if (metodo !== 'GET') headers['Idempotency-Key'] = randomUUID();

    const respuesta = await fetch(`${BASE}${ruta}`, { method: metodo, headers, body: texto || undefined });
    const cuerpoRespuesta = await respuesta.text();
    console.log(`${metodo} ${ruta} → ${respuesta.status}`);
    try {
        console.log(JSON.stringify(JSON.parse(cuerpoRespuesta), null, 2));
    } catch {
        console.log(cuerpoRespuesta);
    }
}

async function main() {
    if (!API_KEY || !SECRETO) {
        console.error('Faltan HYDRA_API_KEY y HYDRA_HMAC_SECRET en el entorno.');
        process.exit(1);
    }
    const [accion, arg1, arg2] = process.argv.slice(2);

    switch (accion) {
        case 'lote': {
            const cantidad = Number(arg2 || 3);
            await llamar('POST', '/lotes', {
                lote_externo_id: arg1 || `SIM-${Date.now()}`,
                nombre: 'Lote simulado de prueba',
                fecha_ingreso_sugerida: '2026-10-06',
                candidatos: Array.from({ length: cantidad }, (_, i) => candidatoFicticio(i))
            });
            break;
        }
        case 'reenviar': {
            const indice = Number(arg1) - 901;
            const candidato = candidatoFicticio(indice, Number(arg2 || 2));
            candidato.contacto.email = `reenvio${Date.now()}@example.com`;
            await llamar('PUT', `/candidatos/${arg1}`, candidato);
            break;
        }
        case 'cancelar':
            await llamar('POST', `/candidatos/${arg1}/cancelar`, { motivo: arg2 || 'Desistió del proceso' });
            break;
        case 'consultar':
            await llamar('GET', `/candidatos/${arg1}`);
            break;
        default:
            console.log('Uso: node scripts/simularEnvioHydra.js lote|reenviar|cancelar|consultar ...');
            process.exit(1);
    }
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
