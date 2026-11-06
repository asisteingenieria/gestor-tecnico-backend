-- 098: documento del expediente asociado a una novedad (claude/modulo recursoshumanos.md §50).
--
-- Los documentos de las novedades ya están en el expediente del empleado (migración 097,
-- 6.NOVEDADES/<tipo>/<fecha>.pdf). El cargue masivo de novedades (scripts/cargarNovedadesExcel.js)
-- no los copia: enlaza cada archivo con su novedad con esta columna. El archivo sigue siendo del
-- expediente; si se borra la novedad, el archivo queda y pierde el enlace (SET NULL).
--
-- Va ANTES del código (el listado de novedades cuenta estos documentos). Idempotente.

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empleado_archivo' AND COLUMN_NAME = 'novedad_rrhh_id'
);
SET @sql := IF(@existe = 0,
    'ALTER TABLE empleado_archivo
        ADD COLUMN novedad_rrhh_id INT NULL COMMENT ''novedad a la que pertenece el documento (migración 098)'' AFTER subcarpeta,
        ADD KEY idx_empleado_archivo_novedad (novedad_rrhh_id),
        ADD CONSTRAINT fk_empleado_archivo_novedad FOREIGN KEY (novedad_rrhh_id)
            REFERENCES novedad_rrhh (idnovedad_rrhh) ON DELETE SET NULL',
    'SELECT ''empleado_archivo.novedad_rrhh_id ya existe''');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
