-- =====================================================================
-- 085 — Las horas extra las solicita el jefe y las aprueba su director (asistencia.md §51)
--
-- Antes el empleado pedía sus horas extra y las aprobaba su jefe. Ahora el jefe de operaciones (quien
-- gestiona la asistencia del empleado) las solicita por su personal y las aprueba SU jefe, el director:
-- quien gestiona la asistencia del jefe, COALESCE(gestor_asistencia_id, jefe_area_id) de su contrato.
--
-- - hora_extra.solicitante_users_company_id: ficha del jefe que la pidió. NULL = la pidió el empleado
--   con el flujo anterior.
-- - hora_extra.aprobador_users_company_id: ficha del director que la debe aprobar, fijada al pedirla.
--   NULL = flujo anterior: la resuelve quien gestiona al empleado, como siempre (las pendientes que ya
--   existen se quedan con su jefe).
-- - notificacion_asistencia.hora_extra_id: los avisos de la campana también sirven para horas extra.
--
-- Requiere 084 (notificacion_asistencia). No compara texto entre tablas. NO es idempotente: si se
-- corre dos veces da el error 1060 (columna duplicada) y no cambia nada.
-- =====================================================================

ALTER TABLE `hora_extra`
  ADD COLUMN `solicitante_users_company_id` INT NULL COMMENT 'jefe que la solicitó, NULL = la pidió el empleado (flujo anterior)' AFTER `motivo`,
  ADD COLUMN `aprobador_users_company_id` INT NULL COMMENT 'director que la aprueba, NULL = quien gestiona al empleado (flujo anterior)' AFTER `solicitante_users_company_id`,
  ADD KEY `idx_hora_extra_aprobador` (`aprobador_users_company_id`, `estado`),
  ADD KEY `idx_hora_extra_solicitante` (`solicitante_users_company_id`),
  ADD CONSTRAINT `fk_hora_extra_solicitante` FOREIGN KEY (`solicitante_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_hora_extra_aprobador` FOREIGN KEY (`aprobador_users_company_id`) REFERENCES `users_company` (`id`) ON DELETE SET NULL;

ALTER TABLE `notificacion_asistencia`
  ADD COLUMN `hora_extra_id` INT NULL AFTER `solicitud_cambio_turno_id`,
  ADD CONSTRAINT `fk_na_hora_extra` FOREIGN KEY (`hora_extra_id`) REFERENCES `hora_extra` (`idhora_extra`) ON DELETE CASCADE;
