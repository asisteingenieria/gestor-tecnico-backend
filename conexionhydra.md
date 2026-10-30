# Conexión Hydra → Gestor (Contratación) — Plan de implementación

Estado: **implementado y probado en local** — Fases 1-8, 8.5 y 10 completas:
- los dos backends, las pantallas de RRHH en Gestor y la pantalla "Contratación" en Hydra, probados
  de punta a punta en el navegador con las dos apps (§13.8, §13.9);
- la documentación y los diagramas, en [`docs/diagramas/conexion-hydra/`](docs/diagramas/conexion-hydra/README.md).

Falta confirmar con RRHH/Selección las decisiones de §11 (Fase 0) y ejecutar el despliegue (Fase 9,
con la guía en §14). Nada commiteado todavía. Fecha del plan: 2026-10-01.

Repos involucrados:

| Sistema | Backend | Frontend |
|---|---|---|
| **Gestor** (este repo) — RRHH, empleados | `C:\Users\juan.acosta\Desktop\BackGestor\gestor-tecnico-backend` | `C:\Users\juan.acosta\Desktop\FrontGestor\gestor-tecnico-frontend` |
| **Hydra** — reclutamiento y selección | `C:\Users\juan.acosta\Desktop\ReclutamientoBackend\hidrabackend` | `ReclutamientoFronted/hidrafrontend` (repo hermano) |

---

## 1. Objetivo

Cuando Hydra termina de seleccionar a un grupo de candidatos, envía sus datos a Gestor por API.
En Gestor, Recursos Humanos ve ese grupo como un **lote de contratación**, completa lo que
Hydra no tiene (contrato, salario, seguridad social, cuenta bancaria…) y marca cada sección con
un checkbox de verificación (**Pendiente → Completo**). Cuando todos los candidatos del lote están
completos y verificados, RRHH los **registra todos de una vez** como empleados
(`users_company` y sus tablas). Al final, Gestor le avisa a Hydra y Hydra pasa a cada candidato a
`contratado`.

```
 HYDRA                                    GESTOR
 ─────                                    ──────
 candidato aprobado_final
   │  "Enviar a contratación" (lote)
   ▼
 outbox de Hydra ── POST /lotes ────────▶ staging (hydra_lote / hydra_candidato)
                   (API key + HMAC)          │
                                             │  RRHH completa secciones
                                             │  ☐/☑ verificación por sección
                                             ▼
                                          lote LISTO (todos ☑)
                                             │  "Registrar lote"
                                             ▼
                                          users_company + contrato + … (1 transacción)
                                             │
 candidato → contratado ◀── POST callback ── outbox de Gestor
```

---

## 2. Lo que ya existe y condiciona el diseño

### 2.1 Hydra (revisado en el código, 2026-10-01)

- **Arquitectura limpia**: `src/modules/<modulo>/{routes,service,repository}`, raíz de
  composición en `src/container.js`, configuración validada con **zod** en `src/config/env.js`,
  errores con `HttpError`, transacciones con `unidadDeTrabajo`, pruebas con **vitest**.
- **Ya tiene un patrón de integración saliente**: `src/modules/integraciones/{email,firmacloud,nomina}`
  con un adaptador HTTP + un adaptador en memoria elegido en `container.js` según si la
  configuración existe. La integración con Gestor debe seguir **exactamente** ese patrón
  (`integraciones/gestor/`).
- Usa `X-Api-Key` como cabecera para la API de nómina → mantener la misma convención.
- **Estados**: `estados_candidato` + `estado_transiciones` en BD. Ya existe la transición
  `aprobado_final → contratado` (seed 002) y `contratado` es terminal. Nada en el código la usa
  todavía: la idea es que **solo la conexión con Gestor** la dispare.
- Pasos posteriores a `aprobado_final` (informativos, no cambian estado):
  - Cargo **Agente** → `candidato_citacion_formacion.citado` (migración 015).
  - Cargo **Staff** → `candidato_contratacion.contratado` (migración 016).
- Datos que Hydra tiene del candidato (tablas `candidatos`, `candidato_datos_basicos`,
  `candidato_consentimiento`, etc.):
  nombres y apellidos, tipo y número de documento, email, celular, cliente, cargo, fecha de
  nacimiento, estado civil, género, grupo sanguíneo, EPS, AFP, talla de camisa, dirección, barrio,
  contacto de emergencia (nombre, número, parentesco), estudios, experiencia, aspiración salarial y
  fecha de consentimiento de tratamiento de datos.
- Catálogos con forma `(id, codigo, nombre)`. **Los IDs de Hydra no significan nada en Gestor**.
- Red: Hydra y Gestor se comunican por la **red interna de la empresa (intranet)**, no por
  internet (confirmado por el usuario, 2026-10-01). La URL `http://200.91.204.54:3000` que
  aparece en la documentación de Hydra corresponde a su configuración local/interna. Por eso TLS
  no bloquea la salida a producción (§5.3); la firma HMAC sigue siendo obligatoria.

### 2.2 Gestor (este repo)

- Alta de empleado: `POST /api/users-company` → `UserCompany.create(data)`
  (`models/UserCompany.js:445`), transacción propia que escribe `users_company`, `contrato`,
  `historial_salarial`, `seguridad_social`, `cuenta_bancaria`, `direccion`,
  `contacto_emergencia`, `vacunacion_covid`, `dotacion`, `asignacion_recurso`.
- Validación mínima en `controllers/userCompanyController.js` (`validarObligatorios` +
  `CAMPOS_CONTRATO_OBLIGATORIOS`): identificación, nombres, campaña, área, centro de costo, cargo,
  tipo de contrato, modalidad, oleada, ciudad del contrato, fecha de ingreso y salario > 0.
- El import masivo (`services/importEmpleadosService.js`) ya resuelve **nombres → IDs de
  catálogo** con `normalizar()` (sin tildes, mayúsculas) y sinónimos. Se reutiliza esa función.
- Catálogos de RRHH en `GET /users-company/catalogos` (devuelve IDs; el frontend resuelve nombres).
- Rol `recursosHumanos` ya existe y es quien opera este flujo. **No hace falta rol nuevo.**
- `index.js:38` monta `express.json()` global, sin conservar el cuerpo crudo → hay que tenerlo en
  cuenta para validar la firma HMAC (§5.3).
- Siguiente migración libre: **`059`** (revisar `ls migrations/` justo antes de crearla).
- ⚠️ Lección aprendida (049/054/057 siguen sin poder correr en producción): **ninguna migración
  de este módulo puede llevar IDs de catálogo quemados.** Todo seed se hace por nombre/código.

---

## 3. Decisiones de diseño

| Tema | Decisión | Por qué |
|---|---|---|
| Dirección | **Push** desde Hydra hacia Gestor, y **callback** de Gestor hacia Hydra al registrar | Lo pidió el negocio; Hydra es quien sabe cuándo un candidato está listo |
| Dónde aterrizan los datos | En un **área de staging** (`hydra_lote`, `hydra_candidato`), **nunca directo** en `users_company` | `users_company` exige datos que Hydra no tiene; además un candidato puede desistir antes de firmar |
| Formato del borrador | `datos_empleado` JSON con **la misma forma que el body de `POST /users-company`** | El registro final es literalmente `UserCompany.create(datos_empleado)`; cero mapeo extra y el formulario `AgentForm.jsx` ya sabe editar esa forma |
| Qué viaja entre sistemas | **Códigos/nombres de catálogo**, nunca IDs | Los IDs difieren entre bases (y entre local y producción de Gestor) |
| Catálogos que no casan | Tabla de **mapeo editable** por RRHH (`hydra_mapeo_catalogo`) | Evita hardcodear "Obamacare (Hydra) = OBAMACARE-LV (Gestor)" en código |
| Autenticación máquina-a-máquina | **API key + firma HMAC-SHA256 con timestamp**, una credencial por sentido | No crear usuarios falsos en `users`; la firma evita alteración y replays |
| Idempotencia | Llave natural `hydra_candidato_id` (UNIQUE) + `lote_externo_id` (UNIQUE) + cabecera `Idempotency-Key` | Hydra reintenta sin duplicar |
| Entrega garantizada | **Patrón outbox** en los dos lados (tabla de envíos pendientes + reintentos con backoff) | Si el otro sistema está caído no se pierde nada y no se revierte la transacción local |
| Checkbox de verificación | Por **sección**, ligado a un **hash del contenido de la sección** | Si alguien edita una sección ya verificada, su ☑ se invalida solo |
| Registro del lote | **Todo o nada**, una sola transacción, con **simulación previa** (dry-run) | Es lo que pidió el negocio ("registrar todos") y replica el preview/commit del import masivo |
| Arquitectura en Gestor | Módulo **nuevo en cuatro capas** (`domain/` → `repositories/` → `services/` → `controllers/`), igual que asistencia | Tiene reglas de dominio reales (completitud, máquina de estados) que deben poder probarse sin BD |
| Versionado de API | Prefijo `/v1` en los endpoints de integración | Permite cambiar el contrato sin romper a Hydra |

---

## 4. Modelo de datos en Gestor (migraciones `059`–`061`)

### 4.1 `059_create_hydra_staging.sql`

```sql
-- Lote = un envío de Hydra (normalmente un grupo de formación / una oleada de ingreso)
CREATE TABLE hydra_lote (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lote_externo_id  VARCHAR(64)  NOT NULL COMMENT 'ID que genera Hydra; llave de idempotencia',
  nombre           VARCHAR(150) NOT NULL,
  fecha_ingreso_sugerida DATE   NULL,
  estado           ENUM('abierto','listo','registrado','cancelado') NOT NULL DEFAULT 'abierto',
  registrado_por   INT NULL COMMENT 'users.id de RRHH que registró',
  registrado_en    DATETIME NULL COMMENT 'UTC',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hydra_lote_externo (lote_externo_id),
  KEY idx_hydra_lote_estado (estado, created_at)
) ENGINE=InnoDB;

CREATE TABLE hydra_candidato (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lote_id              INT UNSIGNED NOT NULL,
  hydra_candidato_id   INT UNSIGNED NOT NULL COMMENT 'candidatos.id en Hydra',
  -- Columnas extraídas solo para listar/buscar; la verdad está en los JSON
  tipo_identificacion  VARCHAR(10)  NOT NULL,
  numero_identificacion VARCHAR(20) NOT NULL,
  nombre_completo      VARCHAR(200) NOT NULL,
  cargo_hydra          VARCHAR(120) NULL,
  datos_hydra          JSON NOT NULL COMMENT 'Payload original de Hydra (última versión recibida)',
  version_hydra        INT UNSIGNED NOT NULL DEFAULT 1,
  datos_empleado       JSON NOT NULL COMMENT 'Borrador con la forma del body de POST /users-company',
  estado               ENUM('pendiente','listo','registrado','descartado','cancelado_hydra')
                       NOT NULL DEFAULT 'pendiente',
  motivo_descarte      VARCHAR(255) NULL,
  -- Si la cédula ya existe en users_company (reintegro), se marca y RRHH decide
  users_company_existente_id INT NULL,
  users_company_id     INT NULL COMMENT 'Empleado creado al registrar',
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hydra_candidato_externo (hydra_candidato_id),
  KEY idx_hydra_candidato_lote (lote_id, estado),
  KEY idx_hydra_candidato_ident (numero_identificacion),
  CONSTRAINT fk_hydra_candidato_lote FOREIGN KEY (lote_id) REFERENCES hydra_lote (id),
  CONSTRAINT fk_hydra_candidato_uc   FOREIGN KEY (users_company_id) REFERENCES users_company (id)
) ENGINE=InnoDB;

-- Un checkbox por sección. Existe la fila = está marcado.
CREATE TABLE hydra_candidato_verificacion (
  hydra_candidato_id INT UNSIGNED NOT NULL COMMENT 'hydra_candidato.id (staging), no el de Hydra',
  seccion        ENUM('personal','contrato','salario','seguridad_social',
                      'cuenta_bancaria','direccion_contacto','dotacion') NOT NULL,
  hash_contenido CHAR(64) NOT NULL COMMENT 'SHA-256 de la sección al momento de verificar',
  verificado_por INT NOT NULL COMMENT 'users.id',
  verificado_en  DATETIME NOT NULL COMMENT 'UTC',
  PRIMARY KEY (hydra_candidato_id, seccion),
  CONSTRAINT fk_hydra_verif_candidato FOREIGN KEY (hydra_candidato_id)
    REFERENCES hydra_candidato (id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

> El tipo `JSON` requiere MySQL ≥ 5.7.8. Confirmar con `SELECT VERSION();` en producción antes de
> aplicar.

### 4.2 `060_create_hydra_mapeo_catalogo.sql`

```sql
CREATE TABLE hydra_mapeo_catalogo (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  catalogo     VARCHAR(40)  NOT NULL COMMENT 'tipo_identificacion, cliente, cargo, eps, afp, genero, ...',
  valor_hydra  VARCHAR(150) NOT NULL COMMENT 'Código de Hydra, tal como llega',
  id_gestor    INT NOT NULL COMMENT 'ID en la tabla de catálogo de Gestor',
  creado_por   INT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hydra_mapeo (catalogo, valor_hydra)
) ENGINE=InnoDB;
```

Resolución de cada valor de catálogo, en este orden:
1. ¿Hay fila en `hydra_mapeo_catalogo`? → usarla.
2. ¿Coincide por `normalizar()` (la de `importEmpleadosService.js`) con el nombre en Gestor? → usarla.
3. Si no → el campo queda vacío en `datos_empleado` y se reporta como **"valor de Hydra sin
   mapear"** en la sección. RRHH puede elegir el valor correcto y **"recordar este mapeo"**, lo
   que inserta la fila del paso 1 para los siguientes lotes.

Sin seeds con IDs: la tabla nace vacía y se llena desde la UI.

### 4.3 `061_create_hydra_outbox.sql`

```sql
CREATE TABLE hydra_envio_saliente (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo           ENUM('candidato_registrado','candidato_descartado') NOT NULL,
  hydra_candidato_id INT UNSIGNED NOT NULL,
  payload        JSON NOT NULL,
  idempotency_key CHAR(36) NOT NULL,
  estado         ENUM('pendiente','enviado','fallido') NOT NULL DEFAULT 'pendiente',
  intentos       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  proximo_intento DATETIME NOT NULL COMMENT 'UTC',
  ultimo_error   VARCHAR(500) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hydra_envio_idem (idempotency_key),
  KEY idx_hydra_envio_pendiente (estado, proximo_intento)
) ENGINE=InnoDB;

