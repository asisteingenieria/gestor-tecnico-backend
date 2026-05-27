# Contexto del Proyecto: Gestor Técnico Backend

## Descripción General

Sistema de gestión de soporte técnico para un call center. Permite administrar incidentes, estaciones de trabajo, inventario de activos tecnológicos, usuarios con control de acceso por roles, mensajería privada en tiempo real y analíticas avanzadas.

**Stack:** Node.js + Express.js + MySQL + Socket.IO  
**Puerto:** 5001  
**Base de datos:** `call_center_support`


---

## Arquitectura del Proyecto

```
gestor-tecnico-backend/
├── config/
│   └── db.js                         # Pool de conexiones MySQL (máx. 10)
├── controllers/                      # Lógica de negocio
│   ├── activoController.js
│   ├── activoTecnicoController.js
│   ├── agenteController.js
│   ├── analyticsController.js
│   ├── authController.js
│   ├── autoActivoController.js
│   ├── chatController.js
│   ├── disenoController.js
│   ├── incidentController.js
│   ├── inventarioDirectivoController.js
│   ├── scriptParserController.js
│   ├── userController.js
│   └── workstationController.js
├── middleware/
│   ├── auth.js                       # JWT + RBAC
│   ├── upload.js                     # Multer para incidentes
│   ├── uploadActivos.js              # Multer para activos
│   ├── uploadDisenos.js              # Multer para imágenes de diseños (max 20MB, 60 archivos)
│   └── uploadEntregas.js             # Multer para entregas de diseños (max 100MB, 10 archivos)
├── models/                           # Acceso a datos
│   ├── Activo.js
│   ├── ActivoHistorial.js
│   ├── Agente.js
│   ├── Diseno.js
│   ├── Incident.js
│   ├── InventarioObservacion.js
│   ├── User.js
│   └── Workstation.js
├── routes/                           # Definición de endpoints
├── migrations/                       # 26 archivos SQL de evolución del schema
├── scripts/                          # 27 scripts de migración y setup de datos
├── uploads/
│   ├── incidents/                    # Archivos adjuntos de incidentes
│   ├── activos/                      # Imágenes/docs de activos
│   └── disenos/
│       ├── (raíz)                    # Imágenes de referencia de diseños
│       └── entregas/                 # Archivos de entrega de diseños
└── index.js                          # Entry point: Express + Socket.IO
```

---

## Variables de Entorno (.env)

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=<password>
DB_DATABASE=call_center_support
JWT_SECRET=<secreto>
PORT=5001
FRONTEND_URL=http://localhost:5173
NODE_ENV=development | production
```

---

## Roles y Permisos

| Rol                  | Descripción                                        |
|----------------------|----------------------------------------------------|
| `admin`              | Acceso total                                       |
| `coordinador`        | Crea y supervisa incidentes                        |
| `supervisor`         | Supervisa incidentes                               |
| `technician`         | Atiende y resuelve incidentes                      |
| `jefe_operaciones`   | Gestión de operaciones                             |
| `administrativo`     | Usuario administrativo                             |
| `gestorActivos`      | Gestión completa del inventario de activos         |
| `tecnicoInventario`  | Edición de componentes de activos                  |
| `directivoFinanciero`| Vista financiera/ejecutiva del inventario          |
| `diseñador`          | Atiende solicitudes de diseño, sube entregas       |
| `anonimo`            | Usuario de chat anónimo (Hanny)                    |

**Jerarquía:** `admin` > `jefe_operaciones` > `supervisor/coordinador` > `technician/tecnicoInventario` > `administrativo` > `anonimo`

**Token:** JWT en header `x-auth-token`, expiración 5 horas.

---

## Flujo de Incidentes

```
CREACIÓN (pendiente)
    ↓
ASIGNACIÓN a técnico (en_proceso)
    ↓ (si técnico devuelve)          ↓ (si técnico resuelve)
  devuelto → corrección → en_proceso   en_supervision
                                          ↓
                                  APROBADO (estado final)
                                          ← RECHAZADO (vuelve a en_proceso)
