-- =====================================================================
-- 062 — Integración AsisLock (login biométrico) → módulo de asistencia
-- Ver asistencia.md §18.
--
-- AsisLock avisa cada login/logout y Gestor lo convierte en eventos de jornada:
--   primer login = entrada; logout antes de la ventana de salida = desconexión (no laborada);
--   siguiente login = fin de la desconexión; logout dentro de la ventana de salida = salida.
--
-- Cambios:
--   1. jornada_evento.tipo  + 'inicio_desconexion', 'fin_desconexion'
--   2. jornada_evento.origen + 'asislock'
--   3. jornada.minutos_desconexion
--   4. asislock_registro: bitácora de cada aviso recibido (idempotencia y auditoría)
--   5. Parámetros de la integración en asistencia_parametro
--
-- MySQL no permite agregar un valor suelto a un ENUM: se reescriben completos, con todos
-- los valores anteriores (044) en el mismo orden y los nuevos al final.
-- No es idempotente (ALTER ... ADD COLUMN falla si se corre dos veces): correr UNA sola vez.
-- =====================================================================

ALTER TABLE `jornada_evento`
  MODIFY COLUMN `tipo` ENUM(
    'entrada','inicio_bano','fin_bano','inicio_almuerzo','fin_almuerzo','salida','inicio_extra','fin_extra',
    'inicio_desconexion','fin_desconexion'
  ) NOT NULL,
  MODIFY COLUMN `origen` ENUM('empleado','director','sistema','asislock') NOT NULL DEFAULT 'empleado';

ALTER TABLE `jornada`
  ADD COLUMN `minutos_desconexion` INT NOT NULL DEFAULT 0 AFTER `minutos_pausa_almuerzo`;

-- ---------------------------------------------------------------------
-- asislock_registro: una fila por evento (login o logout) de cada registro de
-- login_biometrico que envía AsisLock. La pareja (asislock_id, evento) es la llave de
-- idempotencia: un reenvío del mismo registro no duplica eventos.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `asislock_registro` (
  `idasislock_registro` INT NOT NULL AUTO_INCREMENT,
  `asislock_id` INT NOT NULL COMMENT 'login_biometrico.id en AsisLock',
  `evento` ENUM('login','logout') NOT NULL,
  `usuario` VARCHAR(20) NOT NULL COMMENT 'cédula reportada por AsisLock',
  `fecha_reportada` VARCHAR(20) NULL,
  `hora_reportada` VARCHAR(10) NULL,
  `ocurrido_en` DATETIME(3) NULL COMMENT 'instante UTC interpretado (hora de Bogotá)',
  `users_company_id` INT NULL,
  `jornada_id` INT NULL,
  `resultado` ENUM('registrado','ignorado','rechazado') NOT NULL,
  `accion` VARCHAR(20) NULL COMMENT 'entrada | reconexion | desconexion | salida',
  `motivo` VARCHAR(40) NULL,
  `estado_conexion` TINYINT NULL,
  `ip_local` VARCHAR(50) NULL,
  `ip_publica` VARCHAR(50) NULL,
  `aplicativo` VARCHAR(80) NULL,
  `conectado_biometrico` VARCHAR(15) NULL,
  `recibido_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `actualizado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`idasislock_registro`),
  UNIQUE KEY `uq_asislock_registro_evento` (`asislock_id`, `evento`),
  KEY `idx_asislock_registro_usuario` (`usuario`, `recibido_en`),
  KEY `idx_asislock_registro_resultado` (`resultado`, `recibido_en`),
  CONSTRAINT `fk_asislock_registro_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_asislock_registro_jornada`
    FOREIGN KEY (`jornada_id`) REFERENCES `jornada` (`idjornada`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

INSERT INTO `asistencia_parametro` (`clave`, `valor`, `tipo_dato`, `descripcion`) VALUES
('asislock_tolerancia_futuro_min', '5', 'entero', 'AsisLock: minutos de adelanto tolerados en la hora reportada (relojes desfasados)'),
('asislock_max_horas_atraso', '72', 'entero', 'AsisLock: un login/logout con más horas de antigüedad se rechaza');
