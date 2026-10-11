# API de AsisLock → Gestor Técnico (módulo de asistencia)

Documento para el equipo de AsisLock. Explica cómo enviar a Gestor Técnico los registros de
`login_biometrico` para que cada login y logout alimente el tiempo laborado del empleado.

---

## 1. Qué hace la integración

Cada vez que un empleado inicia o cierra sesión en AsisLock, AsisLock envía ese registro a
Gestor. Gestor lo convierte en eventos de la jornada del empleado:

| Lo que pasa en AsisLock | Lo que registra Gestor |
|---|---|
| Primer login del día | **Entrada**: el tiempo laborado empieza a correr |
| Logout **antes** del fin de su turno (se cae el equipo, sale un momento, etc.) | **Desconexión**: el tiempo deja de correr y ese lapso **no** cuenta como laborado |
| Nuevo login después de una desconexión | **Reconexión**: el tiempo vuelve a correr |
| Logout **dentro de los 10 minutos previos** a su hora de salida, o después | **Salida**: la jornada se cierra |
| El empleado nunca volvió a loguearse después de un logout | Al cierre del día, la salida queda a la hora de ese último logout |

- La hora que vale es la que reporta AsisLock (`fecha` + `hora_login` / `hora_logout`), en **hora
  de Colombia**.
- El empleado se identifica por su **cédula** (campo `usuario`).
- Las pausas de baño y almuerzo se siguen marcando en Gestor; AsisLock no las envía.
- Si el empleado no tiene horario asignado en Gestor ese día, todo logout cuenta como
  desconexión y la jornada se cierra a la hora del último logout.

---

## 2. Conexión

| | |
|---|---|
| URL base (producción) | `http://31.97.138.23:5001/api/integraciones/asislock/v1` |
| Autenticación | Cabecera `x-api-key: <clave>` en **todas** las peticiones |
| Formato | JSON (`Content-Type: application/json`), UTF-8 |
| Tamaño máximo | 500 registros por envío y 1 MB por petición |

La clave la entrega el equipo de Gestor por un canal privado. No va en este documento.

> ⚠️ **La clave no debe ir dentro del ejecutable de AsisLock** que se instala en los equipos de
> los agentes: desde un `.exe` se puede extraer. El envío debe hacerlo un proceso que corra en un
> **servidor** (por ejemplo, junto a la base de datos `asislock`). Ver el script de ejemplo en §7.

---

## 3. Endpoints

### 3.1 `GET /salud` — probar la conexión y la clave

```bash
curl -s http://31.97.138.23:5001/api/integraciones/asislock/v1/salud -H "x-api-key: <clave>"
```

Respuesta `200`:
```json
{ "success": true, "servicio": "gestor-asistencia", "servidor_ahora": "2026-10-13T13:00:00.000Z" }
```

### 3.2 `POST /registros` — enviar logins y logouts

Cuerpo: un objeto con el arreglo `registros`. Cada elemento es una fila de `login_biometrico`
con los **mismos nombres de columna**:

```json
{
  "registros": [
    {
      "id": 15230,
      "usuario": "1023456789",
      "fecha": "2026-10-13",
      "hora_login": "07:58:12",
      "hora_logout": null,
      "estado_conexion": 1,
      "ip_local": "192.168.10.24",
      "ip_publica": "200.91.204.54",
      "aplicativo": "AsisLock",
      "conectado_biometrico": "SI"
    }
  ]
}
```

| Campo | Obligatorio | Formato | Uso en Gestor |
|---|---|---|---|
| `id` | Sí | entero > 0 (`login_biometrico.id`) | Llave para no duplicar: reenviar el mismo `id` no registra dos veces |
| `usuario` | Sí | texto o número, hasta 20 caracteres | **Cédula** del empleado. Se ignoran puntos, espacios y guiones |
| `fecha` | Sí | `YYYY-MM-DD` (recomendado). También `DD/MM/YYYY`, `YYYY/MM/DD`, `DD-MM-YYYY` | Día de la jornada (día del login) |
| `hora_login` | Al menos una de las dos | `HH:MM:SS` o `HH:MM`, hora de Colombia | Instante del login |
| `hora_logout` | | `HH:MM:SS`, `HH:MM` o `null` si sigue conectado | Instante del logout. Si es menor que `hora_login`, se toma como del día siguiente |
| `estado_conexion` | No | entero o `null` | Solo se guarda como referencia |
| `ip_local`, `ip_publica` | No | texto, hasta 50 | Se guardan como evidencia del marcaje |
| `aplicativo` | No | texto, hasta 80 | Se guarda como referencia |
| `conectado_biometrico` | No | texto, hasta 15 | Se guarda como referencia |

