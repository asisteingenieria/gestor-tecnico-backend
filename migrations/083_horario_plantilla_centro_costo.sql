-- =====================================================================
-- 083 — Plantillas de horario por centro de costo (asistencia.md §45)
--
-- Un jefe de área tiene gente de varios centros de costo con horarios distintos (Claro T&T:
-- CBAT OUTBOUND, CBAT WHATSAPP, CBAT INBOUND). Cada plantilla puede marcar a qué centro de costo
-- aplica, para que al asignar por centro se sugieran primero las suyas. NULL = general (sirve
-- para cualquier centro). Es una ayuda, no una restricción: cualquier plantilla del jefe se puede
-- seguir asignando a cualquier persona de su equipo (los casos individuales).
--
-- Sin dependencias (requiere la 066, ya en producción). No es idempotente (ADD COLUMN): correr
-- UNA sola vez. No compara texto, así que no le afecta el collation de producción.
-- =====================================================================

ALTER TABLE `horario_plantilla`
  ADD COLUMN `centro_costo_id` INT NULL COMMENT 'centro de costo al que aplica; NULL = general' AFTER `dueno_users_company_id`,
  ADD KEY `idx_horario_plantilla_centro_costo` (`centro_costo_id`),
  ADD CONSTRAINT `fk_horario_plantilla_centro_costo` FOREIGN KEY (`centro_costo_id`) REFERENCES `centro_costo` (`idcentro_costo`) ON DELETE SET NULL;
