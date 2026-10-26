-- 081: catálogo `tipo_contrato` sin duplicados.
--
-- La 034 creó `tipo_contrato` sin UNIQUE en `nombre` y el seed de la 035 (INSERT simple) se corrió
-- dos veces: en local quedaron Indefinido/Fijo/Obra o labor/Prestación de servicios/Aprendizaje
-- repetidos (IDs 1-5 y 6-10) y el selector "Tipo de contrato" del alta los mostraba dos veces.
-- Encontrado en la prueba en el navegador del 2026-10-26 (claude/modulo recursoshumanos.md §38).
--
-- Por cada nombre se conserva la fila de menor ID; todo lo que apuntaba a una repetida pasa a ella:
--   - contrato.tipo_contrato_idtipo_contrato (FK fk_contrato_tipo_contrato),
--   - traspaso.tipo_contrato_anterior_id (070, sin FK),
--   - hydra_candidato.datos_empleado -> $.contrato.tipo_contrato_id (JSON del staging de Hydra,
--     059-061; si la tabla no existe se salta).
-- Después se borran las repetidas y se agrega UNIQUE en `nombre` para que no vuelva a pasar.
--
-- Va por nombre, nunca por ID fijo (los IDs de producción no coinciden con los de local, §29.6).
-- Si producción no tiene duplicados, solo agrega el UNIQUE. Se puede correr más de una vez.
-- Las comparaciones son de la tabla consigo misma (mismo collation): no aplica el error 1267.

SET @safe_updates_previo := @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

-- 1. Mapa repetida -> la de menor ID con el mismo nombre ---------------------------------------
DROP TEMPORARY TABLE IF EXISTS `tmp_tipo_contrato_mapa`;
CREATE TEMPORARY TABLE `tmp_tipo_contrato_mapa` (
  `id_duplicado` INT NOT NULL PRIMARY KEY,
  `id_oficial`   INT NOT NULL
);
INSERT INTO `tmp_tipo_contrato_mapa` (`id_duplicado`, `id_oficial`)
SELECT d.`idtipo_contrato`, MIN(o.`idtipo_contrato`)
  FROM `tipo_contrato` d
  JOIN `tipo_contrato` o ON TRIM(o.`nombre`) = TRIM(d.`nombre`) AND o.`idtipo_contrato` < d.`idtipo_contrato`
 GROUP BY d.`idtipo_contrato`;

-- 2. Reasignar las referencias ---------------------------------------------------------------
UPDATE `contrato` c
  JOIN `tmp_tipo_contrato_mapa` m ON m.`id_duplicado` = c.`tipo_contrato_idtipo_contrato`
   SET c.`tipo_contrato_idtipo_contrato` = m.`id_oficial`
 WHERE c.`idcontrato` > 0;

SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'traspaso' AND COLUMN_NAME = 'tipo_contrato_anterior_id');
SET @sql := IF(@existe = 0, 'SELECT 1',
    'UPDATE `traspaso` t
       JOIN `tmp_tipo_contrato_mapa` m ON m.`id_duplicado` = t.`tipo_contrato_anterior_id`
        SET t.`tipo_contrato_anterior_id` = m.`id_oficial`
      WHERE t.`idtraspaso` > 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @existe := (SELECT COUNT(*) FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hydra_candidato');
-- El ID puede venir como número, como texto ("7"), vacío o como null de JSON (que no es NULL de SQL):
-- solo se castea si son dígitos, o el modo estricto rechaza el UPDATE (error 1292).
SET @sql := IF(@existe = 0, 'SELECT 1',
    'UPDATE `hydra_candidato` h
       JOIN `tmp_tipo_contrato_mapa` m
         ON m.`id_duplicado` = CASE
              WHEN JSON_UNQUOTE(JSON_EXTRACT(h.`datos_empleado`, ''$.contrato.tipo_contrato_id'')) REGEXP ''^[0-9]+$''
              THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(h.`datos_empleado`, ''$.contrato.tipo_contrato_id'')) AS UNSIGNED)
            END
        SET h.`datos_empleado` = JSON_SET(h.`datos_empleado`, ''$.contrato.tipo_contrato_id'', m.`id_oficial`)
      WHERE h.`idhydra_candidato` > 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Borrar las repetidas (la FK de contrato es RESTRICT: si quedó algo apuntando, falla aquí) ---
DELETE tc FROM `tipo_contrato` tc
  JOIN `tmp_tipo_contrato_mapa` m ON m.`id_duplicado` = tc.`idtipo_contrato`
 WHERE tc.`idtipo_contrato` > 0;

DROP TEMPORARY TABLE IF EXISTS `tmp_tipo_contrato_mapa`;

-- 4. UNIQUE en `nombre` ----------------------------------------------------------------------
SET @existe := (SELECT COUNT(*) FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tipo_contrato' AND INDEX_NAME = 'uq_tipo_contrato_nombre');
SET @ddl := IF(@existe = 0,
    'ALTER TABLE `tipo_contrato` ADD UNIQUE KEY `uq_tipo_contrato_nombre` (`nombre`)',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Verificación: un solo registro por tipo, con cuántos contratos tiene ------------------------
SELECT tc.`idtipo_contrato`, tc.`nombre`, COUNT(c.`idcontrato`) AS contratos
  FROM `tipo_contrato` tc
  LEFT JOIN `contrato` c ON c.`tipo_contrato_idtipo_contrato` = tc.`idtipo_contrato`
 GROUP BY tc.`idtipo_contrato`, tc.`nombre`
 ORDER BY tc.`idtipo_contrato`;

SET SESSION SQL_SAFE_UPDATES = @safe_updates_previo;
