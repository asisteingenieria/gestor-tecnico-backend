-- =====================================================================
--  Migracion 053: reemplaza por completo el catalogo `tipo_novedad`.
--
--  A peticion explicita del usuario: se quitan las 12 opciones sembradas
--  por la migracion 040 (8 'RRHH' + 4 'OPERACION', categorias de
--  asistencia/incapacidad genericas) y se reemplazan por las 13
--  novedades reales de "Contratacion" que uso pidio, todas bajo la
--  categoria `CONTRATACION`.
--
--  Bloqueante detectado antes de tocar nada: `novedad_rrhh` (idnovedad_rrhh=3)
--  referenciaba `tipo_novedad_idtipo_novedad=12` ('Cambio de turno'), la
--  UNICA fila real de esa tabla en la BD local. Su contenido
--  ('resumen_diagnostico'/'observaciones' = "dsssssssssssssss"/
--  "sddddddddddddddd") es claramente un registro de prueba olvidado de
--  una sesion anterior, no un dato de negocio real — confirmado con el
--  usuario, quien pidio borrarlo para poder reemplazar el catalogo sin
--  dejar una fila huerfana (la FK `fk_nov_rrhh_tipo_novedad` es
--  ON DELETE RESTRICT).
--
--  Si esta migracion se corre contra una BD (ej. produccion) donde
--  `novedad_rrhh` ya tiene registros REALES que referencian alguno de
--  los 12 tipos viejos, el DELETE de `tipo_novedad` fallara con un error
--  de FK — señal correcta de que hay que resolver esos registros a mano
--  primero (reasignarlos a un tipo nuevo o decidir que hacer con ellos)
--  en vez de correr este archivo tal cual.
--
--  Ejecutar UNA sola vez sobre una BD que ya tiene aplicada la 052.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;

-- Registro de prueba bloqueante (ver nota arriba) — no es dato real.
DELETE FROM `novedad_rrhh` WHERE `idnovedad_rrhh` = 3;

DELETE FROM `tipo_novedad`;

INSERT INTO `tipo_novedad` (`categoria`, `nombre`) VALUES
  ('CONTRATACION', 'Vacaciones'),
  ('CONTRATACION', 'Incapacidad Accidente Trabajo'),
  ('CONTRATACION', 'Incapacidades origen comun'),
  ('CONTRATACION', 'Incapacidades accidente de transito'),
  ('CONTRATACION', 'Licencia de paternidad'),
  ('CONTRATACION', 'Licencia de Maternidad'),
  ('CONTRATACION', 'Licencia No remunerada'),
  ('CONTRATACION', 'Licencia Remunerada'),
  ('CONTRATACION', 'Licencia por luto'),
  ('CONTRATACION', 'Suspensiones'),
  ('CONTRATACION', 'Horas de votacion'),
  ('CONTRATACION', 'Licencia Jurado de Votacion'),
  ('CONTRATACION', 'Dia de la familia');

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
