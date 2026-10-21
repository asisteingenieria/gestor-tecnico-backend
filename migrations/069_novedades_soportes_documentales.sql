-- 069: tipos de novedad oficiales y soportes documentales (PDF o imagen) por novedad.
--
-- Fuente: hoja "Novedades" de Descargas/Criterios (1).xlsx (2026-10-21): 15 tipos de novedad y,
-- por cada uno, cuáles de los 10 soportes documentales aplican ("SI"/"NO"). Al registrar una
-- novedad solo se piden los soportes que aplican a su tipo, y cada uno se carga como archivo.
-- Ver claude/modulo recursoshumanos.md §34.
--
-- - tipo_novedad: columna `vigente`; entran las 4 variantes por días de las incapacidades de
--   origen común y de accidente de tránsito. Las 2 genéricas que venían de la 053 quedan
--   `vigente = 0` (no se borran: una novedad ya registrada puede apuntarles) y conservan como
--   soportes la unión de sus dos variantes.
-- - tipo_soporte_novedad: los 10 soportes (columnas de la hoja).
-- - tipo_novedad_soporte: la matriz SI/NO de la hoja.
-- - novedad_rrhh_soporte: el archivo cargado de cada soporte de cada novedad (uno por soporte).
--   El archivo vive en disco (storage/novedades/, fuera de uploads/, que se sirve sin login) y
--   solo se descarga por la API con sesión de RRHH.
-- Las columnas tiene_* de novedad_rrhh (checkboxes de la 039) quedan en la tabla pero el
-- formulario deja de usarlas.
--
-- Todo va por nombre, nunca por ID. Comparaciones con COLLATE explícito (CLAUDE.md, error 1267).
-- Los WHERE por PK > 0 son para el "safe update mode" de MySQL Workbench. Idempotente.

-- Workbench corre con SQL_SAFE_UPDATES = 1 y en producción rechazó un UPDATE ... JOIN aunque
-- tenía `WHERE <pk> > 0` (error 1175: el optimizador no usó la llave). Se apaga solo durante
-- esta migración y se restaura el valor que tenía la sesión.
SET @safe_updates_previo := @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

