# API entre AsisLock y Gestor Técnico (módulo de asistencia)

Documento para el equipo de AsisLock. Cubre las dos partes de la integración:

- **§1-§7**: cómo enviar a Gestor Técnico los registros de `login_biometrico` para que cada login
  y logout alimente el tiempo laborado del empleado. Ya funciona en producción.
- **§8 (nuevo, 2026-10-21)**: los usuarios de la **pantalla gris**. Gestor los crea al contratar,
  se los avisa a AsisLock y valida cada inicio de sesión. **Requiere desarrollo del lado de
  AsisLock**: ver la lista de tareas en §8.1.

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
- Los usuarios con los que el empleado entra a la pantalla gris los crea y los valida Gestor (§8).
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
| `id` | No (recomendado) | entero > 0 (id de la fila en AsisLock) o `null` | Llave para no duplicar: reenviar el mismo `id` no registra dos veces. Sin `id`, ver §3.3 |
| `usuario` | Sí | texto o número, hasta 20 caracteres | **Cédula** del empleado. Se ignoran puntos, espacios y guiones |
| `fecha` | Sí | `YYYY-MM-DD` (recomendado). También `DD/MM/YYYY`, `YYYY/MM/DD`, `DD-MM-YYYY` | Día de la jornada (día del login) |
| `hora_login` | Al menos una de las dos | `HH:MM:SS` o `HH:MM`, hora de Colombia | Instante del login |
| `hora_logout` | | `HH:MM:SS`, `HH:MM` o `null` si sigue conectado | Instante del logout. Si es menor que `hora_login`, se toma como del día siguiente |
| `estado_conexion` | No | texto (hasta 20), número o `null` | Solo se guarda como referencia |
| `ip_local`, `ip_publica` | No | texto, hasta 50 | Se guardan como evidencia del marcaje |
| `aplicativo` | No | texto, hasta 80 | Se guarda como referencia |
| `conectado_biometrico` | No | texto, hasta 15 | En el login: `Presencial` (puso la huella en el biométrico y cruzó el molinete) o `Teletrabajo` (solo se logueó en AsisLock). En el logout AsisLock manda `close`; Gestor lo guarda en el registro del evento pero conserva en la sesión el valor del login |

#### Cuándo enviar

1. **Al hacer login**: enviar la fila recién creada, con `hora_logout: null`.
2. **Al hacer logout**: enviar **la misma fila** (mismo `id`), ahora con `hora_logout`.
   El login ya registrado se reconoce como duplicado y solo se procesa el logout.
3. **Resincronización periódica** (recomendado): cada 1 a 5 minutos, reenviar las filas de hoy y de
   ayer. Es seguro: lo ya registrado vuelve como `duplicado` y no cambia nada. Así, si una
   petición falla por red, se recupera sola.

### 3.3 Envíos sin `id`

Un sistema que no tiene el `id` de la fila puede omitirlo (o mandarlo `null`). Entonces Gestor
identifica cada evento por **cédula + fecha + hora**:

- Un login se reconoce por `usuario` + `fecha` + `hora_login`. Reenviarlo igual vuelve como `duplicado`.
- El logout puede ir en la misma fila (con `hora_login` y `hora_logout`) o **solo** (con
  `hora_login: null` y `hora_logout`). Un logout solo cierra la sesión sin `id` que esa cédula tenga
  abierta ese día. Reenviarlo igual vuelve como `duplicado`.
- La hora debe ser exactamente la misma en cada reenvío: si cambia un segundo, Gestor lo toma como
  otro evento.

```json
{ "registros": [ { "usuario": "1023456789", "fecha": "2026-10-13", "hora_login": "07:58:12", "hora_logout": null } ] }
{ "registros": [ { "usuario": "1023456789", "fecha": "2026-10-13", "hora_login": null, "hora_logout": "10:15:00" } ] }
```

En la respuesta, `id` vuelve `null`.

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
| 400 | `VALIDACION` | Cuerpo mal formado (falta `usuario`, `fecha` o ambas horas; `id` que no es un entero > 0 o repetido en el mismo envío; JSON inválido). `detalles` dice qué campo | Corregir y reenviar. No se procesó nada |
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

