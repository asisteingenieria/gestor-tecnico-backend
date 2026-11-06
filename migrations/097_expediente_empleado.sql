-- 097: Expediente documental del empleado (claude/modulo recursoshumanos.md §49).
--
-- Replica la estructura de carpetas de Gestión Humana (carpeta compartida "ALTAS FORMATO") en
-- storage/expedientes/ del servidor:
--
--   <año de ingreso>/<APELLIDOS NOMBRES>/1.SELECCION
--                                       /2.DOCUMENTOS
--                                       /3.CONTRATO
--                                       /4.SST
--                                       /5.RELACIONES LABORALES
--                                       /6.NOVEDADES/<INC|LNR|LR|VACACIONES|...>
--                                       /OTROS   (lo que en la compartida estaba fuera de las seis)
--
-- * users_company.expediente_carpeta: "<año>/<APELLIDOS NOMBRES>", relativa a storage/expedientes/.
--   La fija la copia inicial (scripts/registrarExpedientes.js) o el alta del empleado. Se guarda y
--   no se recalcula: si después se corrige el nombre en la ficha, la carpeta no se mueve.
-- * empleado_archivo: un registro por archivo, asociado a su ficha. `ruta` es relativa a
--   storage/expedientes/ y única. Los archivos de la copia inicial cuya carpeta no tiene ficha se
--   copian al disco pero no se registran: se asocian al volver a correr el registro cuando exista
--   la ficha.
--
-- Va ANTES del código (la ficha consulta empleado_archivo). Idempotente.

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users_company'
      AND COLUMN_NAME = 'expediente_carpeta'
);
SET @sql := IF(@existe = 0,
    'ALTER TABLE users_company ADD COLUMN expediente_carpeta VARCHAR(300) NULL COMMENT ''<año>/<APELLIDOS NOMBRES> dentro de storage/expedientes/ (migración 097)''',
    'SELECT ''expediente_carpeta ya existe''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `empleado_archivo` (
  `idempleado_archivo` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `categoria` ENUM('seleccion', 'documentos', 'contrato', 'sst', 'relaciones_laborales', 'novedades', 'otros') NOT NULL,
  `subcarpeta` VARCHAR(255) NULL COMMENT 'ruta dentro de la categoría, sin el archivo (p. ej. INC en novedades)',
  `nombre` VARCHAR(255) NOT NULL COMMENT 'nombre del archivo, el mismo que en disco',
  `ruta` VARCHAR(700) NOT NULL COMMENT 'relativa a storage/expedientes/',
  `mime` VARCHAR(100) NOT NULL,
  `tamano` BIGINT UNSIGNED NOT NULL,
  `sha256` CHAR(64) NULL,
  `origen` ENUM('migracion', 'sistema') NOT NULL DEFAULT 'sistema' COMMENT 'migracion = copia de la carpeta compartida',
  `subido_por_user_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`idempleado_archivo`),
  UNIQUE KEY `uq_empleado_archivo_ruta` (`ruta`),
  KEY `idx_empleado_archivo_empleado` (`users_company_id`, `categoria`),
  CONSTRAINT `fk_empleado_archivo_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