-- Auditoría de peticiones entrantes (sin el cuerpo: contiene datos personales)
CREATE TABLE hydra_peticion_entrante (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(64) NOT NULL,
  endpoint       VARCHAR(120) NOT NULL,
  hash_cuerpo    CHAR(64) NOT NULL,
  codigo_respuesta SMALLINT UNSIGNED NOT NULL,
  respuesta      JSON NULL COMMENT 'Se devuelve tal cual si llega la misma Idempotency-Key',
  ip_origen      VARCHAR(45) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hydra_peticion_idem (idempotency_key)
) ENGINE=InnoDB;
```

---

## 5. Contrato de la API

### 5.1 Hydra → Gestor (máquina a máquina)

Base: `/api/integraciones/hydra/v1`. Sin JWT; autenticación según §5.3.

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/lotes` | Crea un lote con N candidatos. Idempotente por `lote_externo_id`. |
| `PUT` | `/candidatos/:hydraCandidatoId` | Reenvía datos actualizados de un candidato (solo si no está `registrado`). |
| `POST` | `/candidatos/:hydraCandidatoId/cancelar` | El candidato desistió en Hydra → `cancelado_hydra`. |
| `GET` | `/candidatos/:hydraCandidatoId` | Estado en Gestor (respaldo por si se pierde el callback). |

Ejemplo de `POST /lotes`:

```json
{
  "lote_externo_id": "HYD-2026-10-01-FORM-12",
  "nombre": "Formación Claro Bogotá — 06/10/2026",
  "fecha_ingreso_sugerida": "2026-10-06",
  "candidatos": [
    {
      "hydra_candidato_id": 4821,
      "version": 1,
      "identificacion": { "tipo": "CC", "numero": "1012345678" },
      "nombres": { "primer_nombre": "Laura", "segundo_nombre": null,
                   "primer_apellido": "Gómez", "segundo_apellido": "Ruiz" },
      "contacto": { "email": "laura@example.com", "celular": "3001234567" },
      "personal": { "fecha_nacimiento": "2001-05-14", "genero": "femenino",
                    "estado_civil": "soltero", "grupo_sanguineo": "O+" },
      "seguridad_social": { "eps": "sanitas", "afp": "porvenir" },
      "direccion": { "direccion": "Cra 10 # 20-30", "barrio": "Chapinero" },
      "contacto_emergencia": { "nombre": "Ana Ruiz", "telefono": "3109876543",
                               "parentesco": "madre" },
      "dotacion": { "talla_camisa": "M" },
      "proceso": { "cliente": "claro", "cargo": "agente_call_center",
                   "aprobado_final_en": "2026-09-29T15:04:00Z" },
      "consentimiento": { "fecha": "2026-09-20", "ciudad": "Bogotá" }
    }
  ]
}
```

Reglas del contrato:
- Fechas de negocio como `YYYY-MM-DD`; instantes como ISO-8601 **en UTC** (`...Z`).
- Catálogos por **`codigo` de Hydra**, nunca por ID.
- Límite: **200 candidatos por lote** y **1 MB** por petición.
- `version` crece en cada reenvío; Gestor ignora versiones menores o iguales a la que ya tiene.

Respuestas (sobre uniforme, legible por máquina):

```json
{ "success": true, "lote_id": 17,
  "candidatos": [ { "hydra_candidato_id": 4821, "resultado": "creado" },
                  { "hydra_candidato_id": 4822, "resultado": "reintegro_detectado" } ] }
```

```json
{ "success": false, "codigo": "VALIDACION", "message": "Datos inválidos",
  "detalles": [ "candidatos[0].identificacion.numero es requerido" ] }
```

| HTTP | `codigo` | Cuándo | ¿Hydra reintenta? |
|---|---|---|---|
| 201/200 | — | Creado / ya existía (idempotente) | No |
| 400 | `VALIDACION` | Payload mal formado o JSON inválido (> 200 candidatos también es 400) | No (bug, alertar) |
| 400 | `IDEMPOTENCY_KEY_REQUERIDA` | Falta `Idempotency-Key` en POST/PUT | No (bug) |
| 401 | `FIRMA_INVALIDA` | API key, firma o timestamp inválidos (mismo mensaje para todo) | No (alertar) |
| 404 | `NO_ENCONTRADO` | PUT/cancelar/consultar un candidato que Gestor no tiene | No |
| 409 | `LOTE_CERRADO` | El lote ya está `registrado` o `cancelado` | No |
| 409 | `PETICION_CONCURRENTE` | Dos envíos simultáneos del mismo lote nuevo | **Sí** |
| 413 | `LOTE_DEMASIADO_GRANDE` | Cuerpo > 1 MB | No |
| 422 | `REGLA_CONTRATACION` | PUT/cancelar sobre un candidato ya `registrado` | No |
| 422 | `IDEMPOTENCY_KEY_REUTILIZADA` | Misma `Idempotency-Key` con otro cuerpo u otro endpoint | No (bug) |
| 503 | `INTEGRACION_NO_CONFIGURADA` | Gestor sin `HYDRA_API_KEY`/`HYDRA_HMAC_SECRET` | **Sí** |
| 429 / 5xx | — | Límite o error de Gestor | **Sí**, con backoff |

Valores de `resultado` por candidato en `POST /lotes` y `PUT /candidatos/:id`:
`creado`, `reintegro_detectado` (creado, pero la cédula ya existe en `users_company`),
`actualizado`, `sin_cambios` (versión ≤ a la guardada), `ya_registrado`, `en_otro_lote`
(el candidato pertenece a otro lote; no se toca).

### 5.2 Gestor → Hydra (callback)

Base en Hydra: `/api/integraciones/gestor/v1`.

| Método | Ruta | Efecto en Hydra |
|---|---|---|
| `POST` | `/contrataciones` | `{ hydra_candidato_id, users_company_id, fecha_ingreso, registrado_en }` → transición `aprobado_final → contratado` con `motivo = 'Registrado en Gestor (empleado #N)'` en `candidato_estado_historial` (`usuario_id = NULL`). |
| `POST` | `/descartes` | `{ hydra_candidato_id, motivo }` → nota en el expediente. **No cambia estado** (§11, decisión abierta 3). |

### 5.3 Seguridad del canal

Cabeceras obligatorias en ambos sentidos:

```
X-Api-Key:          <clave del emisor>
X-Timestamp:        <epoch en segundos>
X-Signature:        sha256=<hex(HMAC_SHA256(secreto, timestamp + "." + cuerpoCrudo))>
Idempotency-Key:    <uuid v4>
```

- La API key identifica al emisor; el **HMAC** prueba que el cuerpo no se alteró.
- Se rechaza si `|ahora − timestamp| > 300 s` (anti-replay).
- Comparación con `crypto.timingSafeEqual`, nunca con `===`.
- **Secretos distintos por sentido** (Hydra→Gestor y Gestor→Hydra), en `.env`, nunca en el repo.
  Rotación: aceptar dos claves a la vez durante el cambio (`HYDRA_API_KEYS=actual,anterior`).
- **Cuerpo crudo**: `index.js` monta `express.json()` global. El router de integración se monta
  **antes** de esa línea con su propio `express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } })`.
- **Transporte**: el tráfico va solo por la red interna, así que HTTP es aceptable en v1. La firma
  HMAC garantiza integridad y autenticidad aunque no haya TLS; TLS queda como mejora opcional.
- Lista blanca de IPs en nginx (`allow`/`deny`): cada servidor solo acepta los endpoints de
  integración desde la IP interna del otro. Esto también impide que alguien de la misma red
  llame la API aunque conozca la URL.
- Límite de peticiones en el router de integración (p. ej. 60/min). Gestor no tiene
  `express-rate-limit` — agregar la dependencia o limitar en nginx (`limit_req`).
- Logs: registrar `Idempotency-Key`, endpoint, código y hash del cuerpo. **Nunca el cuerpo** (lleva
  cédula, dirección, EPS — datos personales bajo la Ley 1581 de 2012).

---

## 6. Flujo de completitud en Gestor

### 6.1 Estados

```
Candidato (staging)                         Lote
──────────────────                          ────
pendiente ──(todas las secciones ☑)──▶ listo     abierto ──(0 pendientes, ≥1 listo)──▶ listo
   ▲                                      │      listo   ──(registrar)──▶ registrado
   └──────(se edita una sección ☑)────────┘      abierto/listo ──(cancelar)──▶ cancelado
pendiente|listo ──(RRHH descarta)──▶ descartado
pendiente|listo ──(Hydra cancela)──▶ cancelado_hydra
listo ──(registrar lote)──▶ registrado
```

El estado del candidato y del lote **se derivan** de los datos y las verificaciones; se recalculan
y guardan en la misma transacción de cada cambio, nunca se editan a mano.

### 6.2 Secciones y campos obligatorios

La primera versión toma como obligatorios **exactamente** los que hoy exige
`validarObligatorios` en `userCompanyController.js` (así el registro nunca falla por validación).
Los "obligatorios de negocio" adicionales se confirman con RRHH **contra las dos hojas fuente**
("Nuevo Epleado" y "EJEMPLO" — ver regla al inicio de `claude/modulo recursoshumanos.md`).

| Sección | Lo trae Hydra | Lo completa RRHH | Obligatorio para ☑ |
|---|---|---|---|
| `personal` | tipo/núm. documento, nombres, fecha nac., género, estado civil, grupo sanguíneo, email, teléfono | fecha y ciudad de expedición, ciudad de nacimiento, n.º de hijos, RUT, libreta militar | tipo y núm. de identificación, primer nombre, primer apellido |
| `contrato` | cliente y cargo (como referencia) | campaña, área, centro de costo, cargo, tipo de contrato, modalidad, oleada, ciudad, fecha de ingreso, jefes, empresa, periodo de pago… | los 9 de `CAMPOS_CONTRATO_OBLIGATORIOS` |
| `salario` | (aspiración salarial, solo informativa) | salario, bonos (sugerido vía `salario_referencia`) | salario > 0 |
| `seguridad_social` | EPS, AFP | ARL + tarifa, caja, cesantías, fechas de afiliación | tarifa ARL válida si hay ARL (misma regla actual) |
| `cuenta_bancaria` | — | banco, tipo, número | ninguno (se puede verificar vacía) |
| `direccion_contacto` | dirección, barrio, contacto de emergencia | tipo de dirección, ciudad, zona, tipo de vivienda | ninguno en v1 |
| `dotacion` | talla de camisa | pantalón, calzado, `aplica_dotacion` | ninguno |

Reglas del checkbox:
- Una sección **solo se puede marcar** si no le faltan obligatorios ni tiene valores de Hydra sin mapear.
- Al marcar se guarda `SHA-256(JSON canónico de la sección)`. Si después cambia el contenido, el
  hash ya no coincide y la sección vuelve a **Pendiente** automáticamente (y se avisa en la UI).
- Un candidato es `listo` cuando **todas** sus secciones están ☑ con hash vigente.
- Reintegro (`users_company_existente_id` no nulo): la sección `personal` no se puede marcar hasta
  que RRHH elija entre "Actualizar la ficha existente" o "Descartar" (§11, decisión abierta 4).

### 6.3 Lógica pura (testeable sin BD)

`domain/contratacionHydra/`:
- `secciones.js` — qué campos de `datos_empleado` pertenecen a cada sección y cuáles son obligatorios.
- `evaluarCompletitud(datosEmpleado, verificaciones)` → `{ seccion: { completa, faltantes[], verificada, vigente } }`.
- `estadoCandidato(...)` y `estadoLote(...)`.
- `hashSeccion(datosEmpleado, seccion)` — JSON con llaves ordenadas → SHA-256.
- `mapearPayloadHydra(payload, resolverCatalogo)` → `{ datosEmpleado, sinMapear[] }`.

Tests en `tests/contratacionHydra/*.test.js` (corren con el `npm test` actual).

---

## 7. Registro del lote

`POST /api/contratacion-hydra/lotes/:id/registrar` (rol `recursosHumanos`/`admin`).

1. Con `?simular=true` corre **todo** dentro de una transacción y hace `ROLLBACK` al final,
   devolviendo qué se crearía y cualquier error (mismo espíritu que `import-excel/preview`).
2. Sin `simular`:
   1. `SELECT ... FROM hydra_lote WHERE id = ? FOR UPDATE` → bloquea el lote (evita doble clic /
      dos usuarios registrando a la vez). Si no está `listo` → `409`.
   2. Por cada candidato `listo`: recalcular completitud y hashes (no confiar en el estado
      guardado), volver a correr `validarObligatorios`, verificar que la cédula siga sin existir.
   3. Crear el empleado **con la misma conexión**: `UserCompany.crearEnConexion(conn, datos)`.
   4. Guardar `users_company_id`, pasar el candidato a `registrado`.
   5. Insertar una fila `candidato_registrado` en `hydra_envio_saliente` por candidato.
   6. Lote → `registrado`, `registrado_por`, `registrado_en` (UTC). `COMMIT`.
