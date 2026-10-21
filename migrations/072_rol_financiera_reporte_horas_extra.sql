-- =====================================================================
-- 072 — Rol `financiera` y reporte mensual de horas extras (asistencia.md §32)
--
-- Reemplaza el Excel "FORMATO REPORTE DE HORAS EXTRAS V.3": cada jefe de área arma en Gestor el
-- reporte del mes de su equipo (con las horas extra aprobadas repartidas en las 5 clases del
-- formato) y lo envía a financiera, que lo aprueba o lo devuelve con una observación.
--
--   1. users.role: agrega `financiera` (administra RRHH y asistencia). MySQL no permite agregar un
--      valor suelto a un ENUM: se reescribe completo (plantilla: 043).
--   2. `periodo_horas_extra`: la fecha límite de cada mes, la fija financiera.
--   3. `reporte_horas_extra`: uno por jefe y mes, con su estado.
--   4. `reporte_horas_extra_detalle`: una fila por empleado, con los datos del empleado tal como
--      estaban al guardar (el reporte enviado no cambia si después cambia la ficha).
--   5. Parámetro `dias_aviso_reporte_horas_extra`: desde cuántos días antes de la fecha límite la
--      campana le recuerda al jefe.
--
-- Idempotente salvo el paso 1, que se puede repetir sin efecto.
-- =====================================================================

-- 1. Rol ---------------------------------------------------------------------------------
ALTER TABLE `users` MODIFY COLUMN `role` ENUM(
    'admin',
    'supervisor',
    'coordinador',
    'jefe_operaciones',
    'technician',
    'administrativo',
    'anonimo',
    'gestorActivos',
    'tecnicoInventario',
    'directivoFinanciero',
    'disenador',
    'recursosHumanos',
    'director_operaciones',
    'empleado',
    'financiera'
) NOT NULL DEFAULT 'technician';

-- 2. Fecha límite por mes -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `periodo_horas_extra` (
  `periodo` CHAR(7) NOT NULL COMMENT 'YYYY-MM: el mes de las horas extra',
  `fecha_limite` DATE NOT NULL COMMENT 'último día para que los jefes envíen el reporte (hora de Colombia)',
  `definido_por_user_id` INT NULL,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`periodo`),
  CONSTRAINT `fk_periodo_horas_extra_user` FOREIGN KEY (`definido_por_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 3. Reporte por jefe y mes -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reporte_horas_extra` (
  `idreporte_horas_extra` INT NOT NULL AUTO_INCREMENT,
  `periodo` CHAR(7) NOT NULL COMMENT 'YYYY-MM',
  `jefe_users_company_id` INT NOT NULL COMMENT 'ficha del jefe de área que reporta',
  `estado` ENUM('borrador','enviado','aprobado','devuelto') NOT NULL DEFAULT 'borrador',
  `enviado_en` DATETIME NULL COMMENT 'UTC, último envío',
  `enviado_por_user_id` INT NULL,
  `enviado_por_cuenta_id` INT NULL,
  `veces_enviado` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `revisado_en` DATETIME NULL COMMENT 'UTC, última aprobación o devolución',
  `revisado_por_user_id` INT NULL,
  `observacion_financiera` VARCHAR(500) NULL COMMENT 'motivo de la última devolución',
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idreporte_horas_extra`),
  UNIQUE KEY `uq_reporte_horas_extra_jefe_periodo` (`jefe_users_company_id`, `periodo`),
  KEY `idx_reporte_horas_extra_periodo` (`periodo`, `estado`),
  CONSTRAINT `fk_reporte_horas_extra_jefe` FOREIGN KEY (`jefe_users_company_id`) REFERENCES `users_company` (`id`),
  CONSTRAINT `fk_reporte_horas_extra_enviado_user` FOREIGN KEY (`enviado_por_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_reporte_horas_extra_enviado_cuenta` FOREIGN KEY (`enviado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL,
  CONSTRAINT `fk_reporte_horas_extra_revisado_user` FOREIGN KEY (`revisado_por_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 4. Una fila por empleado (columnas del formato V.3) -----------------------------------------
CREATE TABLE IF NOT EXISTS `reporte_horas_extra_detalle` (
  `idreporte_horas_extra_detalle` INT NOT NULL AUTO_INCREMENT,
  `reporte_id` INT NOT NULL,
  `users_company_id` INT NULL COMMENT 'NULL si la ficha se borró: los datos quedan copiados abajo',
  `documento` VARCHAR(30) NULL,
  `nombre` VARCHAR(200) NULL,
  `campania` VARCHAR(150) NULL,
  `centro_costo` VARCHAR(150) NULL,
  `cargo` VARCHAR(150) NULL,
  `minutos_aprobados` INT NOT NULL DEFAULT 0 COMMENT 'horas extra aprobadas en el mes, al guardar',
  `recargo_nocturno` DECIMAL(6,2) NOT NULL DEFAULT 0,
  `extras_diurnas` DECIMAL(6,2) NOT NULL DEFAULT 0,
  `extras_nocturnas` DECIMAL(6,2) NOT NULL DEFAULT 0,
  `dominicales_festivas` DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT 'NH Dominicales - Festivas (90%)',
  `extras_dominicales_festivas` DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT 'NH Extras Dominicales - Festivas (115%)',
  `aclaraciones` VARCHAR(1000) NULL,
  PRIMARY KEY (`idreporte_horas_extra_detalle`),
  UNIQUE KEY `uq_reporte_horas_extra_detalle` (`reporte_id`, `users_company_id`),
  CONSTRAINT `fk_reporte_horas_extra_detalle_reporte` FOREIGN KEY (`reporte_id`) REFERENCES `reporte_horas_extra` (`idreporte_horas_extra`) ON DELETE CASCADE,
  CONSTRAINT `fk_reporte_horas_extra_detalle_empleado` FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 5. Parámetro ---------------------------------------------------------------------------------
INSERT IGNORE INTO `asistencia_parametro` (`clave`, `valor`, `tipo_dato`, `descripcion`)
VALUES ('dias_aviso_reporte_horas_extra', '3', 'entero', 'Días antes de la fecha límite en que la campana le recuerda al jefe enviar el reporte de horas extras');
