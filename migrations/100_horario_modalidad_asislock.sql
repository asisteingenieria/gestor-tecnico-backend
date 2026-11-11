-- 100: Modalidad (presencial / virtual) por día en el horario asignado.
--
-- AsisLock consulta por cédula el horario del empleado y necesita saber, día por día, si trabaja
-- presencial o virtual (asistencia.md §58). `horario_asignado.modalidad`:
--   'presencial' | 'virtual' = lo que dice ese día (malla, columna "Modelo Trabajo", o el jefe en
--                              Gestión de horarios);
--   NULL                     = el día no lo dice: se usa la modalidad del contrato (RRHH:
--                              Presencial → presencial, Remoto → virtual, Híbrido → sin dato).
--
-- Una reasignación que no trae modalidad conserva la que tenía el día (COALESCE en el upsert de
-- horarioAsignadoRepository): asignar otro turno o aprobar un cambio de turno no la borra.
--
-- El número 099 lo usa un SQL de datos fuera del repo (Descargas/099_gestor_asistencia_...).
-- Idempotente: solo agrega la columna si no existe. Sin dependencias.

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'horario_asignado'
      AND COLUMN_NAME = 'modalidad'
);

SET @sql := IF(@existe = 0,
    "ALTER TABLE horario_asignado ADD COLUMN modalidad ENUM('presencial','virtual') NULL DEFAULT NULL AFTER es_descanso",
    'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