#### Cuándo enviar

1. **Al hacer login**: enviar la fila recién creada, con `hora_logout: null`.
2. **Al hacer logout**: enviar **la misma fila** (mismo `id`), ahora con `hora_logout`.
   El login ya registrado se reconoce como duplicado y solo se procesa el logout.
3. **Resincronización periódica** (recomendado): cada 1 a 5 minutos, reenviar las filas de hoy y de
   ayer. Es seguro: lo ya registrado vuelve como `duplicado` y no cambia nada. Así, si una
   petición falla por red, se recupera sola.

Se pueden enviar varios registros en una sola petición. Gestor los aplica en orden de hora,
sin importar el orden en que vengan en el arreglo.

---

## 4. Respuesta

Si la petición está bien formada, Gestor responde **`200`** con un resultado por registro, en el
mismo orden del envío. Cada registro trae el resultado de su login y de su logout por separado
(`null` si ese registro no traía esa hora):

```json
{
  "success": true,
  "resultados": [
    {
      "id": 15230,
      "usuario": "1023456789",
      "login":  { "resultado": "registrado", "accion": "entrada", "motivo": null },
      "logout": null
    }
  ]
}
```

| `resultado` | Significado | ¿Reenviar? |
|---|---|---|
| `registrado` | Se registró en la jornada. `accion` dice qué: `entrada`, `reconexion`, `desconexion` o `salida` | No hace falta |
| `duplicado` | Ese login/logout de ese `id` ya se había recibido antes. No se cambió nada | No hace falta |
| `ignorado` | Se recibió pero no cambia la jornada (ver `motivo`). Queda guardado | No |
| `rechazado` | No se pudo procesar (ver `motivo`). Queda guardado | Sí, si se corrige la causa: un `rechazado` **sí** se vuelve a procesar al reenviarlo |

### Motivos

| `motivo` | Resultado | Qué significa / qué hacer |
|---|---|---|
| `empleado_no_encontrado` | rechazado | La cédula no existe en Gestor. RRHH debe crear o corregir la ficha; después el reenvío funciona |
| `cedula_ambigua` | rechazado | La cédula aparece en más de una ficha. Avisar a RRHH |
| `fecha_invalida` | rechazado | `fecha` no tiene un formato reconocible |
| `hora_invalida` | rechazado | La hora no tiene formato `HH:MM[:SS]` |
| `hora_futura` | rechazado | La hora está más de 5 minutos en el futuro (reloj del equipo desfasado) |
| `demasiado_antiguo` | rechazado | El evento tiene más de 72 horas. Pedir a RRHH o al director que lo corrija en Gestor |
| `ya_conectado` | ignorado | Login con el empleado ya conectado |
| `ya_desconectado` | ignorado | Logout con el empleado ya desconectado |
| `sin_entrada` | ignorado | Logout sin un login previo ese día |
| `jornada_finalizada` | ignorado | La jornada de ese día ya tiene salida |
| `fuera_de_orden` | ignorado | El evento es anterior a otro ya registrado ese día y no se puede intercalar |

### Errores de la petición completa

Siempre con la forma `{ "success": false, "codigo": "...", "message": "...", "detalles": [ ... ] }`.

| HTTP | `codigo` | Causa | Qué hacer |
|---|---|---|---|
| 400 | `VALIDACION` | Cuerpo mal formado (falta `id`, `usuario`, `fecha` o ambas horas; `id` repetido en el mismo envío; JSON inválido). `detalles` dice qué campo | Corregir y reenviar. No se procesó nada |
| 401 | `NO_AUTORIZADO` | Clave ausente o incorrecta, o IP no permitida | Revisar la clave. No reintentar en bucle |
| 413 | `ENVIO_DEMASIADO_GRANDE` | Más de 1 MB | Partir el envío |
| 503 | `INTEGRACION_NO_CONFIGURADA` | Gestor aún no tiene la integración activa | Reintentar más tarde |
| 500 / sin respuesta | — | Error del servidor o de red | Reintentar más tarde. Es seguro reenviar lo mismo |

---

## 5. Ejemplo completo de un día

Turno en Gestor de 08:00 a 17:00. El agente:

