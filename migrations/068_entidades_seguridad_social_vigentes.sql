-- 068: catálogo oficial de EPS, fondos de pensiones, fondos de cesantías, cajas de
-- compensación y ARL para registrar empleados nuevos.
--
-- Fuente: hoja "EPS AFP CESANTIAS" de Descargas/Criterios (1).xlsx (2026-10-21). Solo las
-- entidades de esa hoja quedan `vigente = 1` y aparecen en los selectores del alta (AgentForm,
-- Contratación Hydra). Ver claude/modulo recursoshumanos.md §33.
--
-- Las entidades distintas que no están en la hoja (Positiva, Colmena, Cafam, Compensar caja,
-- Anas Wayuu...) siguen existiendo con `vigente = 0` porque hay empleados afiliados a ellas; al
-- editar a uno de esos empleados se sigue viendo su entidad.
-- Los duplicados (la misma entidad con otro nombre: EPS "SURA", EPS "Compensar EPS", cesantías
-- "FNA AHORRO") se unifican en la oficial: sus afiliaciones pasan a ella y el duplicado se borra
-- (paso 4b).
-- "SKANDIA. AFPC" (así venía en la hoja) queda "SKANDIA S.A. AFPC", como las demás AFP.
--
-- Todo va por (tipo, nombre), nunca por ID: los IDs de producción no coinciden con los de local
-- (los creó el .sql de los 389 empleados, §29.6). Se puede correr más de una vez.
--
-- Collation: entidad_seguridad_social puede ser utf8mb4_unicode_ci en producción y la tabla
-- temporal toma el default del servidor; las comparaciones entre ellas van con COLLATE
-- explícito (CLAUDE.md, error 1267). Los WHERE por PK > 0 son para el "safe update mode" de
-- MySQL Workbench.

