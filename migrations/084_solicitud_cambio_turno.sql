-- =====================================================================
-- 084 — Solicitudes de cambio de turno y notificaciones de asistencia (asistencia.md §50)
--
-- Un coordinador (quien es jefe inmediato de alguien) pide el cambio de turno de cualquier empleado
-- activo, con un motivo. La solicitud le llega a quien gestiona la asistencia de ese empleado
-- (COALESCE(gestor_asistencia_id, jefe_area_id), §44), que la aprueba —y el horario se reemplaza
-- solo— o la rechaza con un motivo de rechazo. Hay dos tipos:
--   - cambio_horario: un empleado pasa a otro horario (plantilla, horas o descanso) en uno o más días;
--   - intercambio: dos empleados del mismo jefe intercambian sus turnos de una fecha.
--
-- Tablas:
-- - solicitud_cambio_turno: la solicitud, su estado y quién la pidió y la resolvió.
-- - solicitud_cambio_turno_dia: cada (empleado, fecha) que cambia, con el horario nuevo y una copia
--   del que tenía al pedirla (para mostrar el antes y el después).
-- - notificacion_asistencia: la campana del portal. El destinatario es una ficha (jefe, coordinador,
--   empleado) o un usuario de `users` (financiera, que puede no tener ficha). Genérica: sirve para
--   otros avisos de asistencia más adelante.
--
-- Sin dependencias (requiere 043 y 065, ya en producción). No compara texto entre tablas, así que no
-- le afecta el collation de producción. Idempotente (CREATE TABLE IF NOT EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS `solicitud_cambio_turno` (
  `idsolicitud_cambio_turno` INT NOT NULL AUTO_INCREMENT,
  `tipo` ENUM('cambio_horario', 'intercambio') NOT NULL,
  `estado` ENUM('pendiente', 'aprobada', 'rechazada') NOT NULL DEFAULT 'pendiente',
  `solicitante_users_company_id` INT NOT NULL COMMENT 'ficha del coordinador que la pide',
  `solicitado_por_user_id` INT NULL,
  `solicitado_por_cuenta_id` INT NULL,
  `aprobador_users_company_id` INT NOT NULL COMMENT 'quien gestiona la asistencia del empleado al pedirla',
  `motivo` VARCHAR(500) NOT NULL,
  `motivo_rechazo` VARCHAR(500) NULL,
  `comentario` VARCHAR(500) NULL COMMENT 'comentario opcional del jefe al aprobar',
  `resuelto_por_users_company_id` INT NULL,
  `resuelto_por_user_id` INT NULL,
  `resuelto_por_cuenta_id` INT NULL,
  `resuelta_en` DATETIME(3) NULL,
  `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`idsolicitud_cambio_turno`),
  KEY `idx_sct_aprobador_estado` (`aprobador_users_company_id`, `estado`),
  KEY `idx_sct_solicitante` (`solicitante_users_company_id`),
  KEY `idx_sct_estado_creado` (`estado`, `creado_en`),
  CONSTRAINT `fk_sct_solicitante` FOREIGN KEY (`solicitante_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sct_aprobador` FOREIGN KEY (`aprobador_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sct_resuelto_por` FOREIGN KEY (`resuelto_por_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sct_solicitado_user` FOREIGN KEY (`solicitado_por_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sct_solicitado_cuenta` FOREIGN KEY (`solicitado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL,
  CONSTRAINT `fk_sct_resuelto_user` FOREIGN KEY (`resuelto_por_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sct_resuelto_cuenta` FOREIGN KEY (`resuelto_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `solicitud_cambio_turno_dia` (
  `idsolicitud_cambio_turno_dia` INT NOT NULL AUTO_INCREMENT,
  `solicitud_id` INT NOT NULL,
  `users_company_id` INT NOT NULL,
  `fecha` DATE NOT NULL,
  -- Horario nuevo (lo que se aplica al aprobar). Descanso: es_descanso = 1 y horas en 00:00.
  `horario_plantilla_id` INT NULL,
  `hora_entrada` TIME NOT NULL,
  `hora_salida` TIME NOT NULL,
  `minutos_almuerzo` SMALLINT NOT NULL DEFAULT 60,
  `hora_almuerzo_inicio` TIME NULL,
  `tolerancia_entrada_min` SMALLINT NOT NULL DEFAULT 5,
  `es_descanso` TINYINT(1) NOT NULL DEFAULT 0,
  -- Copia del horario que tenía al pedirla (NULL = no tenía horario ese día).
  `anterior_hora_entrada` TIME NULL,
  `anterior_hora_salida` TIME NULL,
  `anterior_es_descanso` TINYINT(1) NULL,
  `anterior_plantilla` VARCHAR(100) NULL,
  PRIMARY KEY (`idsolicitud_cambio_turno_dia`),
  UNIQUE KEY `uq_sctd_solicitud_empleado_fecha` (`solicitud_id`, `users_company_id`, `fecha`),
  KEY `idx_sctd_empleado_fecha` (`users_company_id`, `fecha`),
  CONSTRAINT `fk_sctd_solicitud` FOREIGN KEY (`solicitud_id`) REFERENCES `solicitud_cambio_turno` (`idsolicitud_cambio_turno`) ON DELETE CASCADE,
  CONSTRAINT `fk_sctd_empleado` FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_sctd_plantilla` FOREIGN KEY (`horario_plantilla_id`) REFERENCES `horario_plantilla` (`idhorario_plantilla`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `notificacion_asistencia` (
  `idnotificacion_asistencia` INT NOT NULL AUTO_INCREMENT,
  `destinatario_users_company_id` INT NULL COMMENT 'ficha destinataria (entre con su cédula o con su usuario)',
  `destinatario_user_id` INT NULL COMMENT 'usuario destinatario sin ficha (financiera)',
  `tipo` VARCHAR(40) NOT NULL COMMENT 'cambio_turno_solicitado, cambio_turno_aprobado, cambio_turno_rechazado, turno_cambiado',
  `solicitud_cambio_turno_id` INT NULL,
  `mensaje` VARCHAR(255) NOT NULL,
  `leida_en` DATETIME NULL,
  `creada_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`idnotificacion_asistencia`),
  KEY `idx_na_ficha` (`destinatario_users_company_id`, `leida_en`),
  KEY `idx_na_usuario` (`destinatario_user_id`, `leida_en`),
  CONSTRAINT `fk_na_ficha` FOREIGN KEY (`destinatario_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_na_usuario` FOREIGN KEY (`destinatario_user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_na_solicitud` FOREIGN KEY (`solicitud_cambio_turno_id`) REFERENCES `solicitud_cambio_turno` (`idsolicitud_cambio_turno`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