| AsisLock envía | Resultado en Gestor |
|---|---|
| `id 501`, login 07:58, logout `null` | `entrada` → empieza a contar desde 07:58 |
| `id 501`, login 07:58, logout 10:15 | login `duplicado`, logout `desconexion` → deja de contar |
| `id 502`, login 10:25, logout `null` | `reconexion` → vuelve a contar (10 min no laborados) |
| `id 502`, login 10:25, logout 16:55 | login `duplicado`, logout `salida` (16:55 está dentro de los 10 min previos a las 17:00) |

---

## 6. Prueba rápida con curl

```bash
curl -s -X POST http://31.97.138.23:5001/api/integraciones/asislock/v1/registros \
  -H "x-api-key: <clave>" -H "Content-Type: application/json" \
  -d '{"registros":[{"id":1,"usuario":"<cédula de prueba>","fecha":"2026-10-13","hora_login":"08:00:00","hora_logout":null}]}'
```

Coordinar antes con el equipo de Gestor la cédula de prueba: el envío crea eventos reales en la
jornada de ese empleado.

---

## 7. Script de envío de ejemplo (Python, para correr en un servidor)

Lee de la base `asislock` las filas de hoy y de ayer y las envía en bloques de 500. Pensado para
programarse cada 1 a 5 minutos (cron o Programador de tareas). Usa solo la librería estándar y
`mysql-connector`, que AsisLock ya usa. La clave y los datos de la base salen de variables de
entorno, nunca del código.

```python
"""enviar_asislock_a_gestor.py — reenvía login_biometrico de hoy y ayer a Gestor Técnico."""
import json
import os
import urllib.error
import urllib.request

import mysql.connector

GESTOR_URL = os.environ.get("GESTOR_URL", "http://31.97.138.23:5001/api/integraciones/asislock/v1")
GESTOR_API_KEY = os.environ["GESTOR_ASISLOCK_API_KEY"]
BLOQUE = 500


def leer_registros():
    conexion = mysql.connector.connect(
        host=os.environ["ASISLOCK_DB_HOST"],
        user=os.environ["ASISLOCK_DB_USER"],
        password=os.environ["ASISLOCK_DB_PASSWORD"],
        database=os.environ.get("ASISLOCK_DB_NAME", "asislock"),
    )
    try:
        cursor = conexion.cursor(dictionary=True)
        # Ajustar el filtro si `fecha` no se guarda como 'YYYY-MM-DD'.
        cursor.execute(
            """SELECT id, usuario, fecha, hora_login, hora_logout, estado_conexion,
                      ip_local, ip_publica, aplicativo, conectado_biometrico
                 FROM login_biometrico
                WHERE fecha >= DATE_FORMAT(CURDATE() - INTERVAL 1 DAY, '%Y-%m-%d')
                ORDER BY id"""
        )
        filas = cursor.fetchall()
    finally:
        conexion.close()

    for fila in filas:
        # Los TIME de MySQL llegan como timedelta: se pasan a 'HH:MM:SS'.
        for campo in ("hora_login", "hora_logout"):
            valor = fila[campo]
            if valor is not None and not isinstance(valor, str):
                total = int(valor.total_seconds())
                fila[campo] = f"{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"
        fila["usuario"] = str(fila["usuario"]).strip()
        fila["fecha"] = str(fila["fecha"])
    return filas


def enviar(registros):
    peticion = urllib.request.Request(
        f"{GESTOR_URL}/registros",
        data=json.dumps({"registros": registros}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": GESTOR_API_KEY},
        method="POST",
    )
    with urllib.request.urlopen(peticion, timeout=30) as respuesta:
        return json.loads(respuesta.read().decode("utf-8"))


def main():
    registros = leer_registros()
    for i in range(0, len(registros), BLOQUE):
        try:
            respuesta = enviar(registros[i:i + BLOQUE])
        except urllib.error.HTTPError as error:
            print(f"Gestor respondió {error.code}: {error.read().decode('utf-8', 'replace')}")
            return
        except urllib.error.URLError as error:
            print(f"Sin conexión con Gestor ({error.reason}); se reintentará en la próxima corrida")
            return
        for r in respuesta["resultados"]:
            for evento in ("login", "logout"):
                res = r.get(evento)
                if res and res["resultado"] == "rechazado":
                    print(f"Registro {r['id']} ({r['usuario']}) {evento}: rechazado por {res['motivo']}")


if __name__ == "__main__":
    main()
```

---

## 8. Soporte

Si un registro queda `rechazado` o la integración responde `401`/`503`, contactar al equipo de
Gestor Técnico con el `id` del registro y la hora del envío. Gestor guarda cada aviso recibido
(tabla `asislock_registro`), así que se puede rastrear qué llegó y qué se hizo con él.
