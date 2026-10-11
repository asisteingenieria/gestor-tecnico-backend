-- Migración 061: outbox hacia Hydra y auditoría de peticiones entrantes
-- Motor: InnoDB | Charset: utf8mb4
-- Ver conexionhydra.md §4.3, §5.3 y §7.1.
--
-- Idempotente (IF NOT EXISTS).

-- ---------------------------------------------------------------------
-- hydra_envio_saliente: avisos pendientes de entregar a Hydra (patrón outbox)
-- ---------------------------------------------------------------------
-- Se inserta en la MISMA transacción que registra al empleado; un proceso aparte
-- (scripts/despacharEnviosHydra.js) lo entrega con reintentos. Si Hydra está caído,
-- la contratación en Gestor no se revierte ni se pierde el aviso.
CREATE TABLE IF NOT EXISTS `hydra_envio_saliente` (
  `idhydra_envio_saliente` INT NOT NULL AUTO_INCREMENT,
  `tipo` ENUM('candidato_registrado','candidato_descartado') NOT NULL,
  `hydra_candidato_externo_id` INT UNSIGNED NOT NULL,
  `payload` JSON NOT NULL,
  `idempotency_key` CHAR(36) NOT NULL COMMENT 'UUID v4; Hydra no aplica dos veces la misma',
  `estado` ENUM('pendiente','enviado','fallido') NOT NULL DEFAULT 'pendiente',
  `intentos` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `proximo_intento` DATETIME NOT NULL COMMENT 'UTC',
  `ultimo_error` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_envio_saliente`),
  UNIQUE KEY `uq_hydra_envio_idempotency` (`idempotency_key`),
  KEY `idx_hydra_envio_pendiente` (`estado`, `proximo_intento`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- hydra_peticion_entrante: auditoría + respuesta guardada por Idempotency-Key
-- ---------------------------------------------------------------------
-- NO guarda el cuerpo de la petición: trae cédula, dirección, EPS (datos personales,
-- Ley 1581 de 2012). Solo su hash, para detectar que una misma Idempotency-Key
-- llegó con un cuerpo distinto.
CREATE TABLE IF NOT EXISTS `hydra_peticion_entrante` (
  `idhydra_peticion_entrante` INT NOT NULL AUTO_INCREMENT,
  `idempotency_key` VARCHAR(64) NOT NULL,
  `endpoint` VARCHAR(120) NOT NULL,
  `hash_cuerpo` CHAR(64) NOT NULL,
  `codigo_respuesta` SMALLINT UNSIGNED NOT NULL,
  `respuesta` JSON NULL COMMENT 'Se devuelve tal cual si llega de nuevo la misma Idempotency-Key',
  `ip_origen` VARCHAR(45) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_peticion_entrante`),
  UNIQUE KEY `uq_hydra_peticion_idempotency` (`idempotency_key`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
