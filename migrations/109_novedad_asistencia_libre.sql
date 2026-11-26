-- 109: Novedades de asistencia del coordinador: cambio de turno y día libre (asistencia.md §86).
--
-- El coordinador (jefe inmediato) pide por alguien de su gente directa un cambio de turno o uno o varios días
-- libres; le llega a quien gestiona al empleado (el jefe de operaciones), que lo aprueba o lo rechaza. Se usa el
-- módulo de cambios de turno (migración 084, §50-§51), que ya guarda la traza: `creado_en` (cuándo se envió) y
-- `resuelta_en` (cuándo se aprobó o rechazó), con quién pidió y quién resolvió.
--
-- 1. `solicitud_cambio_turno.tipo` suma 'libre'. MySQL no agrega un valor suelto a un ENUM: se reescribe completo.
-- 2. `horario_asignado.es_libre`: al aprobar un libre, el día queda como descanso (`es_descanso = 1`, así no cuenta
--    como ausencia ni llegada tarde) y además con `es_libre = 1`, para mostrarlo como "Libre" y no como el
--    descanso de la malla. Cualquier otra asignación del día lo vuelve a 0.
--
-- Va ANTES del código: el upsert de horarios nombra la columna. Idempotente. Requiere la 084.

SET @sql := IF(
    (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'solicitud_cambio_turno' AND COLUMN_NAME = 'tipo') LIKE '%''libre''%',
    'DO 0',
    'ALTER TABLE solicitud_cambio_turno MODIFY COLUMN tipo ENUM(''cambio_horario'', ''intercambio'', ''libre'') NOT NULL'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'horario_asignado' AND COLUMN_NAME = 'es_libre'
);
SET @sql := IF(@existe = 0,
    'ALTER TABLE horario_asignado ADD COLUMN es_libre TINYINT(1) NOT NULL DEFAULT 0 AFTER es_descanso',
    'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
