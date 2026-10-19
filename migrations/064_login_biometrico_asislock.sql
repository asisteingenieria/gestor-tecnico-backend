-- =====================================================================
-- 064 — Copia en Gestor de login_biometrico de AsisLock + id opcional
-- Ver asistencia.md §21.
--
-- AsisLock envía filas de su tabla de sesiones (062, POST /registros). Hasta ahora Gestor
-- solo guardaba asislock_registro: una fila por evento (login o logout) con lo que hizo con
-- él. Esta migración:
--   1. Crea login_biometrico: la sesión tal como la envía AsisLock (mismas columnas), una
--      fila por sesión. El id de AsisLock queda en asislock_id.
--   2. Hace opcional el id de AsisLock: otro sistema envía sin él. La identidad de cada fila
--      pasa a `llave`: 'id:<id>' si vino el id; si no, cédula + fecha + hora
--      ('cc:<cédula>|<fecha>|<hora>'). La calcula domain/asistencia/asislock.js.
--   3. asislock_registro: misma llave (la unicidad pasa de (asislock_id, evento) a
--      (llave, evento)), asislock_id admite NULL y estado_conexion pasa de TINYINT a
--      VARCHAR(20), como en AsisLock.
--
-- Diferencias deliberadas de login_biometrico con la tabla de AsisLock:
--   - usuario VARCHAR(20) (AsisLock: 11): es el máximo que acepta la API.
--   - hora_login/hora_logout normalizadas a HH:MM:SS; una hora inválida queda NULL aquí y
--     cruda en asislock_registro.
--
-- Requiere la 062. No es idempotente (ADD COLUMN): correr UNA sola vez.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `login_biometrico` (
  `idlogin_biometrico` INT NOT NULL AUTO_INCREMENT,
  `llave` VARCHAR(80) NOT NULL COMMENT 'id:<id de AsisLock> o cc:<cédula>|<fecha>|<hora_login>',
  `asislock_id` INT NULL COMMENT 'id de la fila en AsisLock, NULL si el sistema no lo envía',
  `usuario` VARCHAR(20) NOT NULL COMMENT 'cédula reportada por AsisLock',
  `fecha` VARCHAR(20) NOT NULL,
  `hora_login` TIME NULL,
  `hora_logout` TIME NULL,
  `estado_conexion` VARCHAR(20) NULL,
  `ip_local` VARCHAR(50) NULL,
  `ip_publica` VARCHAR(50) NULL,
  `aplicativo` VARCHAR(80) NULL,
  `conectado_biometrico` VARCHAR(15) NULL,
  `recibido_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`idlogin_biometrico`),
  UNIQUE KEY `uq_login_biometrico_llave` (`llave`),
  KEY `idx_login_biometrico_asislock_id` (`asislock_id`),
  KEY `idx_login_biometrico_usuario_fecha` (`usuario`, `fecha`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

ALTER TABLE `asislock_registro`
  ADD COLUMN `llave` VARCHAR(80) NULL AFTER `idasislock_registro`,
  MODIFY COLUMN `asislock_id` INT NULL COMMENT 'id de la fila en AsisLock, NULL si el sistema no lo envía',
  MODIFY COLUMN `estado_conexion` VARCHAR(20) NULL;

-- Los avisos ya recibidos (062) siempre traían id. El WHERE por PK es para el modo
-- "safe updates" de MySQL Workbench.
UPDATE `asislock_registro` SET `llave` = CONCAT('id:', `asislock_id`) WHERE `idasislock_registro` > 0;

ALTER TABLE `asislock_registro`
  MODIFY COLUMN `llave` VARCHAR(80) NOT NULL COMMENT 'id:<id de AsisLock> o cc:<cédula>|<fecha>|<hora del evento>',
  DROP INDEX `uq_asislock_registro_evento`,
  ADD UNIQUE KEY `uq_asislock_registro_evento` (`llave`, `evento`);
