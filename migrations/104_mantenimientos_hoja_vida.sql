-- Migración 104: mantenimientos de equipos, hoja de vida, traslados de puesto y motivo de baja
-- (rol tecnicoInventario).
--
-- 1. activo_mantenimiento: cada mantenimiento que registra el técnico.
--    - preventivo: casillas pasta térmica / limpieza de componentes / formateo (al menos una).
--    - correctivo: descripción obligatoria.
--    Guarda una foto de los componentes del equipo en ese momento (para la hoja de vida y el PDF).
--    La fecha del último preventivo decide la alerta: 3 meses naranja, 6 meses rojo.
-- 2. activo_solicitud_baja: la observación (motivo) de cada solicitud de baja del técnico y la
--    decisión del administrador (aprobada / rechazada / cancelada), con quién y cuándo.
-- 3. activos_historial.campo_modificado + 'puesto' y 'site': los traslados de puesto quedan en el
--    historial (antes un cambio de puesto no dejaba rastro).
--
-- Idempotente: se puede correr dos veces. Va ANTES del código (el código nombra estas tablas).

CREATE TABLE IF NOT EXISTS activo_mantenimiento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activo_id INT NOT NULL,
    tipo ENUM('preventivo', 'correctivo') NOT NULL,
    pasta_termica TINYINT(1) NOT NULL DEFAULT 0,
    limpieza_componentes TINYINT(1) NOT NULL DEFAULT 0,
    formateo TINYINT(1) NOT NULL DEFAULT 0,
    descripcion TEXT NULL COMMENT 'Obligatoria en correctivo; observaciones opcionales en preventivo',
    cpu_procesador VARCHAR(300) NULL COMMENT 'Componentes del equipo al momento del mantenimiento',
    memoria_ram VARCHAR(200) NULL,
    almacenamiento VARCHAR(200) NULL,
    sistema_operativo VARCHAR(200) NULL,
    puesto VARCHAR(50) NULL,
    realizado_por_id INT NOT NULL,
    fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_act_mant_activo_fecha (activo_id, fecha),
    KEY idx_act_mant_tipo (tipo),
    CONSTRAINT fk_act_mant_activo FOREIGN KEY (activo_id) REFERENCES activos (id) ON DELETE CASCADE,
    CONSTRAINT fk_act_mant_usuario FOREIGN KEY (realizado_por_id) REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS activo_solicitud_baja (
    id INT AUTO_INCREMENT PRIMARY KEY,
    activo_id INT NOT NULL,
    motivo TEXT NOT NULL COMMENT 'Observación del técnico: por qué se da de baja',
    estado_anterior VARCHAR(30) NOT NULL COMMENT 'Estado del activo antes de la solicitud; se restaura si se rechaza o cancela',
    solicitado_por_id INT NOT NULL,
    fecha_solicitud TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado ENUM('pendiente', 'aprobada', 'rechazada', 'cancelada') NOT NULL DEFAULT 'pendiente',
    resuelto_por_id INT NULL,
    fecha_resolucion TIMESTAMP NULL,
    comentario_resolucion TEXT NULL COMMENT 'Comentario del administrador al aprobar o rechazar',
    KEY idx_sol_baja_activo (activo_id),
    KEY idx_sol_baja_estado (estado),
    CONSTRAINT fk_sol_baja_activo FOREIGN KEY (activo_id) REFERENCES activos (id) ON DELETE CASCADE,
    CONSTRAINT fk_sol_baja_solicita FOREIGN KEY (solicitado_por_id) REFERENCES users (id),
    CONSTRAINT fk_sol_baja_resuelve FOREIGN KEY (resuelto_por_id) REFERENCES users (id)
);

ALTER TABLE activos_historial
    MODIFY COLUMN campo_modificado ENUM(
        'cpu_procesador', 'memoria_ram', 'almacenamiento', 'sistema_operativo',
        'clasificacion', 'estado', 'puesto', 'site'
    ) NOT NULL;
