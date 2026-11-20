-- =====================================================================
-- 108 — Ajuste del saldo del pasivo vacacional por financiera (claude/modulo recursoshumanos.md §58.2)
--
-- Financiera corrige desde la pantalla los casos puntuales: fecha de corte, días disfrutados y días
-- compensados al corte de un empleado (con o sin fila del Excel). Se guarda:
--   - en vacaciones_saldo: de dónde viene el saldo (`origen` excel | financiera), la nota y quién/cuándo
--     lo ajustó por última vez;
--   - en vacaciones_saldo_ajuste: el historial de cada ajuste con los valores antes y después.
-- scripts/cargarPasivoVacacional.js no pisa un saldo con origen 'financiera' (salvo --forzar).
--
-- Idempotente. Va ANTES del código (el modelo nombra las columnas). Requiere la 106.
-- =====================================================================

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'vacaciones_saldo' AND COLUMN_NAME = 'origen') = 0,
  'ALTER TABLE vacaciones_saldo
     ADD COLUMN origen ENUM(''excel'',''financiera'') NOT NULL DEFAULT ''excel'' AFTER dias_compensados,
     ADD COLUMN nota VARCHAR(500) NULL AFTER origen,
     ADD COLUMN ajustado_por_user_id INT NULL AFTER nota,
     ADD COLUMN ajustado_en DATETIME NULL AFTER ajustado_por_user_id',
  'SELECT ''vacaciones_saldo ya tiene las columnas de ajuste'' AS aviso');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `vacaciones_saldo_ajuste` (
  `idvacaciones_saldo_ajuste` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  -- Valores antes del ajuste (NULL si el empleado no tenía saldo: venía "con observación").
  `fecha_corte_antes` DATE NULL,
  `dias_disfrutados_antes` DECIMAL(7,2) NULL,
  `dias_compensados_antes` DECIMAL(7,2) NULL,
  `fecha_corte` DATE NOT NULL,
  `dias_disfrutados` DECIMAL(7,2) NOT NULL,
  `dias_compensados` DECIMAL(7,2) NOT NULL,
  `nota` VARCHAR(500) NOT NULL,
  `user_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`idvacaciones_saldo_ajuste`),
  KEY `ix_vacaciones_saldo_ajuste_empleado` (`users_company_id`),
  CONSTRAINT `fk_vacaciones_saldo_ajuste_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
