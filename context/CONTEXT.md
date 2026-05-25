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
│   ├── analyticsController.js
│   ├── authController.js
│   ├── autoActivoController.js
│   ├── chatController.js
│   ├── incidentController.js
│   ├── inventarioDirectivoController.js
│   ├── scriptParserController.js
│   ├── userController.js
│   └── workstationController.js
├── middleware/
│   ├── auth.js                       # JWT + RBAC
│   ├── upload.js                     # Multer para incidentes
│   └── uploadActivos.js              # Multer para activos
├── models/                           # Acceso a datos
│   ├── Activo.js
│   ├── ActivoHistorial.js
│   ├── Incident.js
│   ├── InventarioObservacion.js
│   ├── User.js
│   └── Workstation.js
├── routes/                           # Definición de endpoints
├── migrations/                       # 26 archivos SQL de evolución del schema
├── scripts/                          # 27 scripts de migración y setup de datos
├── uploads/
│   ├── incidents/                    # Archivos adjuntos de incidentes
│   └── activos/                      # Imágenes/docs de activos
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

### Activo (Asset)
- **Básicos:** `numero_placa`, `ubicacion`, `responsable`, `proveedor`, `clasificacion`
- **Financieros:** `valor`, `fecha_compra`, `poliza`, `aseguradora`, `garantia`
- **Hardware:** `marca_modelo`, `cpu_procesador`, `memoria_ram`, `almacenamiento`, `sistema_operativo`
- **Ubicación:** `site`, `puesto`, `asignado`, `centro_costes`
- **Estado:** `estado` (`funcional` | `en_mantenimiento` | `bodega` | `dado_de_baja`)

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

| Contexto   | Ruta de guardado       | Tamaño máx. | Archivos máx. | Tipos permitidos          |
|------------|------------------------|-------------|---------------|---------------------------|
| Incidentes | `/uploads/incidents/`  | 10 MB       | 5 por request | JPEG, PNG, GIF, WebP, PDF |
| Activos    | `/uploads/activos/`    | 15 MB       | 1 por activo  | JPEG, PNG, GIF, WebP, PDF |

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

26 archivos de migración SQL que evolucionan el schema:
- Sistema de calificación de técnicos
- Alertas de supervisión
- Rol de usuario anónimo (Hanny)
- Sistema de gestión de activos
- Historial de cambios en activos
- Sistema de observaciones de inventario
- Expansión de campos de activos
- Estados de bodega y baja de activos

---

## Notas Importantes

1. **CORS dinámico:** En desarrollo permite `localhost:5173`; en producción usa `FRONTEND_URL` del `.env`.
2. **Tolerancia de escáner de pistola:** El modelo Activo maneja variantes `ECC-XXX` y `ECC'XXX` en búsqueda por placa.
3. **Autoasignación de técnicos:** Un técnico puede asignarse a sí mismo un incidente.
4. **Trabajo remoto Barranquilla:** Técnicos de Bogotá y Villavicencio pueden atender incidentes de Barranquilla.
5. **Eliminación con dependencias:** `User.deleteWithDependencies()` usa transacción para eliminar registros relacionados sin romper FK.
6. **Express v5:** El proyecto usa Express 5 (RC), con diferencias en manejo de promesas y errores respecto a v4.