## 8. Usuarios de la pantalla gris

Desde ahora **Gestor es el dueño de los usuarios de la pantalla gris**. Cuando RRHH contrata a
alguien, Gestor le crea su usuario de pantalla gris y le avisa a AsisLock. Cuando el empleado
inicia sesión en la pantalla gris, AsisLock le pregunta a Gestor si el usuario y la clave son
correctos. Si RRHH registra el retiro, Gestor avisa y el usuario deja de entrar.

Estas credenciales son **solo de la pantalla gris**. No son las del portal de asistencia de Gestor:
cambiar una clave no cambia la otra.

### 8.1 Qué tiene que construir AsisLock

| # | Tarea | Dónde | Sección |
|---|---|---|---|
| 1 | Endpoint `POST /usuarios` para **recibir** las altas, bajas y reactivaciones que envía Gestor | servidor de AsisLock | 8.3 |
| 2 | Tabla para guardar esos usuarios (sin claves) | base `asislock` | 8.3 |
| 3 | Cambiar el inicio de sesión de la pantalla gris para que **valide contra Gestor** | `.exe` → servidor de AsisLock → Gestor | 8.4 |
| 4 | Pantalla de **cambio de clave** obligatorio en el primer ingreso | `.exe` → servidor de AsisLock → Gestor | 8.5 |
| 5 | Carga inicial y conciliación diaria con la lista completa | servidor de AsisLock | 8.6 |
| 6 | Entregar a Gestor la **URL** del endpoint de la tarea 1 y la **clave** con la que Gestor se identifica | — | 8.8 |

```
  RRHH contrata ─► Gestor crea usuario ──aviso "alta"──► AsisLock POST /usuarios  (tarea 1)
                                                                  │ guarda usuario/nombre/activo
  Empleado escribe cédula y clave en la pantalla gris              ▼
  .exe ──► servidor AsisLock ──POST /pantalla-gris/validar──► Gestor ──► válido / motivo
                       ◄────────────── respuesta ───────────────────────┘
  RRHH registra retiro ─► Gestor ──aviso "baja"──► AsisLock marca activo = 0
```

### 8.2 Las credenciales

| | |
|---|---|
| **Usuario** | La **cédula** del empleado: la misma que AsisLock ya envía en `usuario` en `/registros` |
| **Clave inicial** | **La misma cédula.** Al primer ingreso Gestor responde `debe_cambiar_clave: true` y el empleado tiene que cambiarla (8.5) |
| **Qué recibe AsisLock en cada aviso** | `usuario`, `nombre`, `users_company_id` (id de la ficha en Gestor), `activo` y `ocurrido_en` |
| **Qué NO recibe AsisLock** | **La clave.** Nunca viaja en los avisos ni en la lista. La única forma de comprobarla es preguntarle a Gestor (8.4) |

Así, si la base de AsisLock o la red se ven comprometidas, no hay claves que robar, y un cambio de
clave vale en todos los equipos en el mismo instante.

> ⚠️ Las llamadas de 8.4 a 8.6 llevan la `x-api-key` de Gestor. **Deben salir del servidor de
> AsisLock, no del `.exe`** de los equipos de los agentes: desde un `.exe` se puede extraer la
> clave (igual que en el §2). El `.exe` le pide al servidor de AsisLock que valide y este le
> pregunta a Gestor.

### 8.3 Recibir los avisos de Gestor (tareas 1 y 2)

Gestor llama a este endpoint, que **implementa AsisLock**, una vez por cada alta, baja o reactivación:

```
POST <URL base que AsisLock le dé a Gestor>/usuarios
Content-Type: application/json
x-api-key: <clave que AsisLock le dé a Gestor>
Idempotency-Key: 3f6c0f6e-8a51-4c1e-9d2b-0f4f8c2a9b11

{
  "evento": "alta",
  "usuario": "1000930582",
  "nombre": "Ana María Pérez Gómez",
  "users_company_id": 262,
  "activo": true,
  "ocurrido_en": "2026-10-21T19:43:38.809Z"
}
```

