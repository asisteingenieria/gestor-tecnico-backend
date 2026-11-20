-- =====================================================================
-- 106 — Saldo de vacaciones por empleado para el pasivo vacacional calculado
--       (claude/modulo recursoshumanos.md §58)
--
-- El pasivo se calcula como en el Excel de Gestión Humana:
--   días trabajados = DAYS360(ingreso, fecha) + 1
--   días acumulados = días trabajados × 15 / 360
--   pasivo          = acumulados − disfrutados − compensados
--   total           = pasivo − vacaciones programadas
-- Lo que el sistema no sabe es la historia de días disfrutados antes de que existieran las novedades de
-- Vacaciones. Esa historia entra una sola vez desde el Excel "pasivo vacacional" (scripts/cargarPasivoVacacional.js):
-- `fecha_corte` + `dias_disfrutados_corte`. Desde el corte, los disfrutados suman las novedades de Vacaciones.
-- `dias_compensados` = días compensados al corte (del Excel); los posteriores salen de las novedades de Vacaciones
-- con modalidad compensadas (migración 107, §59).
--
-- Idempotente. Sin dependencias de texto entre tablas (sin riesgo del error 1267 de collation).
-- =====================================================================

CREATE TABLE IF NOT EXISTS `vacaciones_saldo` (
  `idvacaciones_saldo` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  -- Día del Excel de corte.
  `fecha_corte` DATE NULL,
  `dias_disfrutados_corte` DECIMAL(7,2) NOT NULL DEFAULT 0,
  -- Vacaciones programadas que traía el Excel en el corte; solo de referencia (las programadas salen de las novedades).
  `dias_programados_corte` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `dias_compensados` DECIMAL(7,2) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idvacaciones_saldo`),
  UNIQUE KEY `ux_vacaciones_saldo_empleado` (`users_company_id`),
  CONSTRAINT `fk_vacaciones_saldo_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
