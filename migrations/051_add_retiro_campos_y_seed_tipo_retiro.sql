-- =====================================================================
--  Migracion 051: completa el esquema de `retiro` (tabla creada en la 034,
--  con equipo_entregado agregado en la 039) para poder construir el flujo
--  de "Registrar retiro" en el frontend, comparado contra la hoja
--  "Retiro empleado" de Descargas/DATOS (1) (1).xlsx.
--
--  La hoja trae 26 columnas, pero solo 9 son informacion NUEVA (las demas
--  ya se capturan al dar de alta al empleado: Cliente, Identificacion,
--  Nombres, Campania -no esta en esta hoja en realidad-, Modalidad,
--  Analista Encargado): Fecha De Retiro, Fecha Ultima Conexion, Tipo De
--  Retiro, Motivo De Retiro, Justificacion, Entrega De Equipo, Serial
--  Diadema, Fecha Entrega Certificacion Laboral Y Cesantias.
--
--  De esas 9: fecha_retiro/fecha_ultima_conexion/equipo_entregado/
--  fecha_entrega_certificacion ya existen en `retiro` desde 034/039.
--  Serial Diadema no necesita columna nueva: ya se rastrea en
--  `asignacion_recurso` (migracion 039) — al marcar "Entrega de equipo" el
--  backend desactiva las asignaciones activas del empleado (diadema/
--  locker/carnet), sin duplicar el dato.
--
--  Gaps reales cerrados aqui:
--  - `retiro.justificacion`: no existia ninguna columna para esto.
--  - `retiro.motivo_retiro`: existia como catalogo cerrado
--    (`motivo_retiro_idmotivo_retiro`, tabla `motivo_retiro`, ambas vacias
--    desde la 034 — nunca se sembraron ni se uso el modulo). A pedido del
--    usuario se cambia a texto libre: los motivos reales varian demasiado
--    para un catalogo corto y cerrado, a diferencia de "Tipo De Retiro"
--    que si son categorias legales estandar. La tabla `motivo_retiro`
--    queda huerfana (vacia, sin FK apuntandole) — no se borra, mismo
--    criterio que otros residuos de catalogo en este proyecto (ver
--    campana "Obama" en claude/modulo recursoshumanos.md §13.1).
--  - `tipo_retiro` sembrado con las categorias legales estandar de
--    terminacion laboral en Colombia (no hay dato real de ejemplo en el
--    Excel: los 389 empleados reales estan todos "ALTA", ninguno retirado
--    — a diferencia del resto de catalogos de este proyecto, sembrados
--    siempre contra datos reales, aqui se usa una lista estandar del pais
--    a falta de esa referencia, confirmada con el usuario antes de correr
--    esta migracion).
--
--  Ejecutar UNA sola vez sobre una BD que ya tiene aplicada la 050.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- =====================================================================
--  1) `tipo_retiro`: sembrado con categorias legales estandar (Colombia)
-- =====================================================================

INSERT INTO `tipo_retiro` (`nombre`) VALUES
  ('Renuncia voluntaria'),
  ('Despido con justa causa'),
  ('Despido sin justa causa'),
  ('Terminación de contrato'),
  ('Mutuo acuerdo'),
  ('Abandono de cargo'),
  ('Pensión'),
  ('Fallecimiento');

-- =====================================================================
--  2) `retiro`: motivo_retiro pasa de catalogo cerrado a texto libre,
--     se agrega justificacion
-- =====================================================================

ALTER TABLE `retiro`
  DROP FOREIGN KEY `fk_retiro_motivo_retiro`;

ALTER TABLE `retiro`
  DROP COLUMN `motivo_retiro_idmotivo_retiro`,
  ADD COLUMN `motivo_retiro` VARCHAR(255) NULL AFTER `tipo_retiro_idtipo_retiro`,
  ADD COLUMN `justificacion` VARCHAR(255) NULL AFTER `motivo_retiro`;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE=@OLD_SQL_MODE;