| `evento` | Cuándo lo envía Gestor | `activo` | Qué hace AsisLock |
|---|---|---|---|
| `alta` | RRHH registró al empleado (a mano, desde Excel o desde Hydra) | `true` | crea el usuario |
| `baja` | RRHH registró su retiro, o borró la ficha | `false` | lo marca inactivo; si tiene sesión abierta, puede cerrarla |
| `reactivacion` | RRHH deshizo el retiro | `true` | lo vuelve a marcar activo |

**Reglas para el endpoint:**
1. **Comprobar la `x-api-key`**: si no coincide, responder `401`.
2. **Tratar cada aviso como el estado actual** del usuario, no como una orden: crear el usuario si
   no existe, o actualizar `nombre` y `activo` si ya existe. Así no importa si llega una `baja` de
   alguien que AsisLock aún no tenía.
3. **Ignorar un aviso más viejo** (`ocurrido_en` menor) que el último aplicado a ese `usuario`.
   Después de una caída, los avisos pueden llegar tarde o desordenados.
4. **El mismo aviso puede llegar dos veces** (con la misma `Idempotency-Key`): aplicarlo de nuevo
   no debe dañar nada. Con las reglas 2 y 3 eso ya se cumple.
5. **Responder rápido**: Gestor espera 10 segundos como máximo.

| Respuesta de AsisLock | Qué hace Gestor |
|---|---|
| `2xx` | lo da por entregado |
| `409` | lo da por entregado ("ya lo tenía") |
| sin respuesta, `5xx`, `408` o `429` | reintenta a 1, 2, 4, 8… minutos (tope de una hora), hasta 10 intentos |
| otro `4xx` (`400`, `401`, `404`…) | lo marca fallido y no reintenta: revisar URL o clave |

**Tabla sugerida en la base `asislock`:**

```sql
CREATE TABLE usuario_gestor (
  usuario            VARCHAR(50)  NOT NULL PRIMARY KEY,  -- cédula
  nombre             VARCHAR(200) NULL,
  users_company_id   INT          NOT NULL,
  activo             TINYINT(1)   NOT NULL DEFAULT 1,
  ocurrido_en        DATETIME(3)  NOT NULL,              -- del último aviso aplicado (UTC)
  actualizado_en     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**Ejemplo del endpoint (Python + Flask):**

```python
"""recibir_usuarios_gestor.py — endpoint POST /usuarios que llama Gestor Técnico."""
import hmac
import os
from datetime import datetime

import mysql.connector
from flask import Flask, jsonify, request

app = Flask(__name__)
CLAVE_DE_GESTOR = os.environ["CLAVE_QUE_USA_GESTOR"]  # la que AsisLock le entrega a Gestor
EVENTOS = {"alta", "baja", "reactivacion"}


def conectar():
    return mysql.connector.connect(
        host=os.environ["ASISLOCK_DB_HOST"], user=os.environ["ASISLOCK_DB_USER"],
        password=os.environ["ASISLOCK_DB_PASSWORD"], database=os.environ.get("ASISLOCK_DB_NAME", "asislock"),
    )


