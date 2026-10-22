-- =====================================================================
-- 075 — Usuarios de pantalla gris: no obligar a cambiar la contraseña (asistencia.md §31)
--
-- Los usuarios de la pantalla gris de AsisLock se crean con usuario = cédula y clave = cédula. Para
-- que un agente no quede bloqueado si la olvida, la clave por defecto se deja tal cual y NO se le
-- pide cambiarla. Quien quiera, igual puede cambiarla por su cuenta.
--
--   1. Cambia el DEFAULT de `debe_cambiar_password` a 0 (antes 1, migración 071).
--   2. Apaga la bandera en los usuarios ya creados (los ~390 del backfill del 2026-10-21), para que
--      tampoco se les pida cambiarla.
--
-- No toca las cuentas del portal (`cuenta_empleado`), que sí siguen pidiendo el cambio al primer
-- ingreso. Idempotente.
-- =====================================================================

ALTER TABLE `usuario_pantalla_gris`
    MODIFY COLUMN `debe_cambiar_password` TINYINT(1) NOT NULL DEFAULT 0;

UPDATE `usuario_pantalla_gris` SET `debe_cambiar_password` = 0 WHERE `debe_cambiar_password` = 1;
