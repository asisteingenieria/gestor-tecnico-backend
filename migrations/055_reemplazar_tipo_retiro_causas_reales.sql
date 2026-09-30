-- =====================================================================
--  Migracion 055: reemplaza los 8 valores genericos de `tipo_retiro`
--  (sembrados en la 051 a falta de dato real, ver ese archivo) por los 5
--  valores reales de la hoja "Causas finalizacion contrato" de
--  Descargas/Informacion 280926 (1).xlsx -- mismo criterio ya aplicado con
--  `tipo_novedad` en la migracion 053.
--
--  La hoja trae, ademas del nombre, un "Motivo De Retiro" emparejado 1 a 1
--  con cada "Tipo De Retiro" y una nota de "Justificacion" que solo aparece
--  en la fila de "Renuncia Voluntaria" ("Solo aplica en este Item"). Se
--  agregan dos columnas nuevas a `tipo_retiro` para sostener esto sin
--  necesidad de una tabla aparte (es una relacion fija 1 a 1, no un catalogo
--  independiente):
--    - `motivo_sugerido`: texto que el frontend precarga en el campo
--      "Motivo" (que sigue siendo texto libre, editable) al elegir el tipo.
--    - `requiere_justificacion`: solo en TRUE para "Renuncia Voluntaria" --
--      el frontend muestra/exige el campo "Justificacion" unicamente en ese
--      caso, igual de condicional que el documento secundario de PPT/
--      Pasaporte (ver claude/modulo recursoshumanos.md §17).
--
--  `nombre` se ensancha a VARCHAR(80): "Terminacion de contrato por periodo
--  de prueba" (45 caracteres) no entra en el VARCHAR(40) original.
--
--  ADVERTENCIA: `fk_retiro_tipo_retiro` es ON DELETE RESTRICT. Si al correr
--  esto contra una BD (ej. produccion) ya existe algun `retiro` real
--  apuntando a alguno de los 8 tipos viejos, el DELETE de abajo falla --
--  resolver esos registros a mano antes, no forzar el borrado. En local se
--  verifico `SELECT COUNT(*) FROM retiro` = 0 antes de escribir esta
--  migracion (el modulo de Retiro, migracion 051, no tiene todavia ningun
--  registro real).
--
--  Validada contra una copia temporal (`test_migracion_055_temp`, tabla
--  `tipo_retiro` clonada) antes de aplicarla.
-- =====================================================================

ALTER TABLE `tipo_retiro`
  MODIFY COLUMN `nombre` VARCHAR(80) NOT NULL,
  ADD COLUMN `motivo_sugerido` VARCHAR(255) NULL AFTER `nombre`,
  ADD COLUMN `requiere_justificacion` TINYINT(1) NOT NULL DEFAULT 0 AFTER `motivo_sugerido`;

DELETE FROM `tipo_retiro`;

ALTER TABLE `tipo_retiro` AUTO_INCREMENT = 1;

INSERT INTO `tipo_retiro` (`nombre`, `motivo_sugerido`, `requiere_justificacion`) VALUES
  ('Renuncia Voluntaria', 'Renuncia voluntaria', 1),
  ('Terminacion de contrato por periodo de prueba', 'Periodo de prueba', 0),
  ('Terminacion de contrato con justa causa', 'Justa causa', 0),
  ('Terminacion de contrato sin justa causa', 'Sin justa causa', 0),
  ('Renuncia', 'Proceso disciplinario', 0);