3. Si algo falla → `ROLLBACK` total y respuesta con el detalle por candidato.

**Refactor necesario (pequeño, sin cambiar comportamiento):** extraer el cuerpo de
`UserCompany.create` a `static async crearEnConexion(conn, data)` (sin `beginTransaction`/`commit`),
y dejar `create()` como envoltorio que abre la transacción y lo llama. Igual con
`validarObligatorios`: moverlo del controller a un módulo compartido
(`utils/validarEmpleado.js`) para que lo usen el controller viejo y el servicio nuevo.

### 7.1 Despachador del outbox

`scripts/despacharEnviosHydra.js` (cron cada minuto en el servidor, igual que
`cerrarJornadasDelDia.js`) — o un `setInterval` dentro del proceso si se prefiere no tocar cron:
- Toma filas `pendiente` con `proximo_intento <= UTC_TIMESTAMP()` (`FOR UPDATE SKIP LOCKED`).
- Envía con firma HMAC y la `idempotency_key` de la fila.
- 2xx o 409 → `enviado`. 5xx/red → `intentos++`, backoff exponencial (1, 2, 4, 8… min, tope 1 h).
- A los 10 intentos → `fallido`, visible en la UI de RRHH con botón "Reintentar".

---

## 8. Endpoints internos de Gestor (UI de RRHH)

