-- 070: traspasos por tipo (hoja "TRASPASOS" de Descargas/Criterios (1).xlsx, 2026-10-21).
-- Ver claude/modulo recursoshumanos.md §35.
--
-- La hoja define 6 tipos de traspaso, qué documentos aplican a cada uno ("SI"/"NO"), qué
-- "información nueva" se llena en cada uno y dos alertas:
--   - Ratificación / No ratificación: alerta al director recordando la evaluación de desempeño
--     del encargo.
--   - Trabajo en casa: alerta una semana antes de la fecha en que el trabajador retorna.
--
-- - tipo_traspaso: los 6 tipos, con `codigo` (el código del backend y del frontend usa el código,
--   nunca el id: los ids de producción no coinciden con los de local).
-- - traspaso: tipo_traspaso_id y los datos de "Información actual" que faltaban (tipo de contrato,
--   ciudad donde labora, fecha de ingreso, modalidad anterior). La modalidad que ya existía
--   (`modalidad_idmodalidad`) es la nueva.
-- - tipo_soporte_traspaso + tipo_traspaso_soporte: los 3 documentos y la matriz SI/NO.
-- - traspaso_soporte: el archivo (PDF o imagen) de cada documento, en storage/traspasos/ (privado,
--   igual que los soportes de novedades de la 069).
-- - alerta_traspaso: las alertas; el destinatario las ve en la campana del portal de asistencia.
--
-- Todo por nombre/código, nunca por ID. Idempotente. Los WHERE por PK > 0 son para el
-- "safe update mode" de MySQL Workbench.