-- 1. Columna `vigente` ---------------------------------------------------------------------
SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entidad_seguridad_social' AND COLUMN_NAME = 'vigente');
SET @ddl := IF(@existe = 0,
    'ALTER TABLE `entidad_seguridad_social` ADD COLUMN `vigente` TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''1 = se ofrece al registrar empleados (hoja EPS AFP CESANTIAS, migración 068)'' AFTER `codigo`',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Renombrar al nombre oficial las entidades que ya existen con otro nombre ----------------
--    (misma entidad; los empleados afiliados conservan su afiliación)
UPDATE `entidad_seguridad_social` SET `nombre` = 'ALIANSALUD EPS (ANTES COLMEDICA)'  WHERE `tipo` = 'EPS' AND `nombre` = 'ALIANSALUD EPS' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'COOSALUD EPS'                      WHERE `tipo` = 'EPS' AND `nombre` = 'Coosalud' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'EPS SURA (ANTES SUSALUD)'          WHERE `tipo` = 'EPS' AND `nombre` = 'EPS Sura' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'MUTUAL SER'                        WHERE `tipo` = 'EPS' AND `nombre` = 'MUTUALSER' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'NUEVA EPS'                         WHERE `tipo` = 'EPS' AND `nombre` = 'Nueva EPS' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'SALUD TOTAL EPS'                   WHERE `tipo` = 'EPS' AND `nombre` = 'Salud Total' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'SANITAS EPS'                       WHERE `tipo` = 'EPS' AND `nombre` = 'Sanitas' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'FAMISANAR EPS CAFAM - COLSUBSIDIO' WHERE `tipo` = 'EPS' AND `nombre` = 'Famisanar' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'SERVICIO OCCIDENTAL DE SALUD'      WHERE `tipo` = 'EPS' AND `nombre` = 'SERVICIO OCCIDENTAL DE SALUD S.A. S.O.S.' AND `identidad_seguridad_social` > 0;

UPDATE `entidad_seguridad_social` SET `nombre` = 'COLFONDOS S.A. AFPC'  WHERE `tipo` = 'AFP' AND `nombre` = 'Colfondos' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'PORVENIR S.A. AFPC'   WHERE `tipo` = 'AFP' AND `nombre` = 'Porvenir' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'PROTECCIÓN S.A. AFPC' WHERE `tipo` = 'AFP' AND `nombre` = 'Protección' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'COLPENSIONES'         WHERE `tipo` = 'AFP' AND `nombre` = 'Colpensiones' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'SKANDIA S.A. AFPC'    WHERE `tipo` = 'AFP' AND `nombre` IN ('Skandia', 'SKANDIA. AFPC') AND `identidad_seguridad_social` > 0;

UPDATE `entidad_seguridad_social` SET `nombre` = 'COLFONDOS S.A. AFPC'       WHERE `tipo` = 'CESANTIAS' AND `nombre` = 'COLFONDOS' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'PORVENIR S.A. AFPC'        WHERE `tipo` = 'CESANTIAS' AND `nombre` = 'Porvenir Cesantías' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'PROTECCIÓN S.A. AFPC'      WHERE `tipo` = 'CESANTIAS' AND `nombre` = 'Protección Cesantías' AND `identidad_seguridad_social` > 0;
UPDATE `entidad_seguridad_social` SET `nombre` = 'FONDO NACIONAL DEL AHORRO' WHERE `tipo` = 'CESANTIAS' AND `nombre` = 'Fondo Nacional del Ahorro' AND `identidad_seguridad_social` > 0;

UPDATE `entidad_seguridad_social` SET `nombre` = 'CAJA COLOMBIANA DE SUBSIDIO FAMILIAR COLSUBSIDIO' WHERE `tipo` = 'CAJA' AND `nombre` = 'Colsubsidio' AND `identidad_seguridad_social` > 0;

UPDATE `entidad_seguridad_social` SET `nombre` = 'ARL SURA' WHERE `tipo` = 'ARL' AND `nombre` = 'ARL Sura' AND `identidad_seguridad_social` > 0;

-- 3. Lista oficial (la hoja tal cual, sin espacios sobrantes) --------------------------------
DROP TEMPORARY TABLE IF EXISTS `tmp_entidades_oficiales`;
CREATE TEMPORARY TABLE `tmp_entidades_oficiales` (
  `tipo`   VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `nombre` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
);
INSERT INTO `tmp_entidades_oficiales` (`tipo`, `nombre`) VALUES
  ('EPS', 'ALIANSALUD EPS (ANTES COLMEDICA)'),
  ('EPS', 'ASMET SALUD EPS SAS'),
  ('EPS', 'ASOCIACION INDIGENA DEL CAUCA EPSI'),
  ('EPS', 'CAJACOPI'),
  ('EPS', 'CAPITAL SALUD'),
  ('EPS', 'COMPENSAR'),
  ('EPS', 'COOMEVA EPS'),
  ('EPS', 'COOSALUD EPS'),
  ('EPS', 'COOSALUD MOVILIDAD'),
  ('EPS', 'DUSAKAWI EPSIDUSA'),
  ('EPS', 'EMSSANAR E.S.S.'),
  ('EPS', 'EPS SURA (ANTES SUSALUD)'),
  ('EPS', 'MUTUAL SER'),
  ('EPS', 'NUEVA EPS'),
  ('EPS', 'NUEVA EPS MOVILIDAD'),
  ('EPS', 'SALUD TOTAL EPS'),
  ('EPS', 'SANITAS EPS'),
  ('EPS', 'FAMISANAR EPS CAFAM - COLSUBSIDIO'),
  ('EPS', 'SERVICIO OCCIDENTAL DE SALUD'),
  ('AFP', 'COLFONDOS S.A. AFPC'),
  ('AFP', 'PORVENIR S.A. AFPC'),
  ('AFP', 'PROTECCIÓN S.A. AFPC'),
  ('AFP', 'FONDO NACIONAL DEL AHORRO'),
  ('AFP', 'COLPENSIONES'),
  ('AFP', 'SKANDIA S.A. AFPC'),
  ('CESANTIAS', 'COLFONDOS S.A. AFPC'),
  ('CESANTIAS', 'PORVENIR S.A. AFPC'),
  ('CESANTIAS', 'PROTECCIÓN S.A. AFPC'),
  ('CESANTIAS', 'FONDO NACIONAL DEL AHORRO'),
  ('CAJA', 'CAJA COLOMBIANA DE SUBSIDIO FAMILIAR COLSUBSIDIO'),
  ('CAJA', 'COMFAMILIAR ATLANTICO'),
  ('ARL', 'ARL SURA');

-- 4. Insertar las que faltan -----------------------------------------------------------------
INSERT INTO `entidad_seguridad_social` (`tipo`, `nombre`, `vigente`)
SELECT t.`tipo`, t.`nombre`, 1
  FROM `tmp_entidades_oficiales` t
 WHERE NOT EXISTS (
       SELECT 1 FROM `entidad_seguridad_social` e
        WHERE e.`tipo` COLLATE utf8mb4_unicode_ci = t.`tipo`
          AND e.`nombre` COLLATE utf8mb4_unicode_ci = t.`nombre`);

-- 4b. Unificar duplicados en la entidad oficial ------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS `tmp_entidades_duplicadas`;
CREATE TEMPORARY TABLE `tmp_entidades_duplicadas` (
  `tipo`      VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `duplicado` VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `oficial`   VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
);
INSERT INTO `tmp_entidades_duplicadas` (`tipo`, `duplicado`, `oficial`) VALUES
  ('EPS', 'SURA', 'EPS SURA (ANTES SUSALUD)'),
  ('EPS', 'Compensar EPS', 'COMPENSAR'),
  ('CESANTIAS', 'FNA AHORRO', 'FONDO NACIONAL DEL AHORRO');

UPDATE `seguridad_social` s
  JOIN `entidad_seguridad_social` dup ON dup.`identidad_seguridad_social` = s.`entidad_seguridad_social_id`
  JOIN `tmp_entidades_duplicadas` d ON dup.`tipo` COLLATE utf8mb4_unicode_ci = d.`tipo` AND dup.`nombre` COLLATE utf8mb4_unicode_ci = d.`duplicado`
  JOIN `entidad_seguridad_social` ofi ON ofi.`tipo` COLLATE utf8mb4_unicode_ci = d.`tipo` AND ofi.`nombre` COLLATE utf8mb4_unicode_ci = d.`oficial`
   SET s.`entidad_seguridad_social_id` = ofi.`identidad_seguridad_social`
 WHERE s.`idseguridad_social` > 0;

UPDATE `seguridad_social` s
  JOIN `entidad_seguridad_social` dup ON dup.`identidad_seguridad_social` = s.`entidad_anterior_id`
  JOIN `tmp_entidades_duplicadas` d ON dup.`tipo` COLLATE utf8mb4_unicode_ci = d.`tipo` AND dup.`nombre` COLLATE utf8mb4_unicode_ci = d.`duplicado`
  JOIN `entidad_seguridad_social` ofi ON ofi.`tipo` COLLATE utf8mb4_unicode_ci = d.`tipo` AND ofi.`nombre` COLLATE utf8mb4_unicode_ci = d.`oficial`
   SET s.`entidad_anterior_id` = ofi.`identidad_seguridad_social`
 WHERE s.`idseguridad_social` > 0;

-- Solo se borra el duplicado que ya no tiene afiliaciones (las FK son RESTRICT de todos modos).
DELETE e FROM `entidad_seguridad_social` e
  JOIN `tmp_entidades_duplicadas` d ON e.`tipo` COLLATE utf8mb4_unicode_ci = d.`tipo` AND e.`nombre` COLLATE utf8mb4_unicode_ci = d.`duplicado`
 WHERE e.`identidad_seguridad_social` > 0
   AND NOT EXISTS (SELECT 1 FROM `seguridad_social` s
                    WHERE s.`entidad_seguridad_social_id` = e.`identidad_seguridad_social`
                       OR s.`entidad_anterior_id` = e.`identidad_seguridad_social`);

DROP TEMPORARY TABLE IF EXISTS `tmp_entidades_duplicadas`;

-- 5. Solo las oficiales quedan vigentes ------------------------------------------------------
UPDATE `entidad_seguridad_social` e
   SET e.`vigente` = EXISTS (
       SELECT 1 FROM `tmp_entidades_oficiales` t
        WHERE e.`tipo` COLLATE utf8mb4_unicode_ci = t.`tipo`
          AND e.`nombre` COLLATE utf8mb4_unicode_ci = t.`nombre`)
 WHERE e.`identidad_seguridad_social` > 0;

DROP TEMPORARY TABLE IF EXISTS `tmp_entidades_oficiales`;

-- 6. Verificación: 19 EPS, 6 AFP, 4 CESANTIAS, 2 CAJA, 1 ARL vigentes ------------------------
SELECT `tipo`, SUM(`vigente`) AS vigentes, SUM(1 - `vigente`) AS no_vigentes
  FROM `entidad_seguridad_social` GROUP BY `tipo` ORDER BY `tipo`;
