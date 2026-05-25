-- Migración 031: Agregar fecha estimada de entrega a diseños

ALTER TABLE disenos
    ADD COLUMN fecha_estimada DATETIME NULL AFTER disenador_id;
