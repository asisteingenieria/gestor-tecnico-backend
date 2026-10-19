-- =====================================================================
-- 063 — Cuentas de empleado automáticas (asistencia.md §19)
--
-- Toda ficha de RRHH tiene su usuario de empleado (usuario = cédula, contraseña inicial =
-- cédula) para ver su módulo de asistencia. Como esa contraseña inicial es adivinable, la
-- cuenta nace marcada para cambiarla en el primer ingreso: mientras la marca esté en 1, el
-- backend solo deja llamar a cambiar contraseña.
--
-- Solo agrega una columna; las cuentas de las fichas ya existentes las crea
-- scripts/crearCuentasEmpleados.js (las nuevas se crean solas al registrar el empleado).
-- Se puede correr dos veces sin error.
-- =====================================================================

SET @existe := (SELECT COUNT(*) FROM information_schema.columns
                 WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'debe_cambiar_password');
SET @sql := IF(@existe = 0,
  'ALTER TABLE `users` ADD COLUMN `debe_cambiar_password` TINYINT(1) NOT NULL DEFAULT 0 AFTER `password`',
  'SELECT ''users.debe_cambiar_password ya existía'' AS aviso');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
