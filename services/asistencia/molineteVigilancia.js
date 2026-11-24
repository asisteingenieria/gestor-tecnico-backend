// Vigilancia del intermediario del molinete (asistencia.md §80): el intermediario pregunta
// GET /estado en cada pasada (cada pocos segundos), así que si pasan varios minutos sin esa
// llamada es que dejó de reportar (servidor del molinete apagado, tarea detenida, sin internet).
// Se registra una alerta en el log una sola vez y otra línea cuando vuelve.
//
// No alerta antes del primer contacto desde que arrancó el backend: si el intermediario todavía no
// está instalado, no hay nada que vigilar. El aviso a financiera en el portal sigue pendiente (§80).

function crearVigilancia({ alertaMin, ahora = () => Date.now(), registrar = console }) {
    let ultimoContacto = null;
    let alertado = false;

    return {
        contacto() {
            const t = ahora();
            if (alertado) {
                const min = Math.round((t - ultimoContacto) / 60000);
                registrar.log(`[molinete] El intermediario volvió a reportar después de ${min} min`);
                alertado = false;
            }
            ultimoContacto = t;
        },
        /** Se llama cada minuto. Devuelve true si acaba de alertar. */
        revisar() {
            if (ultimoContacto === null || alertado) return false;
            const min = (ahora() - ultimoContacto) / 60000;
            if (min < alertaMin) return false;
            alertado = true;
            registrar.error(`[molinete] ALERTA: el intermediario no reporta desde hace ${Math.round(min)} min (último contacto ${new Date(ultimoContacto).toISOString()})`);
            return true;
        },
        get ultimoContacto() {
            return ultimoContacto === null ? null : new Date(ultimoContacto);
        }
    };
}

module.exports = { crearVigilancia };
