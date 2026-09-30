-- =====================================================================
--  Migracion 047: 4 columnas del Excel fuente (Descargas/DATOS (1) (1).xlsx,
--  hoja TOTAL PERSONAL) que no tenian donde guardarse en el esquema actual.
--
--  Detectadas al comparar campo a campo un empleado real ya importado
--  (users_company.id=13, cedula 1001294395) contra su fila origen en el
--  Excel. Distinto de los gaps que cerro la migracion 039 (esos ya tenian
--  columna pero el import no la usaba): aqui la columna no existia.
--
--  - contrato.director_area_id: columna "Director de Área" del Excel,
--    distinta de "Jefe de Área" (jefe_area_id, migracion 039) — se
--    confirmo con datos reales que difieren para el mismo empleado
--    (ver fila 5 del Excel: Director de Área "ANDRES SANTIAGO NUNCIRA
--    JIMENEZ" vs Jefe de Área "MAYRA ALEJANDRA BARBOSA VIGOYA"). Rol de
--    persona -> FK a users_company, ON DELETE SET NULL, mismo patron
--    que fk_contrato_jefe_area/fk_contrato_analista_encargado.
--  - contrato.cargo_ssff: columna "Cargo en SSFF" del Excel, distinta de
--    "Cargo" (cargo_idcargo). Se confirmo con datos reales que difieren
--    (ej. Cargo en SSFF "SUPERVISOR DE OPERACION TMK" vs Cargo
--    "COORDINADOR CALL"). Texto libre, no catalogo: los valores vistos
--    no correspondian a las ~61 filas del catalogo `cargo` existente.
--  - contrato.fecha_entrega_certificacion_laboral: columna "Fecha
--    Entrega Certificacion Laboral Y Cesantias" del Excel. Sin datos
--    reales en las 389 filas actuales, pero la columna existe en el
--    Excel y no hay donde guardarla si algun empleado la trae despues.
--  - direccion.zona_direccion_id: columna "Tipo De Dirección" del Excel
--    (valor real visto: "URBANO"; el catalogo tambien admite "Rural"
--    aunque no aparece en los datos actuales). Es un concepto distinto
--    del catalogo `tipo_direccion` ya existente (Residencia/
--    Correspondencia/Laboral, que clasifica el USO de la direccion, no
--    la zona). Normalizado como catalogo nuevo (mismo patron que
--    tipo_vacuna/tipo_recurso de la migracion 039), no texto libre.
--
--  Ver claude/modulo recursoshumanos.md para el detalle de la
--  comparacion campo a campo contra el Excel.
--
--  IMPORTANTE (orden de despliegue): tras correr esta migracion contra
--  la BD real, avisar para terminar de cablear estos 4 campos en
--  models/UserCompany.js, utils/importEmpleadosExcel.js,
--  services/importEmpleadosService.js y EmpleadoDrawer.jsx — ese codigo
--  todavia NO los usa (a proposito, para no romper create/update de
--  empleados con un UPDATE a una columna que aun no existe).
--
--  Ejecutar UNA sola vez sobre una BD que ya tiene aplicada la 046. No
--  usa IF NOT EXISTS en los ALTER TABLE; si se corre dos veces fallara
--  con "Duplicate column name", señal correcta de que ya se aplico.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- =====================================================================
--  1) Catalogo nuevo: zona de la dirección (Urbano/Rural)
-- =====================================================================

CREATE TABLE IF NOT EXISTS `zona_direccion` (
  `idzona_direccion` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`idzona_direccion`),
  UNIQUE KEY `uq_zona_direccion_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `zona_direccion` (`nombre`) VALUES ('Urbano'), ('Rural');

ALTER TABLE `direccion`
  ADD COLUMN `zona_direccion_id` INT NULL AFTER `ciudad_idciudad`;

ALTER TABLE `direccion`
  ADD CONSTRAINT `fk_direccion_zona`
    FOREIGN KEY (`zona_direccion_id`) REFERENCES `zona_direccion` (`idzona_direccion`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
--  2) Contrato: Director de Área, Cargo en SSFF, fecha certificación
-- =====================================================================

ALTER TABLE `contrato`
  ADD COLUMN `director_area_id` INT NULL AFTER `jefe_area_id`,
  ADD COLUMN `cargo_ssff` VARCHAR(150) NULL AFTER `cargo_idcargo`,
  ADD COLUMN `fecha_entrega_certificacion_laboral` DATE NULL AFTER `observaciones`;

ALTER TABLE `contrato`
  ADD CONSTRAINT `fk_contrato_director_area`
    FOREIGN KEY (`director_area_id`) REFERENCES `users_company` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE=@OLD_SQL_MODE;