@app.post("/api/gestor/usuarios")
def recibir_usuario():
    if not hmac.compare_digest(request.headers.get("x-api-key", ""), CLAVE_DE_GESTOR):
        return jsonify(success=False, message="Credenciales inválidas"), 401

    aviso = request.get_json(silent=True) or {}
    if aviso.get("evento") not in EVENTOS or not aviso.get("usuario") or not aviso.get("ocurrido_en"):
        return jsonify(success=False, message="Aviso incompleto"), 400

    ocurrido = datetime.fromisoformat(aviso["ocurrido_en"].replace("Z", "+00:00")).replace(tzinfo=None)
    conexion = conectar()
    try:
        cursor = conexion.cursor()
        # Crea o actualiza, pero nunca con un aviso más viejo que el último aplicado.
        cursor.execute(
            """INSERT INTO usuario_gestor (usuario, nombre, users_company_id, activo, ocurrido_en)
               VALUES (%s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE
                 nombre           = IF(VALUES(ocurrido_en) >= ocurrido_en, VALUES(nombre), nombre),
                 users_company_id = IF(VALUES(ocurrido_en) >= ocurrido_en, VALUES(users_company_id), users_company_id),
                 activo           = IF(VALUES(ocurrido_en) >= ocurrido_en, VALUES(activo), activo),
                 ocurrido_en      = GREATEST(ocurrido_en, VALUES(ocurrido_en))""",
            (str(aviso["usuario"]), aviso.get("nombre"), aviso["users_company_id"],
             1 if aviso["activo"] else 0, ocurrido),
        )
        conexion.commit()
    finally:
        conexion.close()
    return jsonify(success=True)
```

La ruta `/api/gestor/usuarios` es un ejemplo: puede ser cualquiera, siempre que termine en
`/usuarios` y se le entregue a Gestor la parte anterior como URL base.

### 8.4 Inicio de sesión en la pantalla gris (tarea 3)

El servidor de AsisLock llama a Gestor con lo que el empleado escribió:

```
POST http://31.97.138.23:5001/api/integraciones/asislock/v1/pantalla-gris/validar
x-api-key: <la misma clave del §2>
Content-Type: application/json

{ "usuario": "1000930582", "clave": "lo que escribió el empleado" }
```

Clave correcta → `200`:
```json
{
  "success": true,
  "valido": true,
  "usuario": { "usuario": "1000930582", "nombre": "Ana María Pérez Gómez", "users_company_id": 262, "debe_cambiar_clave": true }
}
```

No puede entrar → también `200`, con `valido: false` y un motivo:
```json
{ "success": true, "valido": false, "motivo": "credenciales_invalidas" }
```

| Respuesta | Qué hace la pantalla gris |
|---|---|
| `valido: true`, `debe_cambiar_clave: false` | desbloquea el equipo y registra el login como hoy (y lo envía en `/registros`) |
| `valido: true`, `debe_cambiar_clave: true` | **no desbloquea**: muestra la pantalla de cambio de clave (8.5) |
| `credenciales_invalidas` | "Usuario o clave incorrectos". Sale igual si la cédula no existe: Gestor no revela cuál de los dos falló |
| `bloqueado` | "Demasiados intentos fallidos. Intente en 15 minutos". 5 claves erradas seguidas bloquean 15 minutos |
| `usuario_inactivo` | "Usuario inactivo. Comuníquese con Recursos Humanos". Retirado o sin contrato vigente |
| `400` | la petición vino sin `usuario` o sin `clave` |
| `401` | la `x-api-key` es incorrecta o la IP no está permitida |
| sin respuesta / `5xx` | "Sin conexión con el servidor. Intente de nuevo". **No desbloquear** |

> Sin conexión con Gestor nadie puede entrar a la pantalla gris. Si AsisLock necesita un modo de
> contingencia (por ejemplo, permitir al último usuario que entró en ese equipo), hay que
> acordarlo con el equipo de Gestor antes de implementarlo.

### 8.5 Cambio de clave (tarea 4)

```
POST http://31.97.138.23:5001/api/integraciones/asislock/v1/pantalla-gris/cambiar-clave
x-api-key: <la misma clave del §2>
Content-Type: application/json

