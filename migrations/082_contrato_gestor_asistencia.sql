-- =====================================================================
-- 082 — Quién gestiona la asistencia de un empleado, distinto de su jefe de área (asistencia.md §44)
--
-- En asistencia, el jefe de área (`contrato.jefe_area_id`) es quien asigna horarios, aprueba horas
-- extra y recibe los avisos en vivo de su equipo (§16, §23). German Stiven Arias Rojas, dueño de la
-- empresa, es jefe de área de 50 personas pero no usa el sistema (ficha sin contrato ni cuenta):
--   - a los directores (los que lo tienen también como jefe inmediato) los gestiona Geraldin Cruz Ortiz;
--   - al resto, su jefe inmediato.
-- En la ficha, en RRHH y en los reportes el jefe de área sigue siendo German.
--
-- `gestor_asistencia_id` NULL = lo gestiona su jefe de área (todos los demás empleados, sin cambios).
-- Lo llena `node scripts/headcountRRHH.js sincronizar`. No se edita desde el formulario de RRHH.
--
-- Sin dependencias. Idempotente salvo el ADD COLUMN.
-- =====================================================================

ALTER TABLE `contrato`
    ADD COLUMN `gestor_asistencia_id` INT NULL
        COMMENT 'ficha que gestiona su asistencia en lugar del jefe de área; NULL = el jefe de área'
        AFTER `jefe_area_id`,
    ADD KEY `idx_contrato_gestor_asistencia` (`gestor_asistencia_id`),
    ADD CONSTRAINT `fk_contrato_gestor_asistencia`
        FOREIGN KEY (`gestor_asistencia_id`) REFERENCES `users_company` (`id`) ON DELETE SET NULL;
