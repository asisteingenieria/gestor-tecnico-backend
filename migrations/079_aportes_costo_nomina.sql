-- 079 · Aportes de seguridad social y parafiscales en el costo de nómina del Home de financiera
-- (asistencia.md §39). Va DESPUÉS de la 078. Idempotente, sin IDs.
--
-- Aportes a cargo del empleador sobre el IBC (salario básico; los bonos no salariales solo suman
-- en lo que pasen del 40 % de la remuneración, Ley 1393 de 2010 art. 30):
--   salud 8,5 % · pensión 12 % · ARL según la tarifa de cada empleado · caja de compensación 4 %
--   · ICBF 3 % · SENA 2 %.
-- `exonerable = 1`: salud, ICBF y SENA no se pagan por quien gana menos de 10 SMMLV (exoneración
-- del art. 114-1 del Estatuto Tributario). Si la empresa NO aplica la exoneración, se apaga con:
--   UPDATE factor_costo_nomina SET exonerable = 0 WHERE codigo IN ('salud','icbf','sena');
-- ARL: se usa `seguridad_social.tarifa_arl` del empleado (afiliación ARL activa); el porcentaje de
-- aquí (clase I, 0,522 %) es el respaldo cuando el empleado no la tiene o es inválida.
--
-- `salario_minimo`: SMMLV por año, para el tope de la exoneración. Cada enero hay que agregar el
-- del año nuevo (si falta, se usa el último cargado).

ALTER TABLE `factor_costo_nomina`
    MODIFY `categoria` ENUM('prestacion', 'aporte') NOT NULL DEFAULT 'prestacion';

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factor_costo_nomina' AND COLUMN_NAME = 'exonerable');
SET @ddl := IF(@c = 0, 'ALTER TABLE `factor_costo_nomina` ADD COLUMN `exonerable` TINYINT(1) NOT NULL DEFAULT 0 AFTER `porcentaje`', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

INSERT INTO `factor_costo_nomina` (`codigo`, `nombre`, `categoria`, `porcentaje`, `exonerable`, `orden`) VALUES
    ('salud',   'Salud',                    'aporte', 8.500,  1, 11),
    ('pension', 'Pensión',                  'aporte', 12.000, 0, 12),
    ('arl',     'ARL',                      'aporte', 0.522,  0, 13),
    ('caja',    'Caja de compensación',     'aporte', 4.000,  0, 14),
    ('icbf',    'ICBF',                     'aporte', 3.000,  1, 15),
    ('sena',    'SENA',                     'aporte', 2.000,  1, 16)
ON DUPLICATE KEY UPDATE `codigo` = `codigo`;

CREATE TABLE IF NOT EXISTS `salario_minimo` (
    `anio` SMALLINT NOT NULL,
    `valor` DECIMAL(12, 2) NOT NULL,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`anio`)
);

INSERT INTO `salario_minimo` (`anio`, `valor`) VALUES
    (2024, 1300000.00),
    (2025, 1423500.00),
    (2026, 1750905.00)
ON DUPLICATE KEY UPDATE `anio` = `anio`;
