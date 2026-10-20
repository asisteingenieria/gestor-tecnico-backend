-- =====================================================================
-- 065 — Cuentas de empleado en su propia tabla, fuera de `users` (asistencia.md §24)
--
-- La 063 creaba la cuenta de cada empleado (usuario y contraseña inicial = cédula) dentro de
-- `users`, mezclada con los usuarios del sistema. Desde esta migración esas cuentas viven en
-- `cuenta_empleado` y `users` queda solo con los usuarios que crea el admin.
--
--   1. Crea `cuenta_empleado` (una por ficha de RRHH, usuario = cédula).
--   2. Agrega a las tablas de asistencia una columna de autor `*_por_cuenta_id`, paralela a la
--      `*_por_user_id` que ya tenían: quien actúa puede ser un usuario o una cuenta de empleado.
--   3. Mueve las cuentas que creó la 063 (rol `empleado` cuyo usuario es la cédula de su ficha):
--      conserva la contraseña y la marca de cambio obligatorio, reapunta la auditoría de
--      asistencia y borra la fila de `users`.
--
-- No se mueven (siguen en `users`, como están):
--   - las cuentas vinculadas a mano (director_operaciones, recursosHumanos, empleado1..5 del
--     seed): su usuario no es la cédula;
--   - una cuenta de la 063 que otra tabla fuera de asistencia referencie (incidentes, diseños,
--     Hydra, activos…): borrarla haría CASCADE o fallaría. El SELECT final las lista.
--
-- Requiere la 063. La parte 2 no es idempotente (ADD COLUMN): correr UNA sola vez.
-- La parte 3 sí se puede repetir (solo mueve lo que falte).
-- =====================================================================

-- 1. Tabla de cuentas de empleado ------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cuenta_empleado` (
  `idcuenta_empleado` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `usuario` VARCHAR(50) NOT NULL COMMENT 'cédula de la ficha',
  `password` VARCHAR(255) NOT NULL,
  `debe_cambiar_password` TINYINT(1) NOT NULL DEFAULT 1,
  `ultimo_ingreso` DATETIME NULL,
  `movida_de_user_id` INT NULL COMMENT 'users.id de origen si la cuenta se movió desde users (065); sin FK porque esa fila ya no existe',
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idcuenta_empleado`),
  UNIQUE KEY `uq_cuenta_empleado_ficha` (`users_company_id`),
  UNIQUE KEY `uq_cuenta_empleado_usuario` (`usuario`),
  CONSTRAINT `fk_cuenta_empleado_ficha` FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 2. Autor de los registros de asistencia cuando actúa una cuenta de empleado ------------