-- 1. tipo_novedad.vigente -------------------------------------------------------------------
SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tipo_novedad' AND COLUMN_NAME = 'vigente');
SET @ddl := IF(@existe = 0,
    'ALTER TABLE `tipo_novedad` ADD COLUMN `vigente` TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''1 = se ofrece al registrar novedades (hoja Novedades, migración 069)''',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Catálogo de soportes --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `tipo_soporte_novedad` (
  `idtipo_soporte_novedad` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(80) NOT NULL,
  `orden` INT NOT NULL DEFAULT 0 COMMENT 'orden de la columna en la hoja Novedades',
  PRIMARY KEY (`idtipo_soporte_novedad`),
  UNIQUE KEY `uq_tipo_soporte_novedad_nombre` (`nombre`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT IGNORE INTO `tipo_soporte_novedad` (`nombre`, `orden`) VALUES
  ('Solicitud', 1),
  ('Aprobación', 2),
  ('Formato debidamente firmado', 3),
  ('Certificado de incapacidad', 4),
  ('Epicrisis / Historia clínica', 5),
  ('FURIPS', 6),
  ('FURAT', 7),
  ('Registro civil', 8),
  ('Certificado de defunción', 9),
  ('Documento soporte suspensión', 10);

-- 3. Matriz tipo de novedad → soportes que aplican -------------------------------------------
CREATE TABLE IF NOT EXISTS `tipo_novedad_soporte` (
  `tipo_novedad_id` INT NOT NULL,
  `tipo_soporte_novedad_id` INT NOT NULL,
  PRIMARY KEY (`tipo_novedad_id`, `tipo_soporte_novedad_id`),
  KEY `fk_tns_soporte` (`tipo_soporte_novedad_id`),
  CONSTRAINT `fk_tns_tipo_novedad` FOREIGN KEY (`tipo_novedad_id`) REFERENCES `tipo_novedad` (`idtipo_novedad`) ON DELETE CASCADE,
  CONSTRAINT `fk_tns_soporte` FOREIGN KEY (`tipo_soporte_novedad_id`) REFERENCES `tipo_soporte_novedad` (`idtipo_soporte_novedad`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 4. Archivos cargados -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `novedad_rrhh_soporte` (
  `idnovedad_rrhh_soporte` INT NOT NULL AUTO_INCREMENT,
  `novedad_rrhh_id` INT NOT NULL,
  `tipo_soporte_novedad_id` INT NOT NULL,
  `archivo` VARCHAR(255) NOT NULL COMMENT 'nombre del archivo en storage/novedades/ (generado, no el original)',
  `nombre_original` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(100) NOT NULL,
  `tamano` INT NOT NULL,
  `subido_por_user_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idnovedad_rrhh_soporte`),
  UNIQUE KEY `uq_novedad_soporte` (`novedad_rrhh_id`, `tipo_soporte_novedad_id`),
  KEY `fk_nrs_soporte` (`tipo_soporte_novedad_id`),
  CONSTRAINT `fk_nrs_novedad` FOREIGN KEY (`novedad_rrhh_id`) REFERENCES `novedad_rrhh` (`idnovedad_rrhh`) ON DELETE CASCADE,
  CONSTRAINT `fk_nrs_soporte` FOREIGN KEY (`tipo_soporte_novedad_id`) REFERENCES `tipo_soporte_novedad` (`idtipo_soporte_novedad`) ON DELETE RESTRICT
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 5. Tipos de novedad de la hoja y su matriz -------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS `tmp_novedad_soportes`;
CREATE TEMPORARY TABLE `tmp_novedad_soportes` (
  `tipo`    VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `soporte` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
  `vigente` TINYINT(1) NOT NULL DEFAULT 1
);
INSERT INTO `tmp_novedad_soportes` (`tipo`, `soporte`) VALUES
  ('Vacaciones', 'Solicitud'), ('Vacaciones', 'Aprobación'), ('Vacaciones', 'Formato debidamente firmado'),
  ('Incapacidad Accidente Trabajo', 'Certificado de incapacidad'), ('Incapacidad Accidente Trabajo', 'Epicrisis / Historia clínica'), ('Incapacidad Accidente Trabajo', 'FURAT'),
  ('Incapacidades origen comun 1- 2 días', 'Certificado de incapacidad'),
  ('Incapacidades origen comun 3 días o mas', 'Certificado de incapacidad'), ('Incapacidades origen comun 3 días o mas', 'Epicrisis / Historia clínica'),
  ('Incapacidades accidente de transito 1- 2 días', 'Certificado de incapacidad'), ('Incapacidades accidente de transito 1- 2 días', 'FURIPS'),
  ('Incapacidades accidente de transito 3 días o mas', 'Certificado de incapacidad'), ('Incapacidades accidente de transito 3 días o mas', 'Epicrisis / Historia clínica'), ('Incapacidades accidente de transito 3 días o mas', 'FURIPS'),
  ('Licencia de paternidad', 'Certificado de incapacidad'), ('Licencia de paternidad', 'Epicrisis / Historia clínica'), ('Licencia de paternidad', 'Registro civil'),
  ('Licencia de Maternidad', 'Certificado de incapacidad'), ('Licencia de Maternidad', 'Epicrisis / Historia clínica'), ('Licencia de Maternidad', 'Registro civil'),
  ('Licencia No remunerada', 'Solicitud'), ('Licencia No remunerada', 'Aprobación'), ('Licencia No remunerada', 'Formato debidamente firmado'),
  ('Licencia Remunerada', 'Solicitud'), ('Licencia Remunerada', 'Aprobación'), ('Licencia Remunerada', 'Formato debidamente firmado'),
  ('Licencia por luto', 'Formato debidamente firmado'), ('Licencia por luto', 'Registro civil'), ('Licencia por luto', 'Certificado de defunción'),
  ('Suspensiones', 'Documento soporte suspensión'),
  ('Horas de votacion', 'Solicitud'), ('Horas de votacion', 'Aprobación'), ('Horas de votacion', 'Formato debidamente firmado'),
  ('Licencia Jurado de Votacion', 'Solicitud'), ('Licencia Jurado de Votacion', 'Aprobación'), ('Licencia Jurado de Votacion', 'Formato debidamente firmado'),
  ('Dia de la familia', 'Solicitud'), ('Dia de la familia', 'Aprobación'), ('Dia de la familia', 'Formato debidamente firmado');
-- Las 2 genéricas de la 053 (no vigentes): la unión de sus variantes, por si una novedad vieja las usa.
INSERT INTO `tmp_novedad_soportes` (`tipo`, `soporte`, `vigente`) VALUES
  ('Incapacidades origen comun', 'Certificado de incapacidad', 0), ('Incapacidades origen comun', 'Epicrisis / Historia clínica', 0),
  ('Incapacidades accidente de transito', 'Certificado de incapacidad', 0), ('Incapacidades accidente de transito', 'Epicrisis / Historia clínica', 0),
  ('Incapacidades accidente de transito', 'FURIPS', 0);

INSERT INTO `tipo_novedad` (`categoria`, `nombre`, `vigente`)
SELECT DISTINCT 'CONTRATACION', t.`tipo`, 1
  FROM `tmp_novedad_soportes` t
 WHERE t.`vigente` = 1
   AND NOT EXISTS (SELECT 1 FROM `tipo_novedad` n WHERE n.`nombre` COLLATE utf8mb4_unicode_ci = t.`tipo`);

UPDATE `tipo_novedad` n
   SET n.`vigente` = EXISTS (SELECT 1 FROM `tmp_novedad_soportes` t
                              WHERE t.`vigente` = 1 AND n.`nombre` COLLATE utf8mb4_unicode_ci = t.`tipo`)
 WHERE n.`idtipo_novedad` > 0;

INSERT IGNORE INTO `tipo_novedad_soporte` (`tipo_novedad_id`, `tipo_soporte_novedad_id`)
SELECT n.`idtipo_novedad`, s.`idtipo_soporte_novedad`
  FROM `tmp_novedad_soportes` t
  JOIN `tipo_novedad` n ON n.`nombre` COLLATE utf8mb4_unicode_ci = t.`tipo`
  JOIN `tipo_soporte_novedad` s ON s.`nombre` COLLATE utf8mb4_unicode_ci = t.`soporte`;

DROP TEMPORARY TABLE IF EXISTS `tmp_novedad_soportes`;

-- 6. Verificación: 15 tipos vigentes, 39 filas de matriz para ellos ---------------------------
SELECT n.`nombre` AS tipo_novedad, n.`vigente`,
       GROUP_CONCAT(s.`nombre` ORDER BY s.`orden` SEPARATOR ' | ') AS soportes
  FROM `tipo_novedad` n
  LEFT JOIN `tipo_novedad_soporte` tns ON tns.`tipo_novedad_id` = n.`idtipo_novedad`
  LEFT JOIN `tipo_soporte_novedad` s ON s.`idtipo_soporte_novedad` = tns.`tipo_soporte_novedad_id`
 GROUP BY n.`idtipo_novedad`, n.`nombre`, n.`vigente`
 ORDER BY n.`vigente` DESC, n.`idtipo_novedad`;

SET SESSION SQL_SAFE_UPDATES = @safe_updates_previo;
