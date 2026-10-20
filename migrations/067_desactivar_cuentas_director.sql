-- =====================================================================
-- 067 — Fin de las cuentas director_operaciones (asistencia.md §26)
--
-- Desde la §23 la gestión de equipo sale de la jerarquía de RRHH (contrato.jefe_area_id) y no
-- de un rol, y desde la §24 cada empleado entra con su cuenta por cédula. Decisión del
-- usuario: los jefes que tenían una cuenta director_operaciones (ej. Kevin Buitrago) pasan a
-- entrar con su cédula como todos, y esas cuentas se desactivan.
--
--   1. users.activo (1 por defecto: ningún otro usuario cambia). El login rechaza activo = 0.
--   2. Desactiva toda cuenta director_operaciones. NO se borran ni se desvinculan: conservan
--      su historial (horarios, aprobaciones, eventos manuales) y la ficha a la que pertenecían.
--
-- Después de correrla: `node scripts/crearCuentasEmpleados.js` (revisar) y `--aplicar`. El
-- script ya no cuenta una cuenta desactivada como "la ficha ya tiene cuenta", así que esas
-- fichas reciben su cuenta por cédula. Entre la migración y el script esos jefes no pueden
-- entrar: correr las dos seguidas.
--
-- Requiere la 065. No es idempotente (ADD COLUMN): correr UNA sola vez.
-- =====================================================================

ALTER TABLE `users`
  ADD COLUMN `activo` TINYINT(1) NOT NULL DEFAULT 1 AFTER `role`;

-- El WHERE por PK > 0 es para el modo "safe updates" de MySQL Workbench.
UPDATE `users` SET `activo` = 0 WHERE `role` = 'director_operaciones' AND `id` > 0;

-- Cuentas desactivadas; las que tienen ficha recibirán su cuenta por cédula con el script.
SELECT u.id, u.username, u.users_company_id, uc.numero_identificacion IS NOT NULL AS tiene_ficha
  FROM `users` u
  LEFT JOIN `users_company` uc ON uc.id = u.users_company_id
 WHERE u.activo = 0;