{ "usuario": "1000930582", "clave_actual": "1000930582", "clave_nueva": "MiClave2026" }
```

Cambiada → `{ "success": true, "cambiada": true, "usuario": { ...igual que 8.4, "debe_cambiar_clave": false } }`.
El equipo ya se puede desbloquear.

No cambiada → `{ "success": true, "cambiada": false, "motivo": "..." }`:

| `motivo` | Mensaje sugerido |
|---|---|
| `credenciales_invalidas` | "La clave actual no es correcta" (cuenta como intento fallido) |
| `bloqueado`, `usuario_inactivo` | como en 8.4 |
| `clave_corta` | "La clave nueva debe tener al menos 6 caracteres" |
| `clave_igual_usuario` | "La clave nueva no puede ser su número de cédula" |
| `clave_igual_actual` | "La clave nueva debe ser distinta de la actual" |

La clave admite hasta 72 caracteres. No la recorte ni le quite espacios: se compara tal cual.

### 8.6 Lista completa (tarea 5)

Para la **carga inicial** (antes de activar la tarea 3) y como **conciliación diaria**, por si se
perdió algún aviso. No trae claves.

```
GET http://31.97.138.23:5001/api/integraciones/asislock/v1/pantalla-gris/usuarios
x-api-key: <la misma clave del §2>
```

```json
{
  "success": true,
  "total": 398,
  "usuarios": [
    { "usuario": "1000930582", "nombre": "Ana María Pérez Gómez", "users_company_id": 262,
      "activo": true, "debe_cambiar_clave": true, "actualizado_en": "2026-10-21T19:43:38.000Z" }
  ]
}
```

Con cada elemento, aplicar la misma lógica de crear o actualizar de 8.3, con `activo` tal como viene.

### 8.7 Pruebas con curl

```bash
BASE=http://31.97.138.23:5001/api/integraciones/asislock/v1

# Validar (con la cédula de prueba que indique el equipo de Gestor)
curl -s -X POST $BASE/pantalla-gris/validar -H "x-api-key: <clave>" -H "Content-Type: application/json" \
  -d '{"usuario":"<cédula de prueba>","clave":"<cédula de prueba>"}'

# Cambiar la clave
curl -s -X POST $BASE/pantalla-gris/cambiar-clave -H "x-api-key: <clave>" -H "Content-Type: application/json" \
  -d '{"usuario":"<cédula de prueba>","clave_actual":"<cédula de prueba>","clave_nueva":"Prueba2026"}'

# Lista completa
curl -s $BASE/pantalla-gris/usuarios -H "x-api-key: <clave>"

# Probar su propio endpoint de avisos tal como lo llamará Gestor
curl -s -X POST <su URL base>/usuarios -H "x-api-key: <clave que usará Gestor>" \
  -H "Content-Type: application/json" -H "Idempotency-Key: prueba-0001" \
  -d '{"evento":"alta","usuario":"1234567890","nombre":"Prueba Gestor","users_company_id":1,"activo":true,"ocurrido_en":"2026-10-21T15:00:00.000Z"}'
```

Cambiar la clave de la cédula de prueba la deja cambiada: coordinarlo con el equipo de Gestor.

### 8.8 Qué se intercambian los equipos

| AsisLock entrega a Gestor | Gestor entrega a AsisLock |
|---|---|
| URL base del endpoint de avisos (Gestor llama a `<URL>/usuarios`) | La misma `x-api-key` que ya usan para `/registros` sirve para `/pantalla-gris/*` |
| Clave con la que Gestor se identifica en ese endpoint (`x-api-key`) | Una cédula de prueba |
| Si filtran por IP: permitir la IP de Gestor `31.97.138.23` | Aviso de cuándo se activa en producción |

Las claves se comparten por un canal privado, nunca en este documento ni en un chat del equipo.

**Orden de puesta en marcha:**
1. AsisLock publica su endpoint de avisos y entrega URL y clave.
2. Gestor los configura. Desde ese momento, cada contratación nueva llega como `alta`.
3. Si se decide crear usuarios para los empleados que ya existen, Gestor los crea y envía un
   `alta` por cada uno. Si no, AsisLock puede hacer la carga inicial con la lista completa (8.6).
4. AsisLock activa el nuevo inicio de sesión (8.4) y el cambio de clave (8.5) en la pantalla gris.

---

## 9. Soporte

Si un registro queda `rechazado` o la integración responde `401`/`503`, contactar al equipo de
Gestor Técnico con el `id` del registro y la hora del envío. Gestor guarda cada aviso recibido
(tabla `asislock_registro`), así que se puede rastrear qué llegó y qué se hizo con él.
