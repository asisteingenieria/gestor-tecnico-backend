-- 080 · Auxilio de transporte en el costo de nómina del Home de financiera (asistencia.md §40).
-- Va DESPUÉS de la 079. Idempotente, sin IDs.
--
-- Ley 15 de 1959 y su decreto anual: lo recibe quien gana hasta 2 SMMLV, proporcional a los días.
-- No es salario para aportes a seguridad social, pero SÍ es base de cesantías, intereses sobre
-- cesantías y prima (no de vacaciones). Quien trabaja en casa recibe en su lugar el auxilio de
-- conectividad por el mismo valor (Ley 2088 de 2021): para el costo es lo mismo.
--
-- `salario_minimo.auxilio_transporte`: valor mensual del año. Cada enero se actualiza junto con el
-- SMMLV (si falta el del año, se usa el último cargado).
-- `factor_costo_nomina.incluye_auxilio`: la prestación se calcula sobre salario + auxilio.

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salario_minimo' AND COLUMN_NAME = 'auxilio_transporte');
SET @ddl := IF(@c = 0, 'ALTER TABLE `salario_minimo` ADD COLUMN `auxilio_transporte` DECIMAL(12, 2) NULL AFTER `valor`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factor_costo_nomina' AND COLUMN_NAME = 'incluye_auxilio');
SET @ddl := IF(@c = 0, 'ALTER TABLE `factor_costo_nomina` ADD COLUMN `incluye_auxilio` TINYINT(1) NOT NULL DEFAULT 0 AFTER `exonerable`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE `salario_minimo` SET `auxilio_transporte` = 162000.00 WHERE `anio` = 2024 AND `auxilio_transporte` IS NULL;
UPDATE `salario_minimo` SET `auxilio_transporte` = 200000.00 WHERE `anio` = 2025 AND `auxilio_transporte` IS NULL;
UPDATE `salario_minimo` SET `auxilio_transporte` = 249095.00 WHERE `anio` = 2026 AND `auxilio_transporte` IS NULL;

UPDATE `factor_costo_nomina` SET `incluye_auxilio` = 1 WHERE `codigo` IN ('cesantias', 'intereses_cesantias', 'prima');