Base `/api/contratacion-hydra`, `verifyToken` + `recursosHumanos`/`admin`.

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/lotes?estado=` | Bandeja de lotes con conteo `listos / total` |
| `GET` | `/lotes/:id` | Lote + candidatos + estado por sección |
| `GET` | `/candidatos/:id` | `datos_hydra`, `datos_empleado`, completitud, sin mapear |
| `PUT` | `/candidatos/:id/secciones/:seccion` | Guarda los campos de una sección |
| `PUT` | `/candidatos/:id/secciones/:seccion/verificacion` | `{ verificado: true|false }` (el checkbox) |
| `POST` | `/candidatos/:id/descartar` | `{ motivo }` |
| `POST` | `/lotes/:id/registrar[?simular=true]` | §7 |
| `GET`/`POST` | `/mapeos` | Ver / agregar mapeos de catálogo |
| `GET` | `/envios?estado=fallido` · `POST /envios/:id/reintentar` | Monitoreo del outbox |

Validación de entrada con `middleware/validar.js` + esquemas en
`validators/contratacionHydraSchemas.js`, como en asistencia. Todo SQL parametrizado con `?`.

---

## 9. Paso a paso de implementación

Cada fase termina en algo que se puede probar solo.

### Fase 0 — Acuerdos (sin código)
- [ ] Cerrar las decisiones abiertas de §11 con RRHH y Selección.
- [ ] Congelar el contrato de §5 (este documento) como fuente de verdad entre ambos equipos.
- [ ] Generar los secretos (`openssl rand -hex 32`) para cada sentido y guardarlos fuera del repo.
- [ ] Confirmar versión de MySQL de producción (soporte `JSON`).

### Fase 1 — Gestor: esquema y dominio ✅ (2026-10-01, ver §13)
- [x] Migraciones `059`, `060`, `061` (sin IDs quemados). Aplicadas en local.
- [x] `domain/contratacionHydra/*` + tests con `node --test` (completitud, hash, estados, mapeo).

### Fase 2 — Gestor: API de entrada (Hydra → Gestor) ✅ (2026-10-01, ver §13.2)
- [x] `middleware/autenticarHydra.js` (API key + HMAC + timestamp + `timingSafeEqual`).
- [x] Router `routes/integracionHydra.js` montado **antes** de `express.json()` en `index.js`.
- [x] Repositorios `repositories/contratacionHydra/*`, servicio de recepción (idempotencia, versión,
      detección de reintegro, mapeo de catálogos).
- [x] Probar con un script `scripts/simularEnvioHydra.js` que firma y envía un lote de prueba
      (cédulas ficticias `9100000001…`, nunca datos reales).

### Fase 3 — Gestor: API de RRHH (completar y verificar) ✅ (2026-10-01, ver §13.3)
- [x] Servicio de secciones y verificación; recalcular estado de candidato y lote en cada cambio.
- [x] Endpoints de §8 excepto registrar (y el monitoreo de envíos, que depende del outbox de la
      Fase 4).

### Fase 4 — Gestor: registro del lote + outbox ✅ (2026-10-01, ver §13.4)
- [x] Refactor `UserCompany.crearEnConexion` y `utils/validarEmpleado.js` (`POST /users-company`
      verificado contra el servidor; el import masivo y `scripts/seedEmpleadosAsistencia.js` también
      llaman a `create()`, que conserva el mismo retorno `{ id, ...data }` y los mismos mensajes).
- [x] `registrar` con `simular`, bloqueo `FOR UPDATE`, transacción única.
- [x] `scripts/despacharEnviosHydra.js` + adaptador HTTP hacia Hydra.

### Fase 5 — Hydra: envío (Hydra → Gestor) ✅ (2026-10-01, ver §13.5)
- [x] Migración `018_integracion_gestor.sql`: `contratacion_lotes`, `contratacion_candidatos`
      (estado de cada candidato en Gestor) y `contratacion_envios` (outbox).
- [x] `src/config/env.js`: `GESTOR_API_URL`, `GESTOR_API_KEY`, `GESTOR_HMAC_SECRET` (opcionales,
      validadas con zod, igual que `NOMINA_*`).
- [x] `src/modules/integraciones/gestor/index.js`: `crearGestorHttp` + `crearGestorMemoria`, y
      `elegirGestor()` en `container.js` (sin configuración → `null`, no memoria: ver §13.5).
- [x] `POST /api/contratacion/lotes` (elegibles → payload → outbox en la misma transacción),
      reenviar, cancelar, reintentar, y despachador con reintentos (inmediato + periódico).
- [x] Permiso nuevo `enviar_contratacion` (administrador y selección), por código, en la 018.
- [x] Tests de vitest: unitarios de reglas/firma y de integración con el adaptador en memoria.

### Fase 6 — Hydra: recepción del callback (Gestor → Hydra) ✅ (2026-10-01, ver §13.5)
- [x] Middleware de verificación HMAC (mismo algoritmo; verificado byte a byte contra Gestor).
- [x] `POST /api/integraciones/gestor/v1/contrataciones` → transición a `contratado` por
      `estadoServicio` dentro de `unidadDeTrabajo`, idempotente (si ya está `contratado`, 200).
- [x] `POST /descartes` → nota en `contratacion_candidatos` (no cambia el estado en Hydra).

### Fase 7 — Frontend Gestor ✅ (2026-10-01, ver §13.7)
- [x] `src/services/api.js`: `contratacionHydraService` (contrato manual, como exige `CLAUDE.md`).
- [x] Ítem de menú en el layout de RRHH: **"Contratación Hydra"** con contador de lotes abiertos.
- [x] Bandeja de lotes → detalle de lote: tabla de candidatos con un punto por sección
      (verde completo / ámbar pendiente / rojo cambió tras verificar), barra `listos/total`, botón
      **Registrar lote** deshabilitado hasta que todo esté ☑ (con tooltip de qué falta).
- [x] Panel por candidato: pestaña "Datos de Hydra" (solo lectura) y pestaña "Checklist" con las
      secciones editables y un checkbox **"Verificado"** por sección (deshabilitado mientras falten
      obligatorios o haya cambios sin guardar). Las reglas de `AgentForm.jsx` se copiaron a
      `src/utils/catalogosRRHH.js` en vez de reutilizar sus bloques (ver §13.7).
- [x] Aviso de "valor sin mapear" dentro de la sección, con "Usar y recordar".
- [x] Modal de registro que primero corre `?simular=true` y solo después permite confirmar.
- [x] Estilo "Opción C" (navy) del resto de RRHH.

### Fase 8 — Frontend Hydra ✅ (2026-10-01, ver §13.9)
- [x] Pantalla propia **"Contratación"** (menú Selección): selección múltiple de elegibles + botón
      **"Enviar a contratación"**, y seguimiento de cada lote con el estado del envío por candidato
      (en cola / en RRHH / contratado / descartado / cancelado / error), reenviar, cancelar y
      reintentar.
- [x] El historial muestra "Gestor Técnico (automático)" en el paso a `contratado`.

### Fase 8.5 — Prueba integrada en local (requisito antes de desplegar) ✅ (2026-10-01)
Backends (§13.6) y pantallas de las dos apps (§13.8 y §13.9).
- [x] Levantar **los dos backends en local a la vez** (Hydra en `:3099`, Gestor en `:5099`, con las
      credenciales cruzadas como variables de entorno del proceso, sin tocar los `.env`).
- [x] Flujo completo real: enviar lote desde Hydra → completar, mapear y verificar en Gestor →
      registrar → el aviso deja al candidato `contratado` en Hydra.
- [x] Casos de falla: Gestor apagado durante el envío (el outbox de Hydra reintenta) e Hydra
      apagado durante el aviso (el outbox de Gestor reintenta). Reenvío y cancelación se probaron
      en las pruebas de cada lado (§13.4 y §13.5).
- [x] Repetir el flujo completo **desde las pantallas** (Fases 7 y 8) — §13.9.
- [x] Solo con esto en verde se pasa a la Fase 9.

### Fase 9 — Infraestructura y despliegue (guía lista, sin ejecutar: §14)
- [x] Guía paso a paso (§14) y `npm run verificar-hydra` (`scripts/verificarConexionHydra.js`):
      comprueba versión de MySQL, tablas, credenciales, salud de Hydra y firma en los dos sentidos,
      sin escribir nada. Probado en local contra los dos backends: el caso correcto, una clave
      que no coincide (en cada sentido) y Hydra apagado.
- [ ] Confirmar las IPs internas de ambos servidores y que se ven entre sí por la intranet
      (`curl` desde srv845606 al health check de Hydra y viceversa).
- [ ] Lista blanca de IPs internas en nginx para los endpoints de integración en ambos servidores.
- [ ] (Opcional) TLS interno entre ambos servidores.
- [ ] Variables `.env` en ambos servidores (sin commitear). pm2 restart.
- [ ] Cron del despachador en ambos servidores. En Gestor:
      `* * * * * cd /root/gestor-tecnico-backend && node scripts/despacharEnviosHydra.js >> logs/hydra-envios.log 2>&1`.
- [ ] Confirmar `SELECT VERSION();` en producción: el despachador usa `FOR UPDATE SKIP LOCKED`
      (MySQL 8+) y el staging usa columnas `JSON` (5.7.8+).
- [ ] Migraciones a mano en producción en orden; **frontend de Gestor: `npm install && npm run
      build` después del pull, sin excepción**.
- [ ] Prueba end-to-end en producción con **un** candidato de prueba antes del primer lote real.

### Fase 10 — Documentación ✅ (2026-10-01)
- [x] Notas de implementación al final de este archivo (§13) y guía de despliegue (§14).
- [x] `CLAUDE.md`: módulo nuevo en cuatro capas, migraciones aplicadas, script del despachador.
- [x] `claude/modulo recursoshumanos.md`: §30 enlaza aquí y a los diagramas.
- [x] Contexto equivalente en Hydra: `claude/integracion-gestor.md`. No se tocó `claude/context.md`,
      que tiene cambios del usuario sin commitear.
- [x] Diagramas con Archify en [`docs/diagramas/conexion-hydra/`](docs/diagramas/conexion-hydra/README.md):
  - arquitectura;
  - secuencia del envío de un lote;
  - secuencia del registro y aviso;
  - estados del candidato;
  - flujo de datos.

  Los cinco pasaron las validaciones de Archify y la prueba en Chrome, y además se revisaron sus
  capturas a ojo.

---

## 10. Pruebas

| Nivel | Qué | Dónde |
|---|---|---|
| Unidad | completitud, hash de sección, estados, mapeo de payload | Gestor `tests/contratacionHydra/` (`node --test`) |
| Unidad | firma HMAC (válida, alterada, vencida, clave rotada) | ambos |
| Integración | lote idempotente (mismo POST dos veces = un lote), versión vieja ignorada, reintegro detectado | Gestor, script contra BD local |
| Integración | registro todo-o-nada: forzar error en el candidato 3 de 5 → 0 empleados creados | Gestor |
| Integración | callback → `contratado`; callback repetido → 200 sin duplicar historial | Hydra (vitest) |
| E2E | Hydra local → Gestor local → registrar → Hydra muestra `contratado` | **ambos backends corriendo en local a la vez** (requisito del usuario, 2026-10-01: la prueba entre las dos apps se hace primero en local, antes de cualquier despliegue; el simulador `scripts/simularEnvioHydra.js` solo sirve para probar Gestor por separado) |
| Caos | Gestor apagado durante el envío → outbox reintenta y entrega al volver | ambos |

---

## 11. Decisiones abiertas (recomendación incluida)

1. **¿Qué candidatos de Hydra son elegibles para enviar?**
   Recomendado: `aprobado_final` **y** (Agente con `citacion_formacion.citado = TRUE` **o** Staff con
   `contratacion.contratado = TRUE`).
2. **¿Qué es un lote?** Recomendado: lo arma Selección en Hydra a mano (un grupo de formación o una
   fecha de ingreso), con nombre y fecha de ingreso sugerida.
3. **Si RRHH descarta a un candidato, ¿Hydra cambia su estado?** Recomendado: no en v1, solo nota
   en el expediente (no hay transición `aprobado_final → rechazado_final` por esta vía y meterla
   mezcla responsabilidades).
4. **Reintegros** (la cédula ya existe en `users_company`, p. ej. un exempleado retirado).
   Recomendado: en v1 se marca y RRHH lo descarta del lote y lo gestiona con el flujo actual de
   "Reactivar" del módulo de Retiro. La actualización automática de la ficha queda para v2.
5. **¿Se permite registrar un lote parcial** (los listos, dejando los pendientes para después)?
   El requerimiento dice "cuando todos estén completos". Recomendado: respetarlo, con la salida de
   **descartar** al que no vaya a completarse.
6. **Documentos** (hoja de vida PDF, antecedentes, firma de FirmaCloud): fuera de v1. En v2, enviar
   enlaces firmados de corta duración a Hydra en vez de copiar archivos.
7. **Retención de `datos_hydra`** después de registrar. Recomendado: purgar el JSON a los 90 días
   (minimización de datos, Ley 1581) dejando solo `hydra_candidato_id` ↔ `users_company_id`.

---

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Catálogos con nombres distintos (cliente/campaña, cargos) | Tabla de mapeo + "recordar mapeo"; nunca IDs en el contrato |
| Llamadas no autorizadas desde la misma red interna | Firma HMAC + lista blanca de IPs internas; TLS opcional |
| Doble registro por doble clic o dos usuarios | `FOR UPDATE` sobre el lote + `UNIQUE` en `hydra_candidato_id` + validación de cédula |
| Hydra caído al registrar | Outbox: la contratación en Gestor no depende de que Hydra responda |
| Edición posterior a la verificación pasa desapercibida | Hash por sección invalida el ☑ automáticamente |
| Seeds con IDs que rompen en producción (como 049/054/057) | Migraciones sin IDs; mapeos desde la UI |
| Fechas corridas por UTC | Fechas de negocio como `DATE` `YYYY-MM-DD`; instantes en UTC; nada de `CURDATE()` para la fecha de ingreso |

---

## 13. Notas de implementación

### 13.1 Fase 1 (2026-10-01)

**Archivos**

| Archivo | Contenido |
|---|---|
| `migrations/059_create_hydra_staging.sql` | `hydra_lote`, `hydra_candidato`, `hydra_candidato_verificacion` |
| `migrations/060_create_hydra_mapeo_catalogo.sql` | `hydra_mapeo_catalogo` (nace vacía) |
| `migrations/061_create_hydra_outbox_y_auditoria.sql` | `hydra_envio_saliente`, `hydra_peticion_entrante` |
| `domain/contratacionHydra/rutas.js` | `obtener`/`asignar` por ruta (`"contrato.cargo_id"`), `estaVacio` |
| `domain/contratacionHydra/secciones.js` | Las 7 secciones: campos, obligatorios, validaciones y grupos todo-o-nada |
| `domain/contratacionHydra/completitud.js` | `evaluarCompletitud`, `hashSeccion` |
| `domain/contratacionHydra/estados.js` | Estados derivados de candidato/lote y los `assert*` |
| `domain/contratacionHydra/mapearPayloadHydra.js` | Payload Hydra → `datos_empleado`, `fusionarReenvioHydra`, `datosEmpleadoVacio` |
| `errors/AppError.js` | Nuevo `ReglaContratacionError` (422, `REGLA_CONTRATACION`) |
| `tests/contratacionHydra/*.test.js` | 38 pruebas nuevas (`npm test`: 64 en total, todas pasan) |

Las migraciones se aplicaron dos veces seguidas en la BD local (MySQL 9.6) para comprobar que
son idempotentes (`CREATE TABLE IF NOT EXISTS`).

**Desvíos respecto a §4**

- Nombres alineados con la convención del repo: PK `id<tabla>` (`idhydra_lote`, …), FK
  `hydra_lote_id`, usuarios como `*_user_id`, `INT` con signo (igual que `users.id` y
  `users_company.id`). El ID del candidato en Hydra quedó como `hydra_candidato_externo_id`, para
  no confundirlo con el `hydra_candidato_id` de staging que usa `hydra_candidato_verificacion`.
- `hydra_candidato.users_company_existente_id` lleva FK a `users_company` (`ON DELETE SET NULL`).

**Reglas que agregó la implementación (no estaban en el plan)**

- **Grupos todo-o-nada.** `UserCompany` descarta en silencio una cuenta bancaria, una dirección o
  un contacto de emergencia incompletos (`guardarCuentaBancaria`, `guardarDireccion`,
  `guardarContactoEmergencia` hacen `return` si falta un campo). Ahora una de esas secciones a
  medias **no se puede verificar**: o se completa el bloque o se deja vacío.
- **Hash canónico.** Vacío → `null` y todo valor → texto recortado, para que `5` y `"5"` no
  invaliden una verificación sin que haya cambiado nada. Sí distingue `"0123"` de `"123"`.
- **Reenvío de Hydra con fusión a tres vías** (`fusionarReenvioHydra`): un campo toma el valor
  nuevo de Hydra solo si RRHH no lo había cambiado. Así queda resuelto el conflicto de §5.1.
- **Valores sin mapear**: bloquean la sección solo mientras el campo siga vacío. Si RRHH elige el
  valor a mano, deja de bloquear.
- **Cargo** de Hydra se intenta mapear a `contrato.cargo_id`. El **cliente** no se mapea, porque
  Gestor necesita una campaña y un cliente puede tener varias; RRHH la elige.
- **Tipo de dirección**: Hydra solo captura la dirección de residencia, así que se resuelve el
  catálogo `tipo_direccion` con el valor fijo `residencia`.

Los tres pendientes que dejó esta fase quedaron resueltos en la Fase 2 (§13.2).

### 13.2 Fase 2 (2026-10-01)

**Archivos**

| Archivo | Capa | Contenido |
|---|---|---|
| `config/integracionHydra.js` | config | Credenciales desde `.env`, ventana anti-replay (300 s), límites (200 candidatos, 1 MB) |
| `utils/firmaHydra.js` | transversal | `firmar`, `firmaValida`, `timestampVigente`; comparación en tiempo constante |
| `middleware/autenticarHydra.js` | ruta | API key + timestamp + HMAC + `Idempotency-Key` obligatoria en POST/PUT |
| `middleware/validarCuerpo.js` | ruta | Adaptador para validadores `(body, req) → errores[]` |
| `validators/integracionHydraSchemas.js` | ruta | Validación estructural del contrato (objetos anidados, arreglo de candidatos) |
| `routes/integracionHydra.js` | 1 | Cuerpo crudo → autenticar → parsear JSON → validar → controller |
| `controllers/contratacionHydra/integracionController.js` | 2 | Adaptador HTTP, sin `try/catch` |
| `services/contratacionHydra/recepcionService.js` | 3 | `recibirLote`, `actualizarCandidato`, `cancelarCandidato`, `consultarCandidato` |
| `services/contratacionHydra/evaluacionService.js` | 3 | `cargarResolver`, `evaluarCandidato` (también los usará la Fase 3) |
| `repositories/contratacionHydra/*.js` | 4 | lote, candidato, verificación, catálogo, empleado, petición entrante |
| `domain/contratacionHydra/resolverCatalogo.js` | dominio | Código de Hydra → ID de Gestor (mapeo explícito o coincidencia única) |
| `scripts/simularEnvioHydra.js` | script | Simula a Hydra con firma real: `lote`, `reenviar`, `cancelar`, `consultar` |
| `index.js` | — | Monta `/api/integraciones/hydra/v1` **antes** de `express.json()` |

`npm test`: 90 pruebas (26 nuevas en esta fase: resolutor, firma y validadores), todas pasan.

**Variables de entorno nuevas** (en `.env`, no se commitean):
`HYDRA_API_KEY`, `HYDRA_HMAC_SECRET` y opcionalmente `HYDRA_API_KEY_ANTERIOR`/
`HYDRA_HMAC_SECRET_ANTERIOR` para rotar sin cortar el servicio. Si faltan, los endpoints
responden 503 y el resto del sistema arranca normal. Generarlas con `openssl rand -hex 32`.

**Decisiones de implementación**

- **El cuerpo se lee crudo, se autentica y recién entonces se parsea.** Un cuerpo sin firma
  válida nunca llega a `JSON.parse`. El parser global de `index.js` no lo vuelve a leer, porque
  el stream ya quedó consumido (`body-parser` lo comprueba con `isFinished`).
- **Todos los rechazos de autenticación responden igual** (`401 FIRMA_INVALIDA`). El motivo real
  (clave, firma o timestamp) solo queda en el log del servidor, sin el cuerpo.
- **Idempotencia en la misma transacción que el trabajo.** La fila de `hydra_peticion_entrante` se
  confirma junto con los cambios, así que no puede quedar una sin la otra. Solo se guardan las
  respuestas exitosas, para que un error se pueda reintentar después de corregirlo.
- **Bloqueo en orden fijo: lote → candidato** (`SELECT … FOR UPDATE`), para evitar deadlocks entre
  peticiones concurrentes.
- **`sinMapear` no se guarda**: se recalcula re-mapeando `datos_hydra` con el resolutor vigente
  (`evaluacionService.evaluarCandidato`).
- **Resolución de catálogos** (`catalogoRepository` + `resolverCatalogo`): tipo de identificación
  por código o nombre; EPS y AFP contra `entidad_seguridad_social` filtrada por `tipo`; género,
  estado civil, grupo sanguíneo, parentesco, cargo y tipo de dirección contra sus tablas. Solo se
  asigna con **coincidencia única**: en Gestor existen "SURA" y "EPS Sura", y "COMPENSAR" y
  "Compensar EPS"; ante un empate el campo queda sin mapear y decide RRHH. Dos ajustes de
  normalización respecto a `importEmpleadosService.normalizar`: el grupo sanguíneo conserva el
  signo (la función original convierte `O+` y `O-` en el mismo valor) y en EPS se ignora la
  palabra "EPS".
- **Reenvío de un candidato `cancelado_hydra`** lo devuelve a `pendiente`. Uno `descartado` por
  RRHH recibe los datos nuevos pero sigue descartado.
- **Un candidato que llega en otro lote** distinto al suyo responde `en_otro_lote` y no se mueve.
- **Reintegro**: se busca la cédula en `users_company` (por número y, si se resolvió, también por
  tipo). Se vuelve a evaluar en cada reenvío.

**Prueba de punta a punta** (servidor local en `:5099` con credenciales temporales en el entorno
del proceso, sin tocar `.env`). Todo lo siguiente se comprobó contra la BD real:
lote nuevo → 201; mismo lote con otra clave → 200 `sin_cambios`; repetir la misma
`Idempotency-Key` → misma respuesta guardada; la misma clave con otro cuerpo → 422; API key mala,
otro secreto, timestamp de hace 10 min y cuerpo alterado después de firmar → 401; sin
`Idempotency-Key` → 400; JSON roto → 400; cuerpo > 1 MB → 413; PUT versión 2 actualiza el email
pero respeta el teléfono que había editado RRHH; misma versión → `sin_cambios`; id distinto al de
la URL → 400; candidato inexistente → 404; cancelar y consultar → `cancelado_hydra` sin datos
personales en la respuesta; reenviar un cancelado → `pendiente`; candidato en otro lote →
`en_otro_lote`; cédula `9000000001` del seed → `reintegro_detectado`. Con el payload de prueba
se resolvieron los 10 catálogos, incluido el cargo "Agente Call Center" → `cargo_id` 12. El log no
registró ningún 500.

Los datos de esa prueba quedaron en la BD local (lotes `SIM-FASE2-A/B/C/D`, candidatos de Hydra
901-903, 950 y 960) para usarlos en la Fase 3. Se borran con
`DELETE FROM hydra_candidato; DELETE FROM hydra_lote; DELETE FROM hydra_peticion_entrante;`
(con la 059 la verificación se borra en cascada).

### 13.3 Fase 3 (2026-10-01)

**Endpoints** (`/api/contratacion-hydra`, `verifyToken` + `isRecursosHumanos` → `recursosHumanos`/`admin`)

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/lotes?estado=` | Lotes con `total`, `pendientes`, `listos`, `registrados`, `fuera_del_lote` |
| `GET` | `/lotes/:id` | Lote + candidatos con las 7 secciones (`estado`: `completo`/`pendiente`/`desactualizada`) |
| `GET` | `/candidatos/:id` | Lo anterior + `datos_hydra`, `datos_empleado`, `sin_mapear` |
| `PUT` | `/candidatos/:id/secciones/:seccion` | Cuerpo con la forma anidada de `datos_empleado`; devuelve el candidato re-evaluado |
| `PUT` | `/candidatos/:id/secciones/:seccion/verificacion` | `{ verificado: true \| false }` |
| `POST` | `/candidatos/:id/descartar` | `{ motivo }` |
| `GET` | `/catalogos` | Opciones de Gestor por catálogo, para el selector de "valor sin mapear" |
| `GET` / `POST` | `/mapeos` | Listar / guardar `{ catalogo, valor_hydra, id_gestor }` |

**Archivos nuevos**: `routes/contratacionHydra.js`, `controllers/contratacionHydra/rrhhController.js`,
`services/contratacionHydra/rrhhService.js`, `services/contratacionHydra/transaccion.js`,
`validators/contratacionHydraSchemas.js`, `domain/contratacionHydra/edicionSeccion.js`,
`tests/contratacionHydra/edicionSeccion.test.js`. Se tocaron: `middleware/auth.js`
(`isRecursosHumanos`), `index.js` (montaje), los repositorios de lote, candidato, verificación y
catálogo, `mapearPayloadHydra.js` (`completarCatalogoDesdeHydra`) y `evaluacionService.js`, que
ahora tiene `recalcularEstadoLote` (antes estaba en `recepcionService`).

`npm test`: 98 pruebas, todas pasan.

**Decisiones de implementación**

- **Solo se escriben los campos de la sección.** `PUT …/secciones/salario` ignora cualquier otra
  clave del cuerpo. Una ruta ausente no se toca (actualización parcial); `''` o `null` la vacían.
- **Tipos validados al guardar, no al registrar.** Cada valor se normaliza al tipo que espera
  `UserCompany`: IDs (`"5"` → `5`), números ≥ 0, fechas reales `YYYY-MM-DD` y booleanos. El tipo se
  deduce de la convención de nombres del esquema (`*_id`, `fecha*`). Un error devuelve 400 con un
  mensaje por campo. Sin esto, un valor mal formado haría fallar recién la transacción de registro
  de todo el lote.
- **Estado visible por sección** (para los chips de la UI): `completo` (sin problemas y verificada
  con hash vigente), `desactualizada` (estaba verificada pero se editó después) y `pendiente`.
- **La verificación guarda quién y cuándo** (`verificado_por`, `verificado_en` en UTC).
- **Guardar un mapeo lo aplica en el acto** a los candidatos `pendiente`/`listo` de los lotes
  abiertos que tenían ese valor sin mapear. Solo completa los campos de ese catálogo que siguen
  vacíos y nunca pisa lo que RRHH eligió a mano. Bloquea los lotes en orden de id y después sus
  candidatos.
- **Pendiente para la Fase 4**: descartar todavía no avisa a Hydra (la fila `candidato_descartado`
  del outbox se agrega cuando exista el despachador) y los IDs elegidos no se validan contra el
  catálogo hasta la simulación del registro (`?simular=true`).

**Prueba de punta a punta** (servidor local en `:5099`, JWT firmado para el usuario local
`recursoshumanos`, id 28): 34 comprobaciones contra la BD real, todas en verde.
- **Acceso**: sin token → 401; rol `technician` → 403.
- **Consultas**: bandeja con conteos; filtro de estado inválido → 400; lote inexistente → 404; la
  sección "personal" sale completa solo con lo que envió Hydra.
- **Edición**: verificar "contrato" incompleto → 422; valores inválidos → 400 con un detalle por
  campo; sección inexistente → 400; guardar contrato completa la sección sin tocar otras ni perder
  el cargo y la fecha de ingreso que llegaron de Hydra; cuenta bancaria a medias → incompleta,
  vaciarla → completa de nuevo.
- **Verificación**: las 7 secciones verificadas → candidato `listo`; editar el salario →
  `desactualizada` y candidato `pendiente`; verificar de nuevo → `listo`; desmarcar → `pendiente`.
- **Descarte**: descartar al resto → lote `listo`; descartar sin motivo → 422; editar un
  descartado → 422.
- **Mapeos**: un parentesco "pareja" enviado por Hydra aparece en `sin_mapear` y bloquea la sección;
  un mapeo con id o catálogo inexistente → 422/400; guardar el mapeo a "Compañero(a)" llena el campo
  y desbloquea la sección. El mapeo de prueba se borró al terminar.

El log del servidor terminó limpio, sin ningún 500.

### 13.4 Fase 4 (2026-10-01)

**Endpoints nuevos** (en `/api/contratacion-hydra`, mismo control de acceso que §13.3)

| Método | Ruta | Uso |
|---|---|---|
| `POST` | `/lotes/:id/registrar?simular=true` | Hace todo el registro y al final ROLLBACK: lista de errores o "se registrarían N" |
| `POST` | `/lotes/:id/registrar` | Registro real, todo o nada |
| `GET` | `/envios?estado=pendiente\|enviado\|fallido` | Monitoreo del outbox (incluye `configurado`) |
| `POST` | `/envios/:id/reintentar` | Solo sobre un envío `fallido`; reinicia el contador |

**Archivos**: `services/contratacionHydra/{registroService,despachoService,clienteHydra}.js`,
`repositories/contratacionHydra/envioRepository.js`, `domain/contratacionHydra/outbox.js`,
`utils/validarEmpleado.js`, `scripts/despacharEnviosHydra.js` (`npm run despachar-hydra`),
`tests/contratacionHydra/outbox.test.js`. Se tocaron: `models/UserCompany.js`
(`create` → envoltorio de `crearEnConexion`), `controllers/userCompanyController.js` (importa
`validarObligatorios`), `config/integracionHydra.js` (canal de salida y política del outbox),
`rrhhService.descartarCandidato` (ahora encola el aviso), rutas, controller y validadores.

`npm test`: 106 pruebas, todas pasan.

**Variables de entorno nuevas** (canal Gestor → Hydra, distintas a las de entrada):
`HYDRA_CALLBACK_URL` (base de la API de Hydra, p. ej. `http://<host>:3000/api/integraciones/gestor/v1`),
`HYDRA_CALLBACK_API_KEY` y `HYDRA_CALLBACK_HMAC_SECRET`. Sin ellas, los avisos se acumulan como
`pendiente` y salen cuando se configuren.

**Decisiones de implementación**

- **La simulación hace los INSERT de verdad y revierte.** Es la única forma de detectar un ID de
  catálogo que no existe o una campaña borrada. La validación de tipos de la Fase 3 no lo atrapa:
  un candidato con `campania_id = 999999` quedó `listo`, y la simulación lo frenó.
- **Lista completa de errores.** Ante un problema se siguen recorriendo los demás candidatos (en
  InnoDB un error de sentencia solo revierte esa sentencia) para devolver todos los errores juntos,
  y después se revierte todo. Los errores de MySQL se traducen a mensajes que RRHH entiende (FK →
  "un valor elegido no existe en el catálogo de Gestor (columna)").
- **Antes de registrar se vuelve a validar todo**: completitud y hashes, `validarObligatorios`
  (la misma función del alta manual, ahora en `utils/validarEmpleado.js`) y que la cédula siga
  libre.
- **El alta usa el modelo existente** (`UserCompany.crearEnConexion`, envuelto por
  `empleadoRepository.crear`), así que un empleado que llega de Hydra queda idéntico a uno creado
  a mano o por Excel.
- **El aviso a Hydra se encola en la misma transacción** que el registro o el descarte.
- **Política de reintentos** (`domain/contratacionHydra/outbox.js`): 2xx → `enviado`; 409 →
  `enviado` (Hydra ya lo aplicó), salvo `PETICION_CONCURRENTE`; 5xx, 408, 429 o sin respuesta →
  reintento con espera de 1, 2, 4… minutos (tope 60); cualquier otro 4xx → `fallido` de inmediato
  (reintentar no arregla una firma o un payload malos); a los 10 intentos → `fallido`. Cada
  reintento reusa la **misma** `Idempotency-Key`.
- **Despachador**: una transacción por envío con `FOR UPDATE SKIP LOCKED`, para que dos corridas
  solapadas no tomen la misma fila (requiere MySQL 8+, ver Fase 9), y timeout de 10 s por llamada.

**Prueba de punta a punta**: servidor local en `:5099` y un **Hydra simulado** en `:5098` que
verifica la firma de cada aviso (el endpoint real de Hydra es la Fase 6; la prueba con las dos apps
de verdad es la Fase 8.5). 33 comprobaciones, todas en verde:
- **Todo o nada**: un lote con un candidato válido y otro con campaña inexistente → la simulación y
  el registro real devuelven 422 con el detalle del candidato malo, y no se crea **ni** el válido
  ni ningún aviso en el outbox.
- **Descarte**: descartar al malo encola `candidato_descartado`.
- **Simulación correcta**: devuelve 200 sin IDs, sin crear al empleado y sin marcar el lote.
- **Registro real**: crea el empleado con nombre, cédula, contrato, fecha de ingreso, salario
  vigente y la EPS que llegó de Hydra; el staging queda `registrado` y enlazado; el lote queda
  `registrado` con autor y fecha.
- **Repetición y concurrencia**: registrar dos veces → 422; dos registros simultáneos del mismo lote
  → exactamente uno gana y se crea un solo empleado.
- **Outbox**: Hydra con 500 → `pendiente`, 1 intento y próximo intento en el futuro; sin vencer la
  espera no se reintenta; Hydra de vuelta → todos `enviado`, con la misma `Idempotency-Key` del
  primer intento y los payloads correctos (`/contrataciones` con `users_company_id` y fecha de
  ingreso, `/descartes` con el motivo); Hydra con 422 → `fallido` al primer intento, visible en
  `GET /envios?estado=fallido`; "Reintentar" → `pendiente` y luego `enviado`; reintentar uno no
  fallido → 422; despachador sin configurar → no envía nada y lo informa.
- **Regresión**: el alta manual `POST /users-company` sigue funcionando y sigue rechazando un
  duplicado con el mismo mensaje.

Los empleados creados por la prueba se borraron al terminar con `UserCompany.delete`. Los lotes y
envíos de prueba siguen en las tablas `hydra_*` de la BD local.

### 13.5 Fases 5 y 6 — lado de Hydra (2026-10-01)

Repo: `C:\Users\juan.acosta\Desktop\ReclutamientoBackend\hidrabackend`. Se siguieron sus
convenciones: módulo con `routes/service/repository`, raíz de composición `container.js`, zod,
`HttpError`, `unidadDeTrabajo`, vitest y su runner de migraciones. Resumen también en
`claude/integracion-gestor.md` de ese repo.

**Archivos**

| Archivo | Contenido |
|---|---|
| `db/migrations/018_integracion_gestor.sql` | `contratacion_lotes`, `contratacion_candidatos`, `contratacion_envios` (outbox) y el permiso `enviar_contratacion` (administrador y selección). Aplicada en local con `npm run migrate` |
| `src/modules/contratacion/contratacion.reglas.js` | Puro: elegibilidad, payload, id del lote, política de reintentos, traducción de las respuestas de Gestor |
| `src/modules/contratacion/contratacion.repository.js` | Todo el SQL del módulo |
| `src/modules/contratacion/contratacion.service.js` | Envío de lotes, reenvío, cancelación, despachador y recepción de avisos |
| `src/modules/contratacion/contratacion.routes.js` | Rutas de Selección y de entrada desde Gestor |
| `src/modules/integraciones/gestor/index.js` | Adaptador HTTP (firma y envía; nunca lanza por un status) y adaptador en memoria para pruebas |
| `src/modules/integraciones/gestor/autenticarGestor.js` | API key + timestamp + HMAC para los avisos de Gestor |
| `src/shared/seguridad/firmaHmac.js` | Mismo algoritmo que `utils/firmaHydra.js` de Gestor |
| `src/config/env.js`, `.env.example` | `GESTOR_API_URL`, `GESTOR_API_KEY`, `GESTOR_HMAC_SECRET`, `GESTOR_CALLBACK_API_KEY`, `GESTOR_CALLBACK_HMAC_SECRET`, `GESTOR_DESPACHO_INTERVALO_MS` |
| `src/app.js` | `express.json` guarda el cuerpo crudo solo en `/api/integraciones/*` |
| `src/container.js`, `src/server.js` | Cableado; el despachador periódico arranca con el servidor y se detiene al apagar |
| `tests/unidad/contratacion.reglas.test.js`, `tests/integracion/contratacion.test.js` | 35 pruebas nuevas, todas en verde |

**Endpoints de Hydra**

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/contratacion/elegibles` | Aprobados finales no enviados, con `elegible` y `motivoNoElegible` |
| `POST` | `/api/contratacion/lotes` | `{ nombre, fechaIngresoSugerida?, candidatoIds[] }`: todo o nada |
| `GET` | `/api/contratacion/lotes` · `/lotes/:id` | Lotes con conteos; detalle con candidatos y envíos |
| `POST` | `/api/contratacion/candidatos/:id/reenviar` | Versión + 1 → `PUT` a Gestor |
| `POST` | `/api/contratacion/candidatos/:id/cancelar` | `{ motivo }` → Gestor lo pasa a `cancelado_hydra` |
| `POST` | `/api/contratacion/envios/:id/reintentar` | Solo sobre un envío `fallido` |
| `POST` | `/api/integraciones/gestor/v1/contrataciones` | Aviso de Gestor (firmado) → `contratado` |
| `POST` | `/api/integraciones/gestor/v1/descartes` | Aviso de Gestor (firmado) → nota |

Las rutas de `/api/contratacion` exigen el permiso `enviar_contratacion`.

**Decisiones de implementación**

- **Elegibilidad** (decisión abierta 1 de §11, con la recomendación): `aprobado_final` y, si es
  Agente, citado a formación; si es Staff, con la contratación registrada. Además, con número de
  documento y sin haber sido enviado antes. El lote es todo o nada: si algún candidato no cumple
  responde 409 `CANDIDATOS_NO_ELEGIBLES` con el motivo de cada uno.
- **Un candidato vive en un solo lote** (PK de `contratacion_candidatos`), igual que en Gestor. Para
  corregir datos o deshacer se usan "reenviar" y "cancelar" sobre su lote original.
- **Sin Gestor configurado no hay adaptador en memoria.** A diferencia de correo y FirmaCloud, un
  envío "exitoso" en memoria marcaría como entregado algo que nunca salió. Sin configuración, los
  envíos quedan `pendiente`. La memoria se inyecta solo en pruebas.
- **El payload se guarda en el outbox tal cual se envía**, así que un reintento manda los mismos
  datos con la misma `Idempotency-Key`. Gestor exige eso: misma clave con otro cuerpo → 422.
- **Despacho**: uno inmediato al encolar (fuera del request; Selección no espera a Gestor) y uno
  periódico cada `GESTOR_DESPACHO_INTERVALO_MS` (30 s por defecto). Usa `FOR UPDATE SKIP LOCKED`, así
  que no se pisa con varias instancias.
- **Política de reintentos**: igual a la de Gestor salvo en un punto. Aquí un 409 **no** es éxito:
  `LOTE_CERRADO` significa que el lote ya está cerrado en Gestor, y eso tiene que verse. Solo
  `PETICION_CONCURRENTE` se reintenta.
- **Respuesta de Gestor por candidato**: `creado`/`actualizado` → `recibido`;
  `reintegro_detectado` → `recibido` con la advertencia en `detalle`; `ya_registrado` →
  `registrado`; `en_otro_lote` → `error`. Un envío `fallido` deja a sus candidatos en `error` con
  el motivo, visible para Selección.
- **Aviso de contratación**: `aprobado_final → contratado` por `estadoServicio.cambiar` (la misma
  máquina de estados de siempre), con `usuario_id = NULL` y motivo
  `Registrado como empleado en Gestor Técnico (empleado #N, lote …)`. Es idempotente: si ya está
  contratado responde 200 sin duplicar el historial. Si el candidato ya no está aprobado (por
  ejemplo, `rechazado_final`), responde 422 `ESTADO_NO_PERMITE_CONTRATAR`, que el outbox de Gestor
  deja en `fallido` y visible.
- **Aviso de descarte**: solo nota (decisión abierta 3).

**Verificado**
- `vitest`: 35 pruebas nuevas en verde.
- Suite completa: 164 de 165. La que falla es `reportes.test.js › promedia la evaluación por
  criterio` y no tiene relación con estos cambios: la prueba promedia **toda** la base, y la base
  local tiene dos evaluaciones reales de septiembre (promedio de "saludo" 19), así que da 18,67 en
  vez de 18.
- `eslint` limpio en todos los archivos nuevos o modificados. Los 3 errores que reporta el lint
  completo están en archivos que no se tocaron (`candidato.service.js`, `formulario.service.js`,
  `trazabilidad.test.js`).
- Firma HMAC idéntica byte a byte entre `firmaHmac.js` (Hydra) y `firmaHydra.js` (Gestor), con
  tildes, cuerpo vacío y Buffer.

### 13.6 Prueba integrada en local, los dos backends reales (2026-10-01)

Hydra (`:3099`) y Gestor (`:5099`) corriendo a la vez, con las credenciales cruzadas como variables
de entorno del proceso (sin tocar ningún `.env`). 25 comprobaciones contra las dos bases reales,
todas en verde:

1. **Flujo completo** (17):
   - Selección crea un lote de 2 candidatos en Hydra, y el despacho inmediato lo entrega a Gestor
     sin intervención; en Hydra quedan `recibido`.
   - En Gestor los datos llegan traducidos (nombre, cédula, EPS "Sanitas EPS" → Sanitas, grupo
     `O-` → `O-`, fecha de ingreso sugerida). "pareja" queda sin mapear y bloquea la sección;
     "Sura EPS" queda como ambigua.
   - RRHH guarda el mapeo de "pareja", que completa al candidato solo. Completa contrato y salario,
     verifica las 7 secciones, descarta al segundo, simula y registra.
   - El despachador de Gestor entrega los dos avisos. En Hydra, el primero queda `registrado`, con
     el id de empleado de Gestor, y `contratado` en el embudo, con la traza en el historial. El
     segundo queda `descartado` con el motivo de RRHH, sin cambiar su estado en el embudo.
   - El empleado existe en `users_company` con el nombre, la cédula y el email que llegaron de
     Hydra.
2. **Gestor apagado** (2): Hydra acepta el lote igual (201) y el envío queda `pendiente` con
   `ECONNREFUSED`; el candidato sigue `en_cola`.
3. **Gestor de vuelta** (2): el despachador periódico de Hydra lo entrega solo, y llega **una sola
   vez**.
4. **Hydra apagado** (2): RRHH descarta igual y el aviso queda `pendiente` en Gestor.
5. **Hydra de vuelta** (2): el despachador de Gestor entrega el aviso y Hydra refleja `descartado`
   con el motivo.

Los logs de los dos servidores no registraron errores, solo la advertencia esperada de
`ECONNREFUSED` mientras Gestor estuvo apagado. Al terminar se borraron de las dos bases los
candidatos, lotes, envíos, el empleado y el mapeo de prueba.

**Pendiente de esta prueba**: repetirla por las pantallas cuando existan (Fases 7 y 8).

### 13.7 Fase 7 — pantallas de RRHH en Gestor (2026-10-01)

Repo: `C:\Users\juan.acosta\Desktop\FrontGestor\gestor-tecnico-frontend`, estilo "Opción C"
(`.ai-*` de `src/styles/asiste-ui/`).

**Archivos**

| Archivo | Contenido |
|---|---|
| `src/components/contratacionHydra/ContratacionHydra.jsx` | Bandeja con tres pestañas: lotes (filtros, barra de avance), avisos a Hydra (outbox, con "Reintentar" en los fallidos y aviso si el canal no está configurado) y equivalencias de catálogo |
| `src/components/contratacionHydra/LoteHydra.jsx` | Detalle del lote: resumen (candidatos, listos, pendientes, fuera), 7 puntos de estado por candidato, marca de reintegro y "Registrar lote" |
| `src/components/contratacionHydra/CandidatoHydraDrawer.jsx` | Panel lateral con las pestañas "Checklist" y "Datos de Hydra", aviso de reintegro y "Descartar" |
| `src/components/contratacionHydra/SeccionHydra.jsx` | Una sección: campos, valores sin mapear ("Usar y recordar"), sueldo de referencia, "Guardar" y el checkbox "Verificado" |
| `src/components/contratacionHydra/seccionesUI.js` | Campos de cada sección (mismas rutas que el backend) y helpers de borrador |
| `src/components/contratacionHydra/RegistrarLoteModal.jsx` | Simula primero; solo después deja confirmar. Muestra el detalle de cada error |
| `src/components/contratacionHydra/DescartarCandidatoModal.jsx` | Motivo obligatorio |
| `src/utils/catalogosRRHH.js` | Reglas puras copiadas de `AgentForm.jsx`: filtro Cliente → Campaña → Cargo, sueldo de referencia, jefes por campaña, tarifas ARL y fechas derivadas |
| `src/services/api.js` | `contratacionHydraService` |
| `src/components/RecursosHumanosLayout.jsx`, `src/App.jsx` | Ítem "Contratación Hydra" con contador de lotes abiertos y las rutas `/recursos-humanos/contratacion-hydra[/:id]` |

**Decisiones**

- **No se reutilizaron los bloques de `AgentForm.jsx`**, contra lo que decía el plan. Es un único
  componente de 60 KB con la lógica de catálogos dentro, y extraerlo implicaba reescribir un
  formulario sensible. Sus reglas se copiaron literalmente a `src/utils/catalogosRRHH.js`, y
  `AgentForm` quedó intacto. **Si cambia una regla en `AgentForm`, hay que cambiarla también
  ahí.** Pendiente: que `AgentForm` importe el mismo módulo.
- **Solo se muestran los campos que ya pide el alta manual**, respetando la regla de las dos hojas
  fuente de RRHH. Los demás campos del borrador se conservan sin pedirlos.
- **Igual que el alta manual**: los catálogos de un único valor (Empresa, Periodo de pago) se
  preseleccionan; el tipo de dirección es siempre "Residencia"; el fin del periodo de prueba se
  sugiere a 2 meses del ingreso y, en Aprendizaje, el fin de contrato a 6; "Fin de contrato" solo
  aparece si el contrato no es indefinido; las tallas solo aparecen si aplica dotación.
- **El checkbox se deshabilita** mientras haya cambios sin guardar (se verifica lo guardado, no el
  borrador) o datos pendientes. El tooltip explica por qué.
- **Los avisos de "obligatorio"** vienen de la última evaluación del servidor. Se ocultan en cuanto
  se edita el campo, para no dejar errores viejos debajo de un campo ya lleno (detectado durante la
  prueba).

**Prueba en el navegador** (Gestor en `:5099`, Vite en `:5174`; los servidores del usuario en
5001 y 5173 no se tocaron), con un lote de 3 candidatos enviado con firma real: uno limpio, uno con
"Sura EPS" ambigua y "pareja", y uno con la cédula de un empleado sembrado (reintegro).
- **Bandeja**: contador del menú, barras de avance y estados.
- **Detalle del lote**: "Registrar" deshabilitado al inicio y marca de reintegro.
- **Panel del candidato**: datos traducidos (incluido el grupo `O-`); se verifica "Datos
  personales" y queda el nombre de quien verificó.
- **Valores sin mapear**: "Sura EPS" se resuelve con "Usar y recordar" y la sección se desbloquea
  sola; "pareja" se resuelve eligiendo el parentesco directamente en el campo.
- **Contrato**: elegir Cliente reduce Campaña a 1 opción y Cargo a 9, conservando el cargo de
  Hydra; Empresa y Periodo de pago vienen preseleccionados; "Fin de contrato" aparece con "Obra o
  labor".
- **Salario**: muestra el sueldo de referencia ($1.750.905) para Cliente + Cargo.
- **Cuenta bancaria**: solo con el banco pide tipo y número y no deja verificar.
- **Dotación**: "Aplica" muestra las tallas con la camisa que envió Hydra.
- **Descarte**: el de reintegro se descarta con motivo.
- **Registro**: lote "Listo para registrar" → la simulación muestra los 2 que se registrarían → se
  registran los empleados #437 y #438 → el lote queda "Registrado" y el contador del menú baja.
- **Pestañas de la bandeja**: "Avisos a Hydra" muestra los 3 avisos pendientes; "Equivalencias"
  muestra "Sura EPS → SURA" con su autor.

La consola del navegador y el log del backend terminaron sin errores. Los datos de esta prueba
(lote, empleados, avisos y la equivalencia) se borraron al terminar. Un candidato se completó por
la API (los mismos endpoints de la pantalla) para no repetir clic por clic lo ya probado con el
otro.

### 13.8 Prueba en navegador de punta a punta, las dos apps (2026-10-01)

Cuatro servidores en local (Hydra `:3099` + su frontend `:5175`, Gestor `:5099` + su frontend
`:5174`), con login real en las dos apps con usuarios temporales (un administrador en Hydra y uno
`recursosHumanos` en Gestor):

1. **Hydra (pantallas)**: "Nuevo candidato" (Obamacare / Agente Call Center, citado) → "Asistencia"
   → "Evaluar" (86/100) → "Decidir" (aprobar) → "Citar a formación".
2. **Hydra → Gestor**: el único paso que **no** fue por pantalla, porque el botón es la Fase 8. Se
   hicieron desde la misma sesión las dos llamadas que hará ese botón (`GET /contratacion/elegibles`
   → elegible; `POST /contratacion/lotes`). El despacho inmediato de Hydra entregó el lote en el
   primer intento.
3. **Gestor (pantallas)**: el lote aparece en la bandeja con el id de Hydra. RRHH completa las 7
   secciones (con los filtros Cliente → Campaña → Cargo y el sueldo de referencia), simula y
   registra al empleado #441, que queda **Activo** en "Personal de la empresa".
4. **Gestor → Hydra**: el despachador de Gestor (cron en producción, aquí a mano) entrega el aviso
   en el primer intento.
5. **Hydra (pantallas)**: la candidata pasa a **Contratado**; el historial muestra la transición con
   el motivo "Registrado como empleado en Gestor Técnico (empleado #441, lote HYD-…)" y el embudo
   del Dashboard pasa de 0 a 1 contratado.

Consolas de las dos apps y logs de los dos backends sin errores. Todo lo creado (candidata,
lotes, empleado, avisos y usuarios temporales) se borró al terminar.

**Hallazgo para la Fase 8**: el historial de Hydra muestra como autor de la transición a
`contratado` a **"el candidato"**, porque la pantalla etiqueta así cualquier cambio con
`usuario_id = NULL`, pensando en el formulario público. Debería decir algo como "Gestor Técnico
(automático)". Es solo de presentación (`Historial.jsx` del frontend de Hydra).

### 13.9 Fase 8 — pantalla "Contratación" en Hydra + prueba desde las pantallas (2026-10-01)

Repo: `C:\Users\juan.acosta\Desktop\ReclutamientoFronted\hidrafrontend`, con los componentes de Hydra
(`Layout`, `Tabla`, `Filtros`, `Modal`, `useRecurso`).

| Archivo | Contenido |
|---|---|
| `src/components/contratacion/Contratacion.jsx` | Pestaña "Por enviar": elegibles con casilla, y los no elegibles con el motivo; botón "Enviar a contratación" → modal (nombre del lote, fecha de ingreso sugerida). Pestaña "Lotes enviados": avance de contratados y resumen por estado |
| `src/components/contratacion/LoteContratacion.jsx` | Detalle del lote: estado de cada candidato en Gestor y en Hydra, n.º de empleado, motivo de descarte o error; "Reenviar datos", "Cancelar" (con motivo) y "Reintentar" para envíos fallidos. Se actualiza sola cada 5 s mientras hay algo en camino |
| `src/App.jsx`, `src/components/layout/menu.js` | Rutas `/seleccion/contratacion[/:loteId]` y entrada "Contratación" en el menú, con el permiso `enviar_contratacion` |
| `src/components/candidatos/perfil/Historial.jsx` | El paso a `contratado` sin usuario se muestra como "Gestor Técnico (automático)" en vez de "el candidato" |

`vite build` compila y `eslint` queda limpio en los archivos tocados.

**Prueba desde las pantallas, las dos apps** (mismos cuatro servidores locales de §13.8; los
candidatos llegaron aprobados y citados a formación mediante un script, porque ese recorrido de
Selección ya se probó por pantalla en §13.8):
- **Hydra · Contratación**: lista a los 2 elegibles junto a los no elegibles con su motivo
  ("Es Agente y no tiene registrada la citación a formación"). Se seleccionan, "Enviar a
  contratación", nombre y fecha → la pantalla del lote muestra "En cola de envío" y, sin tocar
  nada, pasa a "En RRHH" / "Entregado (1 intento)".
- **Hydra · Cancelar** a uno con motivo → "Cancelado" y la cancelación "Entregado". En Gestor ese
  candidato aparece "Cancelado en Hydra" y fuera del lote.
- **Gestor**: el otro llegó con los datos del formulario traducidos (Femenino, Soltero(a), B+,
  fecha de nacimiento, EPS). RRHH completa contrato y salario, verifica las 7 secciones, simula y
  registra (empleado #444).
- **Despachador de Gestor** → aviso entregado → en Hydra el lote muestra "Contratado · Empleado
  #444", estado en Hydra "contratado" y sin acciones; el historial dice "Gestor Técnico
  (automático)"; "Por enviar" ya no lista a los enviados y "Lotes enviados" muestra "1/1 · 1
  contratado · 1 fuera".

Consolas de las dos apps sin errores. El log de Hydra solo tiene 2 avisos (no errores) previos al
flujo: el navegador traía la sesión de un usuario temporal de la prueba anterior, ya borrado, y el
backend la rechazó como debía. Todo lo creado se borró al terminar.

**Verificado además**: `vite build` compila. El linter marca `'Icon'/'Icono' is defined but never
used` en componentes renombrados que solo se usan en JSX; es un falso positivo de la configuración
de ESLint del repo, que también aparece en archivos no tocados como `AsistenciaLayout.jsx`.

---

## 14. Guía de despliegue (Fase 9)

Preparada el 2026-10-01; **todavía no ejecutada**. Los pasos en los servidores los corre quien
tenga acceso (SSH root y Workbench), en este orden. Cada bloque dice cómo comprobar que quedó bien
antes de pasar al siguiente.

### 14.1 Lo que se sabe de cada servidor

| | Gestor | Hydra |
|---|---|---|
| Servidor | `srv845606` | `200.91.204.54` (tarjeta privada `ens18`, red `10.255.255.0/24`) |
| Backend | `/root/gestor-tecnico-backend`, pm2 `gestor-backend`, puerto 5001 | pm2 `hidra-backend`, puerto 3000 **expuesto directo** (ufw `3000 ALLOW Anywhere`, sin nginx delante) |
| Frontend | `/var/www/gestor-tecnico-frontend`, nginx sirve `dist/` | nginx en el puerto 80 |
| Migraciones | a mano (Workbench), sin registro | `npm run migrate` (registra en `migraciones_aplicadas`) |

**Por confirmar antes de empezar** (no está en ningún documento):
1. La IP privada de cada servidor y que se ven entre sí por ella (ver 14.4).
2. Si el backend de Gestor se alcanza por nginx o directo al 5001 desde la red interna.
3. La carpeta y el modo de despliegue del frontend de Hydra.

### 14.2 Antes de tocar producción (local)

- [ ] Commit en los 4 repos. **No** incluir `node_modules/` (en Gestor aparece modificado por
      `npm install` en Windows; está versionado por error y no se toca en este cambio) ni
      `restructuracion.md`/`claude/context.md` de Hydra, que tienen cambios ajenos a esta conexión.
- [ ] Llevar a `main` (PR) los dos repos de Gestor (rama `sebas-branch`) y el frontend de Hydra;
      el backend de Hydra ya trabaja sobre `main`.
- [ ] En cada servidor, `git log --oneline -5` y `git status` **antes** del pull: producción ha
      tenido commits que no están en ningún repo (ver la nota sobre los repos de David Zarate en
      `claude/contextoriginal.md`).

### 14.3 Base de datos

- [ ] `SELECT VERSION();` en las **dos** bases. Las dos usan `FOR UPDATE SKIP LOCKED` en el
      despachador: hace falta MySQL 8.0+ (o MariaDB 10.6+).
- [ ] **Gestor**: correr en Workbench `059`, `060` y `061`, en ese orden. Son solo `CREATE TABLE`
      sin IDs quemados: no dependen de 049/054/057, que siguen pendientes. No tocan tablas
      existentes.
- [ ] **Hydra**: en el servidor, `npm run migrate:estado` **antes** de migrar. Si aparecen
      pendientes además de la `018` (el contexto de Hydra dice que 009-011 estaban solo en local
      al 2026-08-21), `npm run migrate` las corre todas: revisar cada una antes y decidir si se
      despliegan juntas o primero las otras.

### 14.4 Red y credenciales

Generar **cuatro valores distintos** en cualquiera de los servidores con `openssl rand -hex 32`, y
pasarlos por un canal privado, nunca por el repo ni por chat:

| Valor | `.env` de Gestor | `.env` de Hydra |
|---|---|---|
| A: clave Hydra → Gestor | `HYDRA_API_KEY` | `GESTOR_API_KEY` |
| B: secreto Hydra → Gestor | `HYDRA_HMAC_SECRET` | `GESTOR_HMAC_SECRET` |
| C: clave Gestor → Hydra | `HYDRA_CALLBACK_API_KEY` | `GESTOR_CALLBACK_API_KEY` |
| D: secreto Gestor → Hydra | `HYDRA_CALLBACK_HMAC_SECRET` | `GESTOR_CALLBACK_HMAC_SECRET` |
| URL | `HYDRA_CALLBACK_URL=http://<ip-privada-hydra>:3000/api/integraciones/gestor/v1` | `GESTOR_API_URL=http://<ip-privada-gestor>:5001/api/integraciones/hydra/v1` |
| | | `GESTOR_DESPACHO_INTERVALO_MS=30000` |

- [ ] Desde `srv845606`: `curl -s http://<ip-privada-hydra>:3000/api/health` responde
      `{"ok":true,…}`.
- [ ] Desde Hydra: `curl -s -o /dev/null -w '%{http_code}\n'
      http://<ip-privada-gestor>:5001/api/integraciones/hydra/v1/candidatos/1` responde `401`
      (o `503` si el `.env` de Gestor aún no tiene las claves); eso prueba que la ruta se alcanza.
- [ ] Usar **siempre las IPs privadas** en las dos URL, para que el tráfico no salga a internet
      (decisión de §3).

**Lista blanca de IPs.** En Gestor, si la integración pasa por nginx, se limita con un `location`
propio:

```nginx
location /api/integraciones/hydra/ {
    allow <ip-privada-hydra>;
    deny all;
    proxy_pass http://127.0.0.1:5001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

En Hydra **no se puede hacer igual**: el 3000 está abierto a internet sin nginx, así que
`/api/integraciones/gestor/v1` es alcanzable desde fuera. Lo protegen la clave, la firma HMAC y la
ventana de 5 minutos, que es suficiente por sí sola. Si se quiere además limitar por IP, hay dos
caminos, y los dos quedan fuera de este despliegue:
- Una lista de IPs permitidas dentro de la app (`GESTOR_IPS_PERMITIDAS`).
- Poner nginx delante del 3000 (ufw solo filtra por puerto, no por ruta).

### 14.5 Activar

1. **Gestor backend**:
   1. Hacer `git pull`, `npm install` y agregar al `.env` las 5 variables de 14.4.
   2. `pm2 restart gestor-backend`.
   3. Cron:
      ```
      * * * * * cd /root/gestor-tecnico-backend && node scripts/despacharEnviosHydra.js >> logs/hydra-envios.log 2>&1
      ```
      Crear antes la carpeta `logs/` si no existe.
2. **Hydra backend**:
   1. Hacer `git pull`, `npm install`, la migración de 14.3 y agregar al `.env` las 6 variables.
   2. `pm2 restart hidra-backend`. El despachador de Hydra corre dentro del proceso, no lleva
      cron.
3. **Verificar desde Gestor**:
   ```
   npm run verificar-hydra -- --gestor-url http://127.0.0.1:5001/api/integraciones/hydra/v1
   ```
   Tiene que terminar en "Todo listo".
   - El script no escribe nada: revisa versión, tablas, credenciales, la salud de Hydra, y que
     cada lado acepte la firma del otro.
   - `HTTP 401` en una línea quiere decir que ese par de valores no coincide entre los dos `.env`.
4. **Gestor frontend**: `git pull && npm install && npm run build`, y después
   `nginx -t && systemctl reload nginx`. **Sin excepción**: un pull sin build sirve la versión
   vieja.
5. **Hydra frontend**: hacer el pull y el build según su despliegue (por confirmar, 14.1).

### 14.6 Prueba con un candidato

Antes del primer lote real, un lote de **un** candidato de prueba con cédula ficticia. Para no
crear un empleado falso en producción, la prueba termina en **descarte**, no en registro:

1. En Hydra, un candidato de prueba en `aprobado_final`, citado a formación → "Enviar a
   contratación". El lote pasa a "En RRHH".
2. En Gestor, el lote aparece en "Contratación Hydra" con los datos traducidos.
3. RRHH lo **descarta** con motivo "Prueba de conexión". En menos de un minuto (cron), la pestaña
   "Avisos a Hydra" lo muestra entregado y Hydra muestra el descarte en el lote.
4. Borrar el candidato de prueba en Hydra.

Así se prueban los dos sentidos. El camino del registro ya se probó en local (§13.6, §13.9) y lo
estrena el primer lote real, con su simulación previa.

### 14.7 Cómo apagarla

Basta con quitar las variables `HYDRA_*` del `.env` de Gestor y reiniciar pm2:
- Los endpoints de integración responden `503` y los envíos de Hydra quedan en su cola,
  reintentando.
- Los avisos de Gestor se acumulan en `hydra_envio_saliente`.
- No se pierde nada, y al volver a poner las variables todo sigue donde quedó.

Las tablas nuevas no afectan al resto de RRHH. Si alguna vez hay que retirarlas, se hace con
`DROP` en orden inverso (061 → 059).

### 14.8 Estado del despliegue (2026-10-11)

- **Hydra: desplegado.**
  - Backend con las migraciones 018/019 y las 6 variables `GESTOR_*` apuntando a
    `http://31.97.138.23:5001/api/integraciones/hydra/v1`.
  - Frontend reconstruido.
  - Commits: backend `main` 4706ce0, frontend `sebas-branch` c5fbef5.
- **Gestor:**
  - Se hizo pull del código (b4d5de8) en `srv845606` y se agregaron las 5 variables `HYDRA_*` al `.env`.
  - Las migraciones 059-061 se entregaron unidas en `migrations/ultimos_cambios.sql` (no commiteado;
    se puede repetir). **Falta confirmar** que se corrieron, que se agregó el cron de
    `despacharEnviosHydra.js`, que `npm run verificar-hydra` terminó en "Todo listo" y que se hizo la
    prueba de §14.6.
- **Tropiezos:**
  - Una `GESTOR_*` vacía impide arrancar Hydra.
  - Un `umask 077` dejó el `dist` de Hydra ilegible para nginx (403); se arregló con
    `chmod -R a+rX dist`.
- **El tráfico va por HTTP a la IP pública de Gestor.** HTTPS sigue pendiente (§12).

## 15. Documentos de contratación (Hydra 021 · Gestor 087, 2026-10-30)

Al enviar a contratación, Hydra manda además de los datos del candidato:

- **Hoja de vida firmada y tratamiento de datos firmado** (FirmaCloud). Son **obligatorios**: Hydra
  no deja enviar a quien no los firmó. Basta la firma del candidato (`status === 'signed'`); la
  segunda firma de Selección no se exige.
- **Soportes de antecedentes** que tenga cargados (ADRES, Policía, Comparendos, Procuraduría),
  cada uno por separado.
- Si le falta algún antecedente, Contratación **tiene que escribir una nota para RRHH** al enviar
  (solo a esos candidatos; si están todos, no se pide nada).

### 15.1 Hydra (migración 021)

- `motivoNoElegible` exige la firma. El estado se consulta a FirmaCloud al listar (de a 4 en
  paralelo) solo para quien le falta únicamente eso, y `signed` se guarda en
  `candidato_firmas.estado` para no volver a consultar. Si FirmaCloud no responde, el motivo es
  "No se pudo confirmar la firma en FirmaCloud".
- `POST /contratacion/lotes` acepta `notasAntecedentes: { "<candidatoId>": "nota" }` (máx. 500).
  Sin nota para quien le falta un antecedente → 409 `CANDIDATOS_NO_ELEGIBLES`. La nota queda en
  `contratacion_candidatos.nota_antecedentes`.
- El payload del candidato (lote y reenvío) trae el bloque nuevo:
  `documentos: { firmados: [...], antecedentes_faltantes: [nombres], nota_antecedentes }`.
- Cada documento es **un envío del outbox** (`contratacion_envios.tipo = 'documento'`,
  `PUT /candidatos/:id/documentos/:tipo`) que sale **solo cuando el envío del lote ya está
  `enviado`** (si no, Gestor respondería 404). El cuerpo se arma al despachar (no se guarda el
  base64 en el outbox).
- Los firmados se descargan de FirmaCloud la primera vez y se guarda una copia en
  `candidato_documentos` (tipos `hoja_vida_firmada`, `tratamiento_datos_firmado`,
  `uploads/firmados/`): un reintento manda exactamente los mismos bytes y la misma
  Idempotency-Key no choca.
- "Reenviar datos" vuelve a encolar los documentos; Gestor responde `sin_cambios` si el hash es
  el mismo. Un archivo que ya no existe en Hydra deja ese envío `fallido` sin tocar al candidato.

### 15.2 Gestor (migración 087)

- `PUT /api/integraciones/hydra/v1/candidatos/:hydraCandidatoId/documentos/:tipo`, firmado con
  HMAC e idempotente como el resto. Cuerpo JSON:
  `{ tipo, nombre, nombre_archivo, mime_type, sha256, contenido_base64 }`. Límite propio de
  **15 MB** de cuerpo (10 MB de archivo; el resto sigue en 1 MB) → 413 `DOCUMENTO_DEMASIADO_GRANDE`.
- Se comprueba el SHA-256 y que el contenido corresponda al mime (PDF/JPG/PNG por firma de
  archivo). Responde 201 `creado`, 200 `reemplazado` o 200 `sin_cambios`; 404 si Gestor no tiene
  el candidato. Se acepta en cualquier estado, también ya registrado.
- Tabla `hydra_candidato_documento` (uno por candidato y tipo, cascada con el candidato);
  archivos en `storage/contratacion-hydra/` (privado, no `uploads/`). El archivo reemplazado se
  borra después del commit.
- RRHH: pestaña **Documentos** en el panel del candidato (`GET /api/contratacion-hydra/candidatos/:id`
  trae `documentos`; descarga en `.../candidatos/:id/documentos/:documentoId/archivo`), con aviso
  de firmados que no han llegado y de antecedentes faltantes con la nota. En la ficha del empleado
  (`EmpleadoDrawer`) aparece la pestaña **Documentos** si llegó de Hydra
  (`GET /api/contratacion-hydra/empleados/:usersCompanyId/documentos` y su `/archivo`). Ambas
  rutas son de `isRecursosHumanos`; para otros roles la pestaña no aparece.
- **Registrar el lote exige los dos firmados** cuando el candidato trae el bloque `documentos`
  (los enviados antes de esta integración no lo traen y no se les exige).

### 15.3 Despliegue

1. **Gestor primero**: migración 087 + código backend y frontend. Hasta entonces Gestor ignora el
   bloque `documentos` (campos desconocidos) y respondería 404 a los PUT de documentos.
2. **Después Hydra**: migración 021 + código. Sin Gestor actualizado, los envíos `documento`
   quedan fallidos y habría que reintentarlos.
3. Hydra necesita FirmaCloud alcanzable para que un candidato sea elegible.
4. En el server de Gestor, `storage/` ya está en `.gitignore`; la carpeta se crea sola al arrancar.

Probado en local (2026-10-30): pruebas de Hydra (unidad 39, integración de contratación 30) y
`npm test` de Gestor (255), más un envío real Hydra → Gestor con el cliente HTTP de Hydra contra
un Gestor local en otro puerto: lote, documento creado/reintento idempotente/`sin_cambios`/
reemplazo, hash alterado y HTML disfrazado de PDF (400), PNG y PDF de 9 MB (201), 12 MB (413),
candidato inexistente (404), y los endpoints de RRHH (detalle, descarga, 404 de otro candidato,
401 sin token). **No se probó en local** el bloqueo del registro por firmados faltantes (el
candidato de prueba tenía secciones pendientes, que se validan antes).

## 16. Exámenes médicos y rol SST (Gestor 089 · Hydra 022, 2026-10-30)

Control final antes del registro: **SST** marca si el candidato asistió a los exámenes médicos y si
los aprobó. RRHH sigue completando y verificando las 7 secciones, pero **solo registra a los que SST
aprobó**. Cada marca se le informa a selección (Hydra).

### 16.1 Reglas

- Columna `hydra_candidato.examen_estado`, aparte del estado del candidato:
  `pendiente → asistio → aprobado | no_aprobado`, y `pendiente → no_asistio`. Desde `no_asistio`
  (o `reagendado`) SST puede volver a marcar asistencia: la cita se reagendó. **Nada se borra**:
  cada marca es una fila de `hydra_candidato_examen` (`evento`, `nota`, `origen` gestor/hydra,
  quién y cuándo). Reglas en `domain/contratacionHydra/examenes.js`.
- **No asistió**: nota opcional. Selección decide en Hydra (pantalla *Exámenes médicos*):
  - "Dar continuidad" deja el examen `reagendado`;
  - "No continuar" pasa el candidato a `cancelado_hydra`.
  
  La decisión llega a `POST /api/integraciones/hydra/v1/candidatos/:id/examenes/continuidad`. Si ya no hay una inasistencia pendiente (SST volvió a marcar), responde 409
  `SIN_DECISION_PENDIENTE`.
- **No aprobó**: nota **obligatoria**. El candidato pasa al estado terminal nuevo **`no_apto`** (fuera
  del lote, como descartado). En Hydra queda `no_apto_examenes` con la nota en el historial.
- **Aprobado es final.** El candidato solo queda `listo` con las 7 secciones verificadas **y** el
  examen `aprobado`; `registrarLote` lo vuelve a exigir.
- Cada marca de SST encola un envío `candidato_examen` al outbox (`POST {HYDRA_CALLBACK_URL}/examenes`).

### 16.2 Rol `sst`

- Hay que aplicar la migración 089, que agrega el valor al ENUM, igual que la 072. El rol está dado de alta en los 5 lugares, incluido
  `ROLES_VINCULADOS_A_EMPLEADO`, y no lleva sede: hay que crearlo desde `/users` y elegir la ficha.
- Permisos (`routes/contratacionHydra.js`):
  - `isRecursosHumanosOSst`: listar lotes, el detalle del lote y del candidato, catálogos de mapeo y documentos del candidato;
  - `isSst` (sst, financiera, admin): `POST /candidatos/:id/examenes`;
  - todo lo demás sigue siendo de RRHH.
  
  SST también marca su propia asistencia (`canRegistrarAsistencia`).
- Frontend:
  - SST usa `RecursosHumanosLayout` con dos entradas: Contratación Hydra y Mi asistencia;
  - entra directo a `/recursos-humanos/contratacion-hydra`;
  - en el panel del candidato solo ve las pestañas *Exámenes médicos*, Documentos y Datos de Hydra, sin checklist ni descartar;
  - RRHH ve la misma pestaña de exámenes, pero solo para consultar.

### 16.3 Despliegue

1. **Migraciones primero**:
   - en Gestor, la **089**. No es idempotente. Pasa los candidatos `listo` a `pendiente` y los lotes `listo` a `abierto`, porque a los que están en curso ahora les falta la aprobación de SST;
   - en Hydra, la **022**.
2. **Después los códigos**:
   - backend y frontend de Gestor;
   - backend y frontend de Hydra.
   
   Si Hydra no tiene la 022, los avisos `/examenes` de Gestor fallan. Si Gestor no tiene la 089, la decisión de selección falla. En ambos casos el envío queda en el outbox para reintentarlo.
3. Crear el usuario SST desde `/users`, con rol SST, y vincularle su ficha.

### 16.4 Probado en local (2026-10-30)

- `npm test` de Gestor: 267 pruebas. En Hydra: unidad, más integración de contratación con 7 casos de exámenes; 82 en total.
- **De punta a punta, con los dos backends**:
  - **Candidato 25**:
    1. SST no pudo marcar "aprobó" antes de registrar la asistencia (422).
    2. "No aprobó" sin nota dio 422.
    3. Con nota, el candidato quedó `no_apto` en Gestor y `no_apto_examenes` en Hydra, con la nota en el historial.
    4. No admite más marcas.
  - **Candidato 24, en el navegador**:
    1. SST marcó "no asistió" con nota.
    2. Selección vio "Espera tu decisión" y dio continuidad con nota.
    3. Gestor recibió el reagendado.
    4. SST marcó "asistió" y luego "aprobó".
    5. La traza muestra las 4 marcas en las dos apps.
  - **Rol SST**:
    - recibe 403 en registrar, envíos y catálogos de RRHH;
    - en la pantalla, menú de dos entradas, sin "Registrar lote" ni checklist.
  - **Hydra**: reenviar y cancelar un candidato cerrado por exámenes dan 409.
- Usuario local de prueba: `prueba.sst`, con la clave del seed.

### 16.5 Qué es cada pestaña de "Contratación Hydra" en Gestor

La pantalla `/recursos-humanos/contratacion-hydra` tiene tres pestañas. SST solo ve la primera.

| Pestaña | Para qué sirve | Quién |
|---|---|---|
| **Lotes recibidos** | Lo que envía Hydra. Cada lote muestra su avance, los exámenes médicos por resolver y su estado. Al abrir uno se ven sus candidatos. En cada candidato hay un panel con: <br>• **Checklist**: las 7 secciones que RRHH completa y verifica; <br>• **Exámenes médicos**: lo que marca SST, con su traza; <br>• **Documentos**: firmados y antecedentes (087); <br>• **Datos de Hydra**: lo que llegó tal cual. | RRHH (completa, descarta y registra) y SST (solo exámenes) |
| **Avisos a Hydra** | Bandeja de salida (outbox `hydra_envio_saliente`): cada mensaje que Gestor le manda a Hydra. <br>• **Registrado**: en Hydra pasa a `contratado`. <br>• **Descartado**: incluye el motivo. <br>• **Examen** (089): cada marca de SST. <br>Cada aviso muestra su estado (pendiente, enviado o fallido), los intentos y el último error. Un fallido se puede **reintentar** desde ahí. Por ejemplo, queda fallido si Hydra estaba caído o no tenía la 022. Sirve para confirmar que Hydra se enteró. Los manda el cron `scripts/despacharEnviosHydra.js`. | RRHH |
| **Equivalencias de catálogo** | Tabla `hydra_mapeo_catalogo`. Hydra envía sus catálogos por **código y nombre propios**: EPS, AFP, cesantías, caja, ARL, cargo, ciudad, parentesco… Cuando un valor no existe en Gestor o coincide con más de uno, el campo del candidato queda **"sin mapear"**. Por ejemplo, "Sura EPS" frente a "SURA" y "EPS Sura". RRHH elige a cuál corresponde y la elección se guarda como equivalencia. Desde ese momento Gestor traduce ese valor solo. Además, guardar una equivalencia la aplica en el acto a los candidatos pendientes o listos (ver §13). Normalmente se crean desde el panel del candidato; la pestaña sirve para revisarlas, corregirlas o crearlas por adelantado. **"Sin equivalencias" es normal** mientras no haya llegado un valor que no se resuelva solo. | RRHH |

### 16.6 Despliegue en producción (2026-10-30)

**Gestor:**
- **Migraciones**: se entregaron en `Descargas/` la 087, la 088 y la 089.
- **Código**:
  - backend: `af6d60c` (087), `b0afc40`, `7f47d95` y `bb773eb`, en `sebas-branch`;
  - frontend: `b0c377e` y `e8fdf62`;
  - el merge lo hace el usuario.
- **La 089 se cortó a la mitad.** En Workbench paró con el **error 1175** (modo de actualización segura) en el primer `UPDATE`. Para entonces ya se habían aplicado los dos `ALTER`: el rol `sst` y la columna `examen_estado`.
- **Arreglo de la 089**: el resto se entregó aparte en `Descargas/089b_sst_examenes_medicos_resto.sql`:
  - con `SET SQL_SAFE_UPDATES = 0/1` alrededor de los `UPDATE`;
  - después, la tabla de traza y el ENUM de `hydra_envio_saliente`.

  La 089 del repo ya trae ese `SET` (`bb773eb`). **No correr la 089 completa otra vez**: el `ADD COLUMN` da el error 1060.
- **Falta confirmar**:
  - que la 089b terminó bien;
  - que la 087 y la 088 se corrieron;
  - el despliegue del código;
  - `client_max_body_size 50m` en nginx (088).

**Hydra:**
- **Código**: backend `966696f` (021) y `7682426` (022); frontend `3ce13e3` y `1e0429f`, en `sebas-branch`.
- **Migraciones**: la 021 y la 022 se entregaron en `Descargas/`.
- **Primer intento fallido**: la 022 se corrió en Workbench contra la base del **Gestor** (`call_center_support`) y dio `Table 'call_center_support.estados_candidato' doesn't exist`. No aplicó nada: la primera sentencia es ese `INSERT`, y ninguna tabla de la 021 ni de la 022 existe en Gestor (se comprobó).
- **Las migraciones de Hydra van en la base de Hydra** (`DB_NAME` del `.env` de Hydra; en local es `ReclutamientoNuevo`), en su propio servidor:
  - con `npm run migrate` después de `npm run migrate:estado`;
  - o a mano, comprobando antes `SELECT DATABASE()` y que exista `estados_candidato`.

  Si se aplican a mano, hay que registrarlas en `migraciones_aplicadas`.
- **Pendiente**: aplicar la 021, si producción no la tiene, y la 022 en la base correcta. Después: deploy, crear el usuario SST en Gestor, `npm run verificar-hydra` y la prueba con un candidato.
- **Permiso `decidir_continuidad_examenes`**: quedó para Administrador, Selección y Contratación. Falta que el usuario decida si se le quita a Contratación (sería un `DELETE` en `rol_permisos`). El requerimiento dice que "selección determina".
