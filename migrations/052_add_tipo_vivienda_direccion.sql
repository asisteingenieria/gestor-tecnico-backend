-- =====================================================================
--  Migracion 052: columna "Tipo Dirección" de la hoja EJEMPLO
--  (Descargas/NominaEmpleadosWO190723-1 0826.xlsx) — valor real visto:
--  "Casa" en las 7 filas de la muestra.
--
--  Detectada al auditar AgentForm.jsx campo a campo contra las dos unicas
--  hojas fuente del formulario manual ("Nuevo Epleado" de
--  Descargas/DATOS (1) (1).xlsx y "EJEMPLO" de este Excel de nomina — ver
--  claude/modulo recursoshumanos.md §19). Es un concepto DISTINTO de los
--  otros dos que ya existen sobre `direccion`:
--  - `tipo_direccion` (Residencia/Correspondencia/Laboral): clasifica el
--    USO de la direccion.
--  - `zona_direccion` (Urbano/Rural, migracion 047): viene de la columna
--    "Tipo De Dirección" de la OTRA hoja fuente ("Nuevo Epleado"), sobre
--    la zona geografica.
--  Este es el tipo de VIVIENDA (Casa/Apartamento/...). Normalizado como
--  catalogo nuevo, no texto libre, mismo patron que zona_direccion/
--  tipo_vacuna/tipo_recurso. Sembrado solo con "Casa" (unico valor
--  confirmado en la muestra de 7 filas reales) — el catalogo queda listo
--  para agregar "Apartamento" u otros en cuanto aparezca un dato real.
--
--  IMPORTANTE (orden de despliegue): tras correr esta migracion contra la
--  BD real, avisar para terminar de cablear el campo en
--  models/UserCompany.js (guardarDireccion/getByIdCompleto/getCatalogos)
--  y AgentForm.jsx/EmpleadoDrawer.jsx — ese codigo todavia NO lo usa (a
--  proposito, para no romper create/update de empleados con un UPDATE a
--  una columna que aun no existe).
--
--  Ejecutar UNA sola vez sobre una BD que ya tiene aplicada la 051. No
--  usa IF NOT EXISTS en el ALTER TABLE; si se corre dos veces fallara
--  con "Duplicate column name", señal correcta de que ya se aplico.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- =====================================================================
--  1) Catalogo nuevo: tipo de vivienda (Casa/Apartamento/...)
-- =====================================================================

CREATE TABLE IF NOT EXISTS `tipo_vivienda` (
  `idtipo_vivienda` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`idtipo_vivienda`),
  UNIQUE KEY `uq_tipo_vivienda_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `tipo_vivienda` (`nombre`) VALUES ('Casa');

ALTER TABLE `direccion`
  ADD COLUMN `tipo_vivienda_id` INT NULL AFTER `zona_direccion_id`;

ALTER TABLE `direccion`
  ADD CONSTRAINT `fk_direccion_tipo_vivienda`
    FOREIGN KEY (`tipo_vivienda_id`) REFERENCES `tipo_vivienda` (`idtipo_vivienda`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE=@OLD_SQL_MODE;
