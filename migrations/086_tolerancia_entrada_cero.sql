-- =====================================================================
-- 086 — Sin tolerancia de entrada (asistencia.md §52)
--
-- La tolerancia de 5 minutos era el valor por defecto del módulo, no una regla de la operación: la
-- malla (Mallas1.xlsx) no la trae. La empresa definió que no hay tolerancia: quien entra a las 10:08
-- con turno de 10:00 llegó 8 minutos tarde.
--
-- Pone en 0 el parámetro general, el DEFAULT de las tres tablas con tolerancia y todas las filas que ya
-- existen (plantillas, horarios asignados y días de solicitudes de cambio de turno). Idempotente.
--
-- Después, para que el histórico y los reportes cuadren:
--   node scripts/recalcularJornadas.js --desde=2026-10-01
-- =====================================================================

-- MySQL Workbench: el modo de actualización segura (error 1175) bloquea los UPDATE de abajo. Se apaga
-- solo en esta sesión y se vuelve a prender al final.
SET SQL_SAFE_UPDATES = 0;

START TRANSACTION;

UPDATE `asistencia_parametro`
   SET `valor` = '0', `descripcion` = 'Tolerancia por defecto si el horario no define una propia (0 = sin tolerancia)'
 WHERE `clave` = 'tolerancia_entrada_min';

UPDATE `horario_plantilla` SET `tolerancia_entrada_min` = 0 WHERE `tolerancia_entrada_min` <> 0;
UPDATE `horario_asignado` SET `tolerancia_entrada_min` = 0 WHERE `tolerancia_entrada_min` <> 0;
UPDATE `solicitud_cambio_turno_dia` SET `tolerancia_entrada_min` = 0 WHERE `tolerancia_entrada_min` <> 0;

COMMIT;

-- DDL fuera de la transacción (MySQL hace commit implícito).
ALTER TABLE `horario_plantilla` ALTER COLUMN `tolerancia_entrada_min` SET DEFAULT 0;
ALTER TABLE `horario_asignado` ALTER COLUMN `tolerancia_entrada_min` SET DEFAULT 0;
ALTER TABLE `solicitud_cambio_turno_dia` ALTER COLUMN `tolerancia_entrada_min` SET DEFAULT 0;

SET SQL_SAFE_UPDATES = 1;
