-- 103: Retraso exacto de la llegada, en segundos (asistencia.md §72).
--
-- `jornada.minutos_tarde` se guarda redondeado (llegar 45:41 tarde quedaba "46 min"). La pantalla debe mostrar
-- el tiempo exacto en todas partes, también en el histórico, así que se guarda además `segundos_tarde`, que el
-- cálculo de la jornada escribe junto a `minutos_tarde` (jornadaRepository.actualizarTotales).
-- `minutos_tarde` no cambia: sigue decidiendo si el día fue puntual o tarde.
--
-- Relleno del histórico con la misma regla del cálculo (domain/asistencia/calcularJornada.js): entrada real
-- (UTC) menos la hora de entrada del horario del día (hora local Colombia = UTC-5, sin horario de verano) más
-- su tolerancia. Solo días tarde y que no son de descanso. Si el resultado no cuadra con los minutos ya
-- guardados (p. ej. un horario cambiado después), queda minutos_tarde × 60.
--
-- Va ANTES del código: actualizarTotales nombra la columna. Idempotente: la columna solo se agrega si no existe
-- y el relleno solo toca filas con segundos_tarde = 0. Sin dependencias.

SET SQL_SAFE_UPDATES = 0;

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'jornada'
      AND COLUMN_NAME = 'segundos_tarde'
);

SET @sql := IF(@existe = 0,
    'ALTER TABLE jornada ADD COLUMN segundos_tarde INT NOT NULL DEFAULT 0 AFTER minutos_tarde',
    'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1. Desde la entrada real y el horario del día.
UPDATE jornada j
JOIN horario_asignado ha
  ON ha.users_company_id = j.users_company_id
 AND ha.fecha = j.fecha
 AND ha.es_descanso = 0
SET j.segundos_tarde = GREATEST(0, FLOOR(TIMESTAMPDIFF(MICROSECOND,
        TIMESTAMP(j.fecha, ha.hora_entrada) + INTERVAL 5 HOUR + INTERVAL COALESCE(ha.tolerancia_entrada_min, 0) MINUTE,
        j.hora_entrada_real) / 1000000))
WHERE j.minutos_tarde > 0
  AND j.hora_entrada_real IS NOT NULL
  AND j.segundos_tarde = 0;

-- 2. Lo que no cuadra con los minutos guardados, o no tiene horario: minutos × 60.
UPDATE jornada
SET segundos_tarde = minutos_tarde * 60
WHERE minutos_tarde > 0
  AND (segundos_tarde = 0 OR ROUND(segundos_tarde / 60) <> minutos_tarde);

SET SQL_SAFE_UPDATES = 1;
