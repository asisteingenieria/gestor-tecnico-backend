-- =====================================================================
--  Migracion 046: identificacion secundaria de empleados
--  Algunos empleados extranjeros traen una segunda identificacion
--  (ej. PPT como principal + PAS/PEP/CE como secundaria). El esquema
--  solo soportaba una identificacion por empleado; se agregan dos
--  columnas nullable siguiendo el mismo patron que ya usa la tabla
--  para pares similares (ciudad_nacimiento_id / ciudad_expedicion_id).
--
--  Ejecutar UNA sola vez sobre una BD que ya tiene aplicada la 045.
--  No usa IF NOT EXISTS (no portable a MySQL 5.7/MariaDB antiguos);
--  si se corre dos veces fallara con "Duplicate column name", que es
--  la señal correcta de que ya se aplico.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;

ALTER TABLE `users_company`
  ADD COLUMN `tipo_identificacion_secundaria_id` INT NULL AFTER `tipo_identificacion_idtipo_identificacion`,
  ADD COLUMN `numero_identificacion_secundaria` VARCHAR(20) NULL AFTER `numero_identificacion`;

ALTER TABLE `users_company`
  ADD CONSTRAINT `fk_users_tipo_identificacion_secundaria`
    FOREIGN KEY (`tipo_identificacion_secundaria_id`) REFERENCES `tipo_identificacion` (`idtipo_identificacion`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;

-- ========================= DOWN (rollback) ===========================
-- ALTER TABLE `users_company` DROP FOREIGN KEY `fk_users_tipo_identificacion_secundaria`;
-- ALTER TABLE `users_company` DROP COLUMN `tipo_identificacion_secundaria_id`;
-- ALTER TABLE `users_company` DROP COLUMN `numero_identificacion_secundaria`;