ALTER TABLE `horario_plantilla`
  ADD COLUMN `creado_por_cuenta_id` INT NULL AFTER `creado_por_user_id`,
  ADD CONSTRAINT `fk_horario_plantilla_cuenta` FOREIGN KEY (`creado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL;

ALTER TABLE `horario_asignado`
  ADD COLUMN `creado_por_cuenta_id` INT NULL AFTER `creado_por_user_id`,
  ADD CONSTRAINT `fk_horario_asignado_cuenta` FOREIGN KEY (`creado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL;

ALTER TABLE `hora_extra`
  ADD COLUMN `solicitado_por_cuenta_id` INT NULL AFTER `solicitado_por_user_id`,
  ADD COLUMN `aprobado_por_cuenta_id` INT NULL AFTER `aprobado_por_user_id`,
  ADD CONSTRAINT `fk_hora_extra_solicitado_cuenta` FOREIGN KEY (`solicitado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_hora_extra_aprobado_cuenta` FOREIGN KEY (`aprobado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL;

ALTER TABLE `jornada_evento`
  ADD COLUMN `registrado_por_cuenta_id` INT NULL AFTER `registrado_por_user_id`,
  ADD CONSTRAINT `fk_jornada_evento_cuenta` FOREIGN KEY (`registrado_por_cuenta_id`) REFERENCES `cuenta_empleado` (`idcuenta_empleado`) ON DELETE SET NULL;

-- 3. Mover las cuentas de la 063 --------------------------------------------------------
-- Los WHERE por PK > 0 son para el modo "safe updates" de MySQL Workbench.
START TRANSACTION;

INSERT INTO `cuenta_empleado` (`users_company_id`, `usuario`, `password`, `debe_cambiar_password`, `movida_de_user_id`, `creado_en`)
SELECT u.users_company_id, u.username, u.password, u.debe_cambiar_password, u.id, u.created_at
  FROM `users` u
  JOIN `users_company` uc ON uc.id = u.users_company_id
 WHERE u.role = 'empleado'
   AND BINARY u.username = BINARY TRIM(uc.numero_identificacion)
   AND NOT EXISTS (SELECT 1 FROM `cuenta_empleado` ce WHERE ce.users_company_id = u.users_company_id OR BINARY ce.usuario = BINARY u.username)
   -- referencias fuera de asistencia: esas cuentas se quedan en users
   AND NOT EXISTS (SELECT 1 FROM `incidents` x WHERE x.returned_by_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `activos_historial` x WHERE x.modificado_por_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `inventario_observaciones` x WHERE x.realizado_por_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `supervision_alerts` x WHERE x.coordinator_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `diseno_devoluciones` x WHERE x.solicitante_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `disenos` x WHERE x.disenador_id = u.id OR x.solicitante_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `asistencia_parametro` x WHERE x.actualizado_por_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `hydra_lote` x WHERE x.registrado_por_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `hydra_candidato_verificacion` x WHERE x.verificado_por_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `hydra_mapeo_catalogo` x WHERE x.creado_por_user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM `jornada` x WHERE x.ajustada_por_user_id = u.id);

-- Reapuntar la auditoría de asistencia de users.id a la cuenta movida.
UPDATE `horario_plantilla` t JOIN `cuenta_empleado` ce ON ce.movida_de_user_id = t.creado_por_user_id
   SET t.creado_por_cuenta_id = ce.idcuenta_empleado, t.creado_por_user_id = NULL
 WHERE t.idhorario_plantilla > 0;

UPDATE `horario_asignado` t JOIN `cuenta_empleado` ce ON ce.movida_de_user_id = t.creado_por_user_id
   SET t.creado_por_cuenta_id = ce.idcuenta_empleado, t.creado_por_user_id = NULL
 WHERE t.idhorario_asignado > 0;

UPDATE `hora_extra` t JOIN `cuenta_empleado` ce ON ce.movida_de_user_id = t.solicitado_por_user_id
   SET t.solicitado_por_cuenta_id = ce.idcuenta_empleado, t.solicitado_por_user_id = NULL
 WHERE t.idhora_extra > 0;

UPDATE `hora_extra` t JOIN `cuenta_empleado` ce ON ce.movida_de_user_id = t.aprobado_por_user_id
   SET t.aprobado_por_cuenta_id = ce.idcuenta_empleado, t.aprobado_por_user_id = NULL
 WHERE t.idhora_extra > 0;

-- jornada_evento es append-only para la aplicación; esto es solo cambio de autor, una vez.
UPDATE `jornada_evento` t JOIN `cuenta_empleado` ce ON ce.movida_de_user_id = t.registrado_por_user_id
   SET t.registrado_por_cuenta_id = ce.idcuenta_empleado, t.registrado_por_user_id = NULL
 WHERE t.idjornada_evento > 0;

DELETE u FROM `users` u JOIN `cuenta_empleado` ce ON ce.movida_de_user_id = u.id WHERE u.id > 0;

COMMIT;

-- Resumen ------------------------------------------------------------------------------
SELECT COUNT(*) AS cuentas_en_cuenta_empleado FROM `cuenta_empleado`;

-- Cuentas de la 063 que quedaron en users por estar referenciadas fuera de asistencia
-- (resolver a mano; siguen pudiendo entrar con su cédula como antes).
SELECT u.id, u.username, u.users_company_id
  FROM `users` u
  JOIN `users_company` uc ON uc.id = u.users_company_id
 WHERE u.role = 'empleado' AND BINARY u.username = BINARY TRIM(uc.numero_identificacion);
