-- =====================================================================
-- 066 — Cada jefe ve solo sus plantillas de horario (asistencia.md §25)
--
-- Hasta ahora horario_plantilla era global: cualquier jefe veía, editaba y eliminaba las de
-- los demás. Desde la §23 todo jefe de área gestiona su equipo, así que cada plantilla pasa a
-- tener dueño: la ficha de RRHH (users_company) de quien la creó. Es la ficha y no la cuenta
-- para que una misma persona vea sus plantillas entre con su usuario del sistema o con su
-- cuenta de empleado por cédula.
--
-- Las plantillas existentes toman como dueño la ficha de su creador (usuario vinculado o
-- cuenta de empleado). Las que no tengan a quién asignarse quedan sin dueño y nadie las ve; el
-- SELECT final las lista. Los horarios ya asignados no cambian: guardan sus propias horas.
--
-- Requiere la 065. No es idempotente (ADD COLUMN): correr UNA sola vez.
-- =====================================================================

ALTER TABLE `horario_plantilla`
  ADD COLUMN `dueno_users_company_id` INT NULL COMMENT 'ficha del jefe dueño de la plantilla' AFTER `activo`,
  ADD KEY `idx_horario_plantilla_dueno` (`dueno_users_company_id`, `activo`),
  ADD CONSTRAINT `fk_horario_plantilla_dueno` FOREIGN KEY (`dueno_users_company_id`) REFERENCES `users_company` (`id`);

-- Los WHERE por PK > 0 son para el modo "safe updates" de MySQL Workbench.
UPDATE `horario_plantilla` p JOIN `users` u ON u.id = p.creado_por_user_id
   SET p.dueno_users_company_id = u.users_company_id
 WHERE p.idhorario_plantilla > 0 AND p.dueno_users_company_id IS NULL;

UPDATE `horario_plantilla` p JOIN `cuenta_empleado` ce ON ce.idcuenta_empleado = p.creado_por_cuenta_id
   SET p.dueno_users_company_id = ce.users_company_id
 WHERE p.idhorario_plantilla > 0 AND p.dueno_users_company_id IS NULL;

-- Plantillas activas que quedaron sin dueño (nadie las verá): asignarlas a mano si hace falta.
SELECT idhorario_plantilla, nombre, creado_por_user_id, creado_por_cuenta_id
  FROM `horario_plantilla`
 WHERE activo = 1 AND dueno_users_company_id IS NULL;
