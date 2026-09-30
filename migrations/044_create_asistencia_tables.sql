-- Migración 044: tablas del módulo de asistencia
-- Motor: InnoDB | Charset: utf8mb4
-- Ver asistencia.md §5 para el detalle de cada tabla y §5.1 para la justificación
-- de las dos desnormalizaciones controladas (snapshot de horario_plantilla en
-- horario_asignado, y totales derivados cacheados en jornada / hora_extra).

DROP TABLE IF EXISTS `jornada_evento`;
DROP TABLE IF EXISTS `hora_extra`;
DROP TABLE IF EXISTS `jornada`;
DROP TABLE IF EXISTS `horario_asignado`;
DROP TABLE IF EXISTS `horario_plantilla`;
DROP TABLE IF EXISTS `asistencia_parametro`;

-- ---------------------------------------------------------------------
-- horario_plantilla: turnos reutilizables
-- ---------------------------------------------------------------------
CREATE TABLE `horario_plantilla` (
  `idhorario_plantilla` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(80) NOT NULL,
  `hora_entrada` TIME NOT NULL,
  `hora_salida` TIME NOT NULL,
  `minutos_almuerzo` SMALLINT NOT NULL DEFAULT 60,
  `hora_almuerzo_inicio` TIME NULL,
  `tolerancia_entrada_min` SMALLINT NOT NULL DEFAULT 5,
  `creado_por_user_id` INT NULL,
  `activo` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`idhorario_plantilla`),
  CONSTRAINT `fk_horario_plantilla_creado_por`
    FOREIGN KEY (`creado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- horario_asignado: el horario de un empleado en una fecha (snapshot)
-- ---------------------------------------------------------------------
CREATE TABLE `horario_asignado` (
  `idhorario_asignado` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `fecha` DATE NOT NULL,
  `horario_plantilla_id` INT NULL,
  `hora_entrada` TIME NOT NULL,
  `hora_salida` TIME NOT NULL,
  `minutos_almuerzo` SMALLINT NOT NULL DEFAULT 60,
  `hora_almuerzo_inicio` TIME NULL,
  `tolerancia_entrada_min` SMALLINT NOT NULL DEFAULT 5,
  `es_descanso` TINYINT(1) NOT NULL DEFAULT 0,
  `creado_por_user_id` INT NULL,
  `notas` VARCHAR(255) NULL,
  PRIMARY KEY (`idhorario_asignado`),
  UNIQUE KEY `uq_horario_asignado_empleado_fecha` (`users_company_id`, `fecha`),
  CONSTRAINT `fk_horario_asignado_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_horario_asignado_plantilla`
    FOREIGN KEY (`horario_plantilla_id`) REFERENCES `horario_plantilla` (`idhorario_plantilla`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_horario_asignado_creado_por`
    FOREIGN KEY (`creado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- jornada: cabecera del día (caché derivada, recalculable desde jornada_evento)
-- ---------------------------------------------------------------------
CREATE TABLE `jornada` (
  `idjornada` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `horario_asignado_id` INT NULL,
  `fecha` DATE NOT NULL,
  `estado` ENUM('pendiente','en_curso','en_pausa','finalizada','ausente') NOT NULL DEFAULT 'pendiente',
  `hora_entrada_real` DATETIME(3) NULL,
  `hora_salida_real` DATETIME(3) NULL,
  `minutos_tarde` SMALLINT NOT NULL DEFAULT 0,
  `minutos_trabajados` INT NOT NULL DEFAULT 0,
  `minutos_pausa_bano` INT NOT NULL DEFAULT 0,
  `minutos_pausa_almuerzo` INT NOT NULL DEFAULT 0,
  `minutos_extra` INT NOT NULL DEFAULT 0,
  `minutos_salida_anticipada` INT NOT NULL DEFAULT 0,
  `desviacion_almuerzo_min` INT NOT NULL DEFAULT 0,
  `cerrada_automaticamente` TINYINT(1) NOT NULL DEFAULT 0,
  `ajustada_por_user_id` INT NULL,
  PRIMARY KEY (`idjornada`),
  UNIQUE KEY `uq_jornada_empleado_fecha` (`users_company_id`, `fecha`),
  KEY `idx_jornada_fecha_estado` (`fecha`, `estado`),
  CONSTRAINT `fk_jornada_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_jornada_horario_asignado`
    FOREIGN KEY (`horario_asignado_id`) REFERENCES `horario_asignado` (`idhorario_asignado`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_jornada_ajustada_por`
    FOREIGN KEY (`ajustada_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- jornada_evento: append-only, la fuente de verdad. Nunca se actualiza ni se borra.
-- ---------------------------------------------------------------------
CREATE TABLE `jornada_evento` (
  `idjornada_evento` INT NOT NULL AUTO_INCREMENT,
  `jornada_id` INT NOT NULL,
  `tipo` ENUM('entrada','inicio_bano','fin_bano','inicio_almuerzo','fin_almuerzo','salida','inicio_extra','fin_extra') NOT NULL,
  `ocurrido_en` DATETIME(3) NOT NULL,
  `origen` ENUM('empleado','director','sistema') NOT NULL DEFAULT 'empleado',
  `registrado_por_user_id` INT NULL,
  `nota` VARCHAR(255) NULL,
  `ip` VARCHAR(45) NULL,
  `user_agent` VARCHAR(255) NULL,
  PRIMARY KEY (`idjornada_evento`),
  KEY `idx_jornada_evento_jornada_ocurrido` (`jornada_id`, `ocurrido_en`),
  CONSTRAINT `fk_jornada_evento_jornada`
    FOREIGN KEY (`jornada_id`) REFERENCES `jornada` (`idjornada`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_jornada_evento_registrado_por`
    FOREIGN KEY (`registrado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- hora_extra
-- ---------------------------------------------------------------------
CREATE TABLE `hora_extra` (
  `idhora_extra` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `fecha` DATE NOT NULL,
  `tipo` ENUM('solicitada','asignada') NOT NULL,
  `minutos_estimados` INT NOT NULL,
  `minutos_aprobados` INT NULL,
  `minutos_ejecutados` INT NOT NULL DEFAULT 0,
  `estado` ENUM('pendiente','aprobada','rechazada','cancelada') NOT NULL DEFAULT 'pendiente',
  `motivo` VARCHAR(255) NULL,
  `solicitado_por_user_id` INT NULL,
  `aprobado_por_user_id` INT NULL,
  `fecha_decision` DATETIME NULL,
  `comentario_director` VARCHAR(255) NULL,
  PRIMARY KEY (`idhora_extra`),
  KEY `idx_hora_extra_empleado_fecha` (`users_company_id`, `fecha`),
  KEY `idx_hora_extra_estado` (`estado`),
  CONSTRAINT `fk_hora_extra_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_hora_extra_solicitado_por`
    FOREIGN KEY (`solicitado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hora_extra_aprobado_por`
    FOREIGN KEY (`aprobado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- asistencia_parametro: configuración editable, no constantes en el código
-- ---------------------------------------------------------------------
CREATE TABLE `asistencia_parametro` (
  `clave` VARCHAR(60) NOT NULL,
  `valor` VARCHAR(60) NOT NULL,
  `tipo_dato` ENUM('entero','decimal','booleano','texto') NOT NULL,
  `descripcion` VARCHAR(160) NULL,
  `actualizado_por_user_id` INT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`clave`),
  CONSTRAINT `fk_asistencia_parametro_actualizado_por`
    FOREIGN KEY (`actualizado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
