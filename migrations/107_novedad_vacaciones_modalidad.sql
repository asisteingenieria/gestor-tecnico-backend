-- =====================================================================
-- 107 — Modalidad de la novedad de Vacaciones (claude/modulo recursoshumanos.md §59)
--
-- Gestión Humana confirmó (2026-11-20) que la novedad de Vacaciones tiene tres opciones:
--   disfrutadas            → el empleado toma los días de descanso
--   compensadas            → los días se pagan en dinero
--   disfrutadas_compensadas → las dos, p. ej. 5 disfrutados y 5 compensados
-- `dias_disfrutados` y `dias_compensados` guardan cada parte; `total_dias` = la suma.
-- El pasivo vacacional (§58) descuenta disfrutados y compensados desde estas novedades: los días
-- compensados ya no se editan a mano en la pantalla (vacaciones_saldo.dias_compensados queda como el
-- valor del Excel al corte).
--
-- Las novedades de Vacaciones que ya existen quedan como "disfrutadas" con todos sus días.
-- Las columnas son NULL en los demás tipos de novedad.
--
-- Idempotente. Va ANTES del código (el modelo de novedades nombra las columnas).
-- En Workbench necesita SQL_SAFE_UPDATES = 0 por el UPDATE con JOIN (ya incluido).
-- =====================================================================

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'novedad_rrhh' AND COLUMN_NAME = 'modalidad_vacaciones') = 0,
  'ALTER TABLE novedad_rrhh
     ADD COLUMN modalidad_vacaciones ENUM(''disfrutadas'',''compensadas'',''disfrutadas_compensadas'') NULL AFTER total_dias,
     ADD COLUMN dias_disfrutados INT NULL AFTER modalidad_vacaciones,
     ADD COLUMN dias_compensados INT NULL AFTER dias_disfrutados',
  'SELECT ''novedad_rrhh ya tiene la modalidad de vacaciones'' AS aviso');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @safe := @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

UPDATE novedad_rrhh nr
  JOIN tipo_novedad tn ON tn.idtipo_novedad = nr.tipo_novedad_idtipo_novedad
   SET nr.modalidad_vacaciones = 'disfrutadas',
       nr.dias_disfrutados = COALESCE(nr.total_dias, 0),
       nr.dias_compensados = 0
 WHERE tn.nombre = 'Vacaciones'
   AND nr.modalidad_vacaciones IS NULL;

SET SQL_SAFE_UPDATES = @safe;