-- 1. Catálogo de tipos ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tipo_traspaso` (
  `idtipo_traspaso` INT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(30) NOT NULL,
  `nombre` VARCHAR(60) NOT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  `vigente` TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`idtipo_traspaso`),
  UNIQUE KEY `uq_tipo_traspaso_codigo` (`codigo`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT IGNORE INTO `tipo_traspaso` (`codigo`, `nombre`, `orden`) VALUES
  ('ENCARGO', 'Encargo', 1),
  ('RATIFICACION', 'Ratificación', 2),
  ('NO_RATIFICACION', 'No ratificación', 3),
  ('TRABAJO_CASA', 'Trabajo en casa', 4),
  ('CAMBIO_CARGO', 'Cambio de cargo', 5),
  ('CAMBIO_SALARIO', 'Cambio de salario', 6);

-- 2. Columnas nuevas de traspaso --------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'traspaso' AND COLUMN_NAME = 'tipo_traspaso_id');
SET @ddl := IF(@c = 0, 'ALTER TABLE `traspaso` ADD COLUMN `tipo_traspaso_id` INT NULL AFTER `contrato_idcontrato`, ADD KEY `fk_traspaso_tipo` (`tipo_traspaso_id`), ADD CONSTRAINT `fk_traspaso_tipo` FOREIGN KEY (`tipo_traspaso_id`) REFERENCES `tipo_traspaso` (`idtipo_traspaso`)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'traspaso' AND COLUMN_NAME = 'tipo_contrato_anterior_id');
SET @ddl := IF(@c = 0, 'ALTER TABLE `traspaso` ADD COLUMN `tipo_contrato_anterior_id` INT NULL AFTER `observaciones`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'traspaso' AND COLUMN_NAME = 'ciudad_anterior_id');
SET @ddl := IF(@c = 0, 'ALTER TABLE `traspaso` ADD COLUMN `ciudad_anterior_id` INT NULL AFTER `tipo_contrato_anterior_id`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'traspaso' AND COLUMN_NAME = 'fecha_ingreso_anterior');
SET @ddl := IF(@c = 0, 'ALTER TABLE `traspaso` ADD COLUMN `fecha_ingreso_anterior` DATE NULL AFTER `ciudad_anterior_id`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'traspaso' AND COLUMN_NAME = 'modalidad_anterior_id');
SET @ddl := IF(@c = 0, 'ALTER TABLE `traspaso` ADD COLUMN `modalidad_anterior_id` INT NULL AFTER `jefe_inmediato_anterior_id`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Documentos y matriz -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tipo_soporte_traspaso` (
  `idtipo_soporte_traspaso` INT NOT NULL AUTO_INCREMENT,
  `codigo` VARCHAR(30) NOT NULL,
  `nombre` VARCHAR(80) NOT NULL,
  `orden` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`idtipo_soporte_traspaso`),
  UNIQUE KEY `uq_tipo_soporte_traspaso_codigo` (`codigo`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT IGNORE INTO `tipo_soporte_traspaso` (`codigo`, `nombre`, `orden`) VALUES
  ('FORMATO_EVALUACION', 'Formato de evaluación', 1),
  ('FORMATO_TRABAJO_CASA', 'Formato de trabajo en casa', 2),
  ('OTRO_SI', 'Otro sí al contrato', 3);

CREATE TABLE IF NOT EXISTS `tipo_traspaso_soporte` (
  `tipo_traspaso_id` INT NOT NULL,
  `tipo_soporte_traspaso_id` INT NOT NULL,
  PRIMARY KEY (`tipo_traspaso_id`, `tipo_soporte_traspaso_id`),
  KEY `fk_tts_soporte` (`tipo_soporte_traspaso_id`),
  CONSTRAINT `fk_tts_tipo` FOREIGN KEY (`tipo_traspaso_id`) REFERENCES `tipo_traspaso` (`idtipo_traspaso`) ON DELETE CASCADE,
  CONSTRAINT `fk_tts_soporte` FOREIGN KEY (`tipo_soporte_traspaso_id`) REFERENCES `tipo_soporte_traspaso` (`idtipo_soporte_traspaso`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT IGNORE INTO `tipo_traspaso_soporte` (`tipo_traspaso_id`, `tipo_soporte_traspaso_id`)
SELECT t.`idtipo_traspaso`, s.`idtipo_soporte_traspaso`
  FROM `tipo_traspaso` t
  JOIN `tipo_soporte_traspaso` s
    ON (t.`codigo` IN ('RATIFICACION', 'NO_RATIFICACION') AND s.`codigo` = 'FORMATO_EVALUACION')
    OR (t.`codigo` = 'TRABAJO_CASA' AND s.`codigo` = 'FORMATO_TRABAJO_CASA')
    OR (t.`codigo` IN ('CAMBIO_CARGO', 'CAMBIO_SALARIO') AND s.`codigo` = 'OTRO_SI');

CREATE TABLE IF NOT EXISTS `traspaso_soporte` (
  `idtraspaso_soporte` INT NOT NULL AUTO_INCREMENT,
  `traspaso_id` INT NOT NULL,
  `tipo_soporte_traspaso_id` INT NOT NULL,
  `archivo` VARCHAR(255) NOT NULL COMMENT 'nombre del archivo en storage/traspasos/ (generado, no el original)',
  `nombre_original` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(100) NOT NULL,
  `tamano` INT NOT NULL,
  `subido_por_user_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idtraspaso_soporte`),
  UNIQUE KEY `uq_traspaso_soporte` (`traspaso_id`, `tipo_soporte_traspaso_id`),
  KEY `fk_ts_soporte` (`tipo_soporte_traspaso_id`),
  CONSTRAINT `fk_ts_traspaso` FOREIGN KEY (`traspaso_id`) REFERENCES `traspaso` (`idtraspaso`) ON DELETE CASCADE,
  CONSTRAINT `fk_ts_soporte` FOREIGN KEY (`tipo_soporte_traspaso_id`) REFERENCES `tipo_soporte_traspaso` (`idtipo_soporte_traspaso`) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 4. Alertas ------------------------------------------------------------------------------------
-- tipo: 'evaluacion_encargo' (ratificación / no ratificación → director de área) o
--       'retorno_trabajo_casa' (7 días antes del fin del trabajo en casa → jefe inmediato).
-- Se ven desde `fecha_alerta` (fecha de Bogotá) hasta que se resuelven: la de evaluación se
-- resuelve sola al cargar el formato de evaluación; la de retorno, al pasar la fecha de retorno.
CREATE TABLE IF NOT EXISTS `alerta_traspaso` (
  `idalerta_traspaso` INT NOT NULL AUTO_INCREMENT,
  `traspaso_id` INT NOT NULL,
  `tipo` VARCHAR(30) NOT NULL,
  `destinatario_users_company_id` INT NULL,
  `fecha_alerta` DATE NOT NULL,
  `mensaje` VARCHAR(255) NOT NULL,
  `creada_por_user_id` INT NULL,
  `leida_en` DATETIME NULL,
  `resuelta_en` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`idalerta_traspaso`),
  KEY `fk_alerta_traspaso` (`traspaso_id`),
  KEY `idx_alerta_destinatario` (`destinatario_users_company_id`, `fecha_alerta`),
  CONSTRAINT `fk_alerta_traspaso` FOREIGN KEY (`traspaso_id`) REFERENCES `traspaso` (`idtraspaso`) ON DELETE CASCADE,
  CONSTRAINT `fk_alerta_destinatario` FOREIGN KEY (`destinatario_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 5. Verificación: 6 tipos, 5 filas de matriz ---------------------------------------------------
SELECT t.`codigo`, t.`nombre`, GROUP_CONCAT(s.`nombre` ORDER BY s.`orden` SEPARATOR ' | ') AS documentos
  FROM `tipo_traspaso` t
  LEFT JOIN `tipo_traspaso_soporte` x ON x.`tipo_traspaso_id` = t.`idtipo_traspaso`
  LEFT JOIN `tipo_soporte_traspaso` s ON s.`idtipo_soporte_traspaso` = x.`tipo_soporte_traspaso_id`
 GROUP BY t.`idtipo_traspaso`, t.`codigo`, t.`nombre`, t.`orden`
 ORDER BY t.`orden`;
