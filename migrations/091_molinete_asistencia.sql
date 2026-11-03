-- =====================================================================
-- 091 — Molinete (ZKBioSecurity) → asistencia del staff (asistencia.md §54)
--
-- Las personas de STAFF, ADMINISTRATIVO y TECNOLOGIA marcan su asistencia en el molinete. El
-- Gestor lee la tabla acc_transaction de la base del molinete (PostgreSQL 9.2) cada 2
-- segundos y convierte cada paso en la jornada:
--   primera marcación del día = entrada;
--   las intermedias quedan como "cruces", que NO descuentan tiempo;
--   una salida por el lector de salida dentro de la ventana de salida del horario = salida.
-- Sin salida, el cierre del día la pone en la última marcación del molinete.
--
-- Cambios:
--   1. jornada_evento.origen + 'molinete'
--   2. molinete_marcacion: copia de cada marcación leída (idempotencia, auditoría, cruces)
--   3. Parámetros de la integración en asistencia_parametro
--
-- MySQL no permite agregar un valor suelto a un ENUM: se reescribe completo con los valores de
-- la 062 en el mismo orden. Sin dependencias nuevas: va después de la 062.
-- Idempotente: el ALTER deja el ENUM igual si se corre de nuevo; la tabla usa IF NOT EXISTS y
-- los parámetros INSERT IGNORE.
-- =====================================================================

ALTER TABLE `jornada_evento`
  MODIFY COLUMN `origen` ENUM('empleado','director','sistema','asislock','molinete') NOT NULL DEFAULT 'empleado';

-- ---------------------------------------------------------------------
-- molinete_marcacion: una fila por marcación válida (event_no = 0) de las áreas que marcan
-- por molinete. `unique_key` es la llave única de acc_transaction: un reenvío no duplica.
-- La cédula viene en acc_transaction.last_name (el pin es un código interno del molinete).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `molinete_marcacion` (
  `idmolinete_marcacion` INT NOT NULL AUTO_INCREMENT,
  `unique_key` VARCHAR(100) NOT NULL COMMENT 'acc_transaction.unique_key',
  `pin` VARCHAR(30) NULL COMMENT 'código interno del molinete',
  `cedula` VARCHAR(30) NULL COMMENT 'acc_transaction.last_name',
  `departamento` VARCHAR(60) NULL COMMENT 'acc_transaction.dept_name',
  `lector` VARCHAR(60) NULL COMMENT 'acc_transaction.reader_name (…-In / …-Out)',
  `sentido` ENUM('entrada','salida','desconocido') NOT NULL,
  `ocurrido_en` DATETIME(3) NULL COMMENT 'event_time convertido a UTC',
  `registrado_en_origen` DATETIME(3) NOT NULL COMMENT 'create_time convertido a UTC: marca de agua de la lectura',
  `users_company_id` INT NULL,
  `jornada_id` INT NULL,
  `resultado` ENUM('registrado','ignorado','rechazado') NOT NULL,
  `accion` VARCHAR(20) NULL COMMENT 'entrada | cruce | salida | entrada_extra | fin_extra',
  `motivo` VARCHAR(40) NULL,
  `recibido_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`idmolinete_marcacion`),
  UNIQUE KEY `uq_molinete_marcacion_unique_key` (`unique_key`),
  KEY `idx_molinete_marcacion_origen` (`registrado_en_origen`),
  KEY `idx_molinete_marcacion_empleado` (`users_company_id`, `ocurrido_en`),
  KEY `idx_molinete_marcacion_cedula` (`cedula`, `ocurrido_en`),
  CONSTRAINT `fk_molinete_marcacion_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_molinete_marcacion_jornada`
    FOREIGN KEY (`jornada_id`) REFERENCES `jornada` (`idjornada`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT IGNORE INTO `asistencia_parametro` (`clave`, `valor`, `tipo_dato`, `descripcion`) VALUES
('molinete_departamentos', 'STAFF,ADMINISTRATIVO,TECNOLOGIA', 'texto', 'Molinete: áreas (dept_name) que marcan asistencia por molinete, separadas por coma'),
('molinete_intervalo_seg', '2', 'entero', 'Molinete: cada cuántos segundos se leen las marcaciones nuevas'),
('molinete_solape_seg', '120', 'entero', 'Molinete: segundos hacia atrás que se vuelven a leer en cada pasada (las repetidas se ignoran)');
