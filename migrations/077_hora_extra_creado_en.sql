-- =====================================================================
-- 077 — Marca de cuándo se solicitó la hora extra (asistencia.md §34, fase 2)
--
-- La trazabilidad muestra "solicitaste la hora extra el … y te la aprobaron el …". La aprobación
-- ya se guarda en `fecha_decision`; faltaba cuándo se solicitó. Se agrega `creado_en`: las filas
-- nuevas lo llenan con NOW() al insertar; las viejas quedan en NULL (no se puede saber hacia atrás).
--
-- Idempotente salvo el ADD COLUMN. Aplicar después de la 074.
-- =====================================================================

ALTER TABLE `hora_extra`
    ADD COLUMN `creado_en` DATETIME NULL COMMENT 'cuándo se solicitó/asignó (UTC)' AFTER `estado`;
