-- Migración 027: Agregar campo 'tipo' a la tabla activos
-- activo = valor >= 400,000 COP | gasto = valor < 400,000 COP | NULL si no hay valor

ALTER TABLE activos
    ADD COLUMN tipo ENUM('activo', 'gasto') NULL
        COMMENT 'activo = valor >= 400000 COP, gasto = valor < 400000 COP. NULL si valor es NULL.'
    AFTER valor;

-- Backfill registros existentes según el valor
UPDATE activos
SET tipo = CASE
    WHEN valor IS NULL  THEN NULL
    WHEN valor >= 400000 THEN 'activo'
    ELSE 'gasto'
END;

CREATE INDEX idx_activos_tipo ON activos(tipo);