```

**Estados:** `pendiente` | `en_proceso` | `en_supervision` | `aprobado` | `devuelto`

### Reglas de Visibilidad por Rol
- **Técnico:** Ve incidentes de su sede + Barranquilla (remoto)
- **Supervisor:** Ve su sede + Barranquilla
- **Jefe Operaciones:** Ve su sede y departamento
- **Coordinador/Admin:** Admin ve todo; Coordinador ve los propios

**Sedes:** Bogotá | Villavicencio | Barranquilla (remoto)

---

## API Endpoints

### Autenticación — `/api/auth`
| Método | Ruta               | Descripción                          | Roles       |
|--------|--------------------|--------------------------------------|-------------|
| POST   | `/login`           | Login → JWT + datos de usuario       | Público     |
| GET    | `/me`              | Info del usuario autenticado         | Autenticado |
| PUT    | `/change-password` | Cambiar contraseña                   | Autenticado |

### Usuarios — `/api/users`
| Método | Ruta           | Descripción                         | Roles |
|--------|----------------|-------------------------------------|-------|
| GET    | `/technicians` | Listar técnicos                     | Todos |
| GET    | `/coordinators`| Listar coordinadores/supervisores   | Todos |
| GET    | `/`            | Todos los usuarios                  | admin |
| GET    | `/:id`         | Usuario por ID                      | admin |
| POST   | `/`            | Crear usuario                       | admin |
| PUT    | `/:id`         | Actualizar usuario                  | admin |
| DELETE | `/:id`         | Eliminar usuario                    | admin |

### Incidentes — `/api/incidents`
| Método | Ruta                             | Descripción                              | Roles                                   |
|--------|----------------------------------|------------------------------------------|-----------------------------------------|
| GET    | `/`                              | Listar (filtros: status, sede, depto)    | Autenticado                             |
| GET    | `/my-incidents`                  | Incidentes asignados al técnico          | technician                              |
| GET    | `/pending`                       | Incidentes pendientes                    | Autenticado                             |
| GET    | `/supervision`                   | En supervisión (con filtro de tiempo)    | Autenticado                             |
| GET    | `/approved`                      | Aprobados (histórico)                    | Autenticado                             |
| GET    | `/returned`                      | Devueltos para corrección                | Autenticado                             |
| GET    | `/my-reports`                    | Incidentes creados por el usuario        | Autenticado                             |
| GET    | `/my-alerts`                     | Alertas de supervisión del usuario       | Autenticado                             |
| GET    | `/my-ratings`                    | Calificaciones del técnico               | technician                              |
| GET    | `/ratings/:id`                   | Calificaciones de técnico por ID         | Autenticado                             |
| GET    | `/stats/by-sede`                 | Estadísticas por sede                    | admin                                   |
| GET    | `/stats/technicians`             | Rendimiento de técnicos                  | admin                                   |
| GET    | `/stats/technicians-ranking`     | Ranking de técnicos                      | admin                                   |
| GET    | `/stats/coordinators-ranking`    | Ranking de coordinadores                 | admin                                   |
| GET    | `/export/old-incidents`          | Exportar incidentes para archivo         | admin                                   |
| GET    | `/:id`                           | Detalle de incidente                     | Autenticado                             |
| GET    | `/:id/history`                   | Historial de acciones                    | Autenticado                             |
| GET    | `/:id/attachments`               | Archivos adjuntos                        | Autenticado                             |
| POST   | `/`                              | Crear incidente                          | coordinador, supervisor, jefe_op, admin |
| POST   | `/with-files`                    | Crear con archivos adjuntos              | coordinador, administrativo, admin      |
| PUT    | `/:id/assign`                    | Asignar técnico                          | admin, technician (autoasignación)      |
| PUT    | `/:id/reassign`                  | Reasignar técnico                        | admin                                   |
| PUT    | `/:id/resolve`                   | Marcar como resuelto                     | technician                              |
| PUT    | `/:id/return`                    | Devolver para corrección                 | technician                              |
| PUT    | `/:id/correct`                   | Corregir y reenviar                      | creador                                 |
| PUT    | `/:id/approve`                   | Aprobar                                  | supervisor, coordinador, administrativo, admin |
| PUT    | `/:id/reject`                    | Rechazar                                 | supervisor, coordinador, administrativo, admin |
| POST   | `/send-alerts`                   | Enviar alertas de supervisión            | admin                                   |
| PUT    | `/alerts/:id/read`               | Marcar alerta como leída                 | Autenticado                             |
| PUT    | `/alerts/:id/dismiss`            | Descartar alerta                         | Autenticado                             |

### Estaciones de Trabajo — `/api/workstations`
| Método | Ruta    | Descripción                           | Roles              |
|--------|---------|---------------------------------------|--------------------|
| GET    | `/`     | Listar (visibilidad por rol)          | Autenticado        |
| GET    | `/:id`  | Detalle de estación                   | Autenticado        |
| POST   | `/`     | Crear estación                        | admin, coordinador |
| PUT    | `/:id`  | Actualizar estación                   | admin, coordinador |
| DELETE | `/:id`  | Eliminar estación                     | admin              |

### Activos — `/api/activos`
| Método | Ruta             | Descripción                           | Roles        |
|--------|------------------|---------------------------------------|--------------|
| GET    | `/`              | Listar activos (con filtros)          | gestorActivos|
| GET    | `/stats`         | Estadísticas de activos               | gestorActivos|
| GET    | `/responsables`  | Listar responsables                   | gestorActivos|
| GET    | `/placa/:placa`  | Buscar por placa (tolerante a escáner)| gestorActivos|
| GET    | `/:id`           | Activo por ID                         | gestorActivos|
| POST   | `/`              | Crear activo (con archivo opcional)   | gestorActivos|
| PUT    | `/:id`           | Actualizar activo                     | gestorActivos|
| DELETE | `/:id`           | Eliminar activo                       | gestorActivos|

### Activos Técnico — `/api/activos-tecnico`
| Método | Ruta                         | Descripción                              | Roles                           |
|--------|------------------------------|------------------------------------------|---------------------------------|
| GET    | `/`                          | Activos editables (CPU, Laptop, Server)  | tecnicoInv, gestorActivos, admin|
| GET    | `/historial`                 | Todo el historial de cambios             | gestorActivos, admin            |
| GET    | `/historial/stats`           | Estadísticas de historial                | gestorActivos, admin            |
| GET    | `/historial/filtered`        | Historial paginado                       | gestorActivos, admin            |
| GET    | `/no-productivos`            | Activos no productivos                   | tecnicoInv, gestorActivos, admin|
| GET    | `/en-bodega`                 | Activos en bodega                        | tecnicoInv, gestorActivos, admin|
| GET    | `/pendientes-baja`           | Pendientes de baja (aprobación)          | admin                           |
| GET    | `/:id/componentes`           | Componentes de hardware                  | tecnicoInv, gestorActivos, admin|
| GET    | `/:id/historial`             | Historial de cambios del activo          | tecnicoInv, gestorActivos, admin|
| GET    | `/:id/inventario`            | Observaciones de inventario              | tecnicoInv, gestorActivos, admin|
| POST   | `/:id/inventario`            | Crear observación de inventario          | tecnicoInv, gestorActivos, admin|
| PUT    | `/:id/estado-mantenimiento`  | Toggle estado de mantenimiento           | tecnicoInv, gestorActivos, admin|
| PUT    | `/:id/componente`            | Actualizar componente de hardware        | tecnicoInv, gestorActivos, admin|
| PUT    | `/:id/dar-de-baja`           | Aprobar baja del activo                  | admin                           |

### Diseños — `/api/disenos`

**Flujo de estados:**
```
PENDIENTE → (asignar diseñador) → EN_PROGRESO ⇄ EN_ESPERA → COMPLETADO → DEVUELTO → EN_PROGRESO ...
```
- Autoasignación: si solo hay 1 diseñador, se asigna automáticamente al crear.
- Visibilidad: admin/coordinador/jefe_op ven todo; diseñador ve solo los suyos; otros usuarios ven solo sus solicitudes.

| Método | Ruta                          | Descripción                                          | Roles                                      |
|--------|-------------------------------|------------------------------------------------------|--------------------------------------------|
| GET    | `/disenadores`                | Listar usuarios con rol diseñador                    | admin, coordinador                         |
| GET    | `/`                           | Listar diseños (filtros: estado, fecha)              | Autenticado (visibilidad por rol)          |
| GET    | `/:id`                        | Detalle de diseño                                    | Autenticado (propio o admin/coord)         |
| GET    | `/:id/imagenes/download`      | Descargar imágenes de referencia como ZIP            | Autenticado                                |
| GET    | `/:id/entregas/download`      | Descargar archivos de entrega como ZIP               | Autenticado                                |
| GET    | `/:id/devoluciones`           | Historial de devoluciones                            | Autenticado                                |
| POST   | `/`                           | Crear solicitud de diseño (con imágenes opcionales)  | Autenticado                                |
| POST   | `/:id/entregas`               | Subir archivos de entrega                            | diseñador asignado, admin, coordinador     |
| PUT    | `/:id`                        | Actualizar nombre/descripción/imágenes               | admin, coordinador, solicitante            |
| PUT    | `/:id/assign`                 | Asignar diseñador → estado pasa a en_progreso        | admin, coordinador                         |
| PUT    | `/:id/complete`               | Marcar como completado                               | diseñador asignado, admin, coordinador     |
| PUT    | `/:id/espera`                 | Toggle pausa: en_progreso ↔ en_espera                | diseñador asignado                         |
| PUT    | `/:id/return`                 | Devolver con nota (desde completado)                 | admin, coordinador, solicitante            |
| PUT    | `/:id/fecha-estimada`         | Establecer fecha estimada de entrega                 | diseñador asignado                         |
| PUT    | `/:id/entregas/replace`       | Reemplazar TODOS los archivos de entrega             | diseñador asignado, admin, coordinador     |
| DELETE | `/:id`                        | Eliminar diseño                                      | admin, coordinador                         |
| DELETE | `/:id/imagenes/:imagenId`     | Eliminar imagen de referencia                        | admin, coordinador, solicitante            |
| DELETE | `/:id/entregas/:archivoId`    | Eliminar archivo de entrega                          | diseñador, admin, coordinador              |

### Agentes — `/api/agentes`
| Método | Ruta                          | Descripción                              | Roles                    |
|--------|-------------------------------|------------------------------------------|--------------------------|
| GET    | `/`                           | Listar agentes (con total de activos)    | gestorActivos, admin     |
| GET    | `/:id`                        | Agente por ID                            | gestorActivos, admin     |
| GET    | `/:id/activos`                | Activos asignados al agente              | gestorActivos, admin     |
| POST   | `/`                           | Crear agente                             | gestorActivos, admin     |
| PUT    | `/:id`                        | Actualizar agente                        | gestorActivos, admin     |
| PUT    | `/:id/activos/:activoId`      | Asignar activo a agente                  | gestorActivos, admin     |
| DELETE | `/:id`                        | Eliminar agente (activos quedan libres)  | gestorActivos, admin     |
| DELETE | `/:id/activos/:activoId`      | Desasignar activo del agente             | gestorActivos, admin     |

### Inventario Directivo — `/api/inventario-directivo`
| Método | Ruta      | Descripción                    | Roles                        |
|--------|-----------|--------------------------------|------------------------------|
| GET    | `/`       | Todos los activos (vista exec) | directivoFinanciero, admin   |
| GET    | `/stats`  | Estadísticas globales          | directivoFinanciero, admin   |
| GET    | `/charts` | Datos para gráficas            | directivoFinanciero, admin   |
| GET    | `/:id`    | Detalle de activo              | directivoFinanciero, admin   |

### Chat (Hanny) — `/api/chat`
| Método | Ruta                 | Descripción                          | Roles          |
|--------|----------------------|--------------------------------------|----------------|
| POST   | `/send`              | Enviar mensaje privado               | anonimo, Hanny |
| GET    | `/messages/:userId`  | Conversación con usuario             | Autenticado    |
| GET    | `/conversations`     | Listar conversaciones                | Hanny (admin)  |
| GET    | `/admin-info`        | Info del admin para chat             | anonimo        |
| GET    | `/unread-count`      | Conteo de mensajes no leídos         | Autenticado    |

### Analíticas — `/api/analytics` (solo `admin`)
| Método | Ruta                            | Descripción                          |
|--------|---------------------------------|--------------------------------------|
| GET    | `/overview`                     | Resumen estadístico                  |
| GET    | `/by-sede`                      | Incidentes por sede                  |
| GET    | `/by-department`                | Incidentes por departamento          |
| GET    | `/by-failure-type`              | Distribución por tipo de falla       |
| GET    | `/temporal-trend`               | Tendencias temporales                |
| GET    | `/top-failing-stations`         | Estaciones con más fallas            |
| GET    | `/technician-performance`       | Métricas de rendimiento técnico      |
| GET    | `/reports-by-user`              | Distribución de reportes por usuario |
| GET    | `/hourly-distribution`          | Patrones por hora del día            |
| GET    | `/weekday-distribution`         | Patrones por día de la semana        |
| GET    | `/resolution-time-analysis`     | Análisis de tiempo de resolución     |
| GET    | `/quality-metrics`              | Métricas avanzadas de calidad        |
| GET    | `/technician/:id/daily-stats`   | Estadísticas diarias del técnico     |
| GET    | `/technician/:id/daily-incidents`| Incidentes diarios del técnico      |

---

## Modelos de Datos

### User
- `id`, `username`, `password` (bcrypt), `nombre`, `email`, `role`, `sede`, `departamento`

### Incident
- `id`, `title`, `description`, `status`, `priority`, `failure_type`
- `created_by` (FK User), `assigned_to` (FK User), `workstation_id` (FK Workstation)
- `sede`, `departamento`, `resolution_notes`, `rating`, `rating_comment`
- `created_at`, `updated_at`, `resolved_at`, `approved_at`

### Workstation
- `id`, `station_code`, `location_details`, `sede`, `departamento`
- `anydesk_address`, `advisor_cedula` (para trabajo remoto Barranquilla)

### Diseno
- `id`, `nombre`, `descripcion` (LONGTEXT), `estado` (`pendiente` | `en_progreso` | `en_espera` | `completado` | `devuelto`)
- `solicitante_id` (FK users), `disenador_id` (FK users, nullable)
- `fecha_estimada` (DATETIME), `devolucion_nota` (TEXT), `devuelto_at` (DATETIME)
- `created_at`, `updated_at`

### diseno_imagenes
- `id`, `diseno_id` (FK), `filename`, `created_at`
- Archivos en `uploads/disenos/` — max 20 MB c/u, hasta 60 por diseño

### diseno_entregas
- `id`, `diseno_id` (FK), `filename`, `original_name`, `mimetype`, `size` (BIGINT), `uploaded_at`
- Archivos en `uploads/disenos/entregas/` — max 100 MB c/u, hasta 10 por diseño

### diseno_devoluciones
- `id`, `diseno_id` (FK), `nota` (TEXT), `numero_devolucion` (INT secuencial), `solicitante_id` (FK), `created_at`
- Se crea un registro por cada devolución; el número se incrementa automáticamente

### Agente
- `id`, `cedula` (único), `nombres`, `apellidos`, `campana`
- `created_at`, `updated_at`
- Al eliminar un agente, los activos asociados quedan con `agente_id = NULL` (ON DELETE SET NULL)
- El listado incluye `total_activos` (COUNT de activos asignados)

### Activo (Asset)
- **Básicos:** `numero_placa`, `ubicacion`, `responsable`, `proveedor`, `clasificacion`
- **Financieros:** `valor`, `fecha_compra`, `poliza`, `aseguradora`, `garantia`
- **Hardware:** `marca_modelo`, `cpu_procesador`, `memoria_ram`, `almacenamiento`, `sistema_operativo`
- **Ubicación:** `site`, `puesto`, `asignado`, `centro_costes`
- **Estado:** `estado` (`funcional` | `en_mantenimiento` | `bodega` | `dado_de_baja`)
- **Agente:** `agente_id` (FK → agentes, nullable) — activo sin agente cuando es NULL
- **Filtro de listado:** `?sin_agente=true` retorna solo activos sin agente asignado

**Detección automática de tipo por número de placa:**
| Patrón            | Tipo       |
|-------------------|------------|
| ECC-CPU / ECC'CPU | Escritorio |
| ECC-SER / ECC'SER | Servidor   |
| ECC-MON / ECC'MON | Monitor    |
| ECC-IMP / ECC'IMP | Impresora  |
| ECC-POR / ECC'POR | Portátil   |
| ECC-TV / ECC'TV   | TV         |

### ActivoHistorial
- Registra cambios de: CPU, RAM, almacenamiento, OS, clasificación
- `activo_id`, `campo_modificado`, `valor_anterior`, `valor_nuevo`, `modificado_por_id`, `created_at`

### InventarioObservacion
- `activo_id`, `observacion`, `realizado_por_id`, `created_at`

---

## Carga de Archivos

| Contexto           | Ruta de guardado              | Tamaño máx. | Archivos máx.  | Tipos permitidos          |
|--------------------|-------------------------------|-------------|----------------|---------------------------|
| Incidentes         | `/uploads/incidents/`         | 10 MB       | 5 por request  | JPEG, PNG, GIF, WebP, PDF |
| Activos            | `/uploads/activos/`           | 15 MB       | 1 por activo   | JPEG, PNG, GIF, WebP, PDF |
| Diseños (imágs.)   | `/uploads/disenos/`           | 20 MB       | 60 por diseño  | JPEG, PNG, GIF, WebP, PDF |
| Diseños (entregas) | `/uploads/disenos/entregas/`  | 100 MB      | 10 por entrega | Cualquier tipo            |

**Naming:** `{timestamp}_{randomId}_{originalname}`

---

## Socket.IO — Tiempo Real

- Autenticación en la conexión via JWT
- Notificaciones de mensajes en tiempo real
- Mapa global de usuarios conectados
- Verificación de entrega de mensajes
- Función global `sendMessageToUser()` para notificaciones WebSocket

---

## Dependencias Principales

```json
{
  "express": "^5.1.0",
  "mysql2": "^3.14.3",
  "jsonwebtoken": "^9.0.2",
  "bcryptjs": "^3.0.2",
  "cors": "^2.8.5",
  "dotenv": "^17.2.1",
  "multer": "^2.0.2",
  "socket.io": "^4.8.1",
  "nodemon": "^3.0.1"
}
```

---

## Scripts disponibles (package.json)

```bash
npm start      # node index.js
npm run dev    # nodemon index.js (desarrollo)
```

---

## Migraciones

33 archivos de migración SQL que evolucionan el schema:
- Sistema de calificación de técnicos
- Alertas de supervisión
- Rol de usuario anónimo (Hanny)
- Sistema de gestión de activos
- Historial de cambios en activos
- Sistema de observaciones de inventario
- Expansión de campos de activos (valor, site, puesto, asignado)
- Estados de bodega y baja de activos
- **029** — Tabla `disenos` + `diseno_imagenes`
- **030** — Tabla `diseno_entregas`
- **031** — Campo `fecha_estimada` en diseños
- **032** — Tabla `diseno_devoluciones`
- **033** — Estado `en_espera` en enum de diseños

---

## Notas Importantes

1. **CORS dinámico:** En desarrollo permite `localhost:5173`; en producción usa `FRONTEND_URL` del `.env`.
2. **Tolerancia de escáner de pistola:** El modelo Activo maneja variantes `ECC-XXX` y `ECC'XXX` en búsqueda por placa.
3. **Autoasignación de técnicos:** Un técnico puede asignarse a sí mismo un incidente.
4. **Trabajo remoto Barranquilla:** Técnicos de Bogotá y Villavicencio pueden atender incidentes de Barranquilla.
5. **Eliminación con dependencias:** `User.deleteWithDependencies()` usa transacción para eliminar registros relacionados sin romper FK.
6. **Express v5:** El proyecto usa Express 5 (RC), con diferencias en manejo de promesas y errores respecto a v4.
