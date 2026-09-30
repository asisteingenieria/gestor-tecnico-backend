-- =====================================================================
--  Migracion 050: campos del formulario de registro de empleados que
--  trae el Excel de nomina real (Descargas/NominaEmpleadosWO190723-1
--  0826.xlsx, hoja EJEMPLO) y que hoy no tienen donde guardarse.
--
--  Se excluyen a proposito las columnas de liquidacion de nomina
--  (Cesantias, IntCesantias, Prima, Vacaciones, Ret. Fte) — a peticion
--  del usuario, ese calculo no es responsabilidad de este modulo.
--
--  Catalogos nuevos (todos sembrados solo con el valor visto en la hoja
--  EJEMPLO, salvo tipo_sena que no traia ningun dato en la muestra —
--  columna lista, catalogo vacio hasta que se conozca un valor real):
--  - empresa (seed "ASISTE ING SAS")
--  - clase_contrato (seed "Normal")
--  - periodo_pago (seed "Mensual")
--  - clasificacion_dian (seed "Normal")
--  - tipo_sena (sin seed)
--  - tipo_cotizante (seed "Dependiente")
--  - subtipo_cotizante (seed "Ninguno")
--
--  Columnas nuevas:
--  - contrato.empresa_id / clase_contrato_id / periodo_pago_id /
--    clasificacion_dian_id / tipo_sena_id / tipo_cotizante_id /
--    subtipo_cotizante_id — FK a los catalogos de arriba, todas NULL
--    (opcionales) para no romper contratos ya existentes.
--  - contrato.aplica_dotacion TINYINT(1) DEFAULT 1 — columna "Dotación"
--    del Excel: en la muestra viene -1 (TRUE) para todos, es un booleano
--    de nomina (Excel/Access representa TRUE como -1), no la talla —
--    eso ya vive en la tabla `dotacion` (historial de tallas, migracion
--    039) y no se toca aqui.
--  - users_company.declarante_renta TINYINT(1) DEFAULT 0 — columna
--    "Declarante" del Excel (viene 0/FALSE en la muestra).
--  - users_company.libreta_militar_numero VARCHAR(30) NULL — columna
--    "Libreta Militar No." del Excel, sin donde guardarse hasta ahora.
--
--  Deliberadamente sin columna nueva:
--  - "Identificación Ciudad" / Sexo / Ciudad / Tipo Dirección / Tipo
--    Cuenta / Banco Cuenta / ARL / EPS / Pensión / Fondo Cesantías /
--    Caja / Fecha Fin Periodo Prueba / Fecha Fin Contrato / Tarifa ARL:
--    ya tienen columna (ciudad_expedicion_id, genero_id, direccion.*,
--    cuenta_bancaria.*, seguridad_social.*, contrato.fecha_fin_*), no
--    es un gap de esquema.
--  - Las 5 "Fecha Afil. X" (ARL/EPS/AFP/Cesantías/Caja): la columna
--    `seguridad_social.fecha_afiliacion` ya existe desde la 034 (una
--    fila por tipo de afiliacion); el gap era que el modelo siempre
--    escribia ahi la fecha de ingreso del contrato en vez de la fecha
--    real de afiliacion — se corrige en models/UserCompany.js, no aqui.
--  - "Centro De Trabajo": decidido con el usuario que es el mismo dato
--    que "Ciudad de trabajo" (contrato.ciudad_idciudad, ya existente).
--
--  Ver claude/modulo recursoshumanos.md para el detalle de la
--  comparacion campo a campo contra este Excel.
--
--  IMPORTANTE (orden de despliegue): tras correr esta migracion contra
--  la BD real, avisar para terminar de cablear estos campos en
--  models/UserCompany.js y AgentForm.jsx — ese codigo todavia NO los
--  usa (a proposito, para no romper create/update de empleados con un
--  INSERT/UPDATE a una columna que aun no existe).
--
--  Ejecutar UNA sola vez sobre una BD que ya tiene aplicada la 049. No
--  usa IF NOT EXISTS en los ALTER TABLE; si se corre dos veces fallara
--  con "Duplicate column name", señal correcta de que ya se aplico.
-- =====================================================================

SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- =====================================================================
--  1) Catalogos nuevos
-- =====================================================================

CREATE TABLE IF NOT EXISTS `empresa` (
  `idempresa` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(150) NOT NULL,
  PRIMARY KEY (`idempresa`),
  UNIQUE KEY `uq_empresa_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `empresa` (`nombre`) VALUES ('ASISTE ING SAS');

CREATE TABLE IF NOT EXISTS `clase_contrato` (
  `idclase_contrato` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`idclase_contrato`),
  UNIQUE KEY `uq_clase_contrato_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `clase_contrato` (`nombre`) VALUES ('Normal');

CREATE TABLE IF NOT EXISTS `periodo_pago` (
  `idperiodo_pago` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(30) NOT NULL,
  PRIMARY KEY (`idperiodo_pago`),
  UNIQUE KEY `uq_periodo_pago_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `periodo_pago` (`nombre`) VALUES ('Mensual');

CREATE TABLE IF NOT EXISTS `clasificacion_dian` (
  `idclasificacion_dian` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`idclasificacion_dian`),
  UNIQUE KEY `uq_clasificacion_dian_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `clasificacion_dian` (`nombre`) VALUES ('Normal');

-- Sin seed: ninguna fila de la muestra trae valor para "Tipo Sena".
CREATE TABLE IF NOT EXISTS `tipo_sena` (
  `idtipo_sena` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`idtipo_sena`),
  UNIQUE KEY `uq_tipo_sena_nombre` (`nombre`)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS `tipo_cotizante` (
  `idtipo_cotizante` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`idtipo_cotizante`),
  UNIQUE KEY `uq_tipo_cotizante_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `tipo_cotizante` (`nombre`) VALUES ('Dependiente');

CREATE TABLE IF NOT EXISTS `subtipo_cotizante` (
  `idsubtipo_cotizante` INT NOT NULL AUTO_INCREMENT,
  `nombre` VARCHAR(50) NOT NULL,
  PRIMARY KEY (`idsubtipo_cotizante`),
  UNIQUE KEY `uq_subtipo_cotizante_nombre` (`nombre`)
) ENGINE = InnoDB;

INSERT INTO `subtipo_cotizante` (`nombre`) VALUES ('Ninguno');

-- =====================================================================
--  2) Contrato: nuevas columnas de nomina
-- =====================================================================

ALTER TABLE `contrato`
  ADD COLUMN `empresa_id` INT NULL AFTER `fecha_entrega_certificacion_laboral`,
  ADD COLUMN `clase_contrato_id` INT NULL AFTER `empresa_id`,
  ADD COLUMN `periodo_pago_id` INT NULL AFTER `clase_contrato_id`,
  ADD COLUMN `clasificacion_dian_id` INT NULL AFTER `periodo_pago_id`,
  ADD COLUMN `tipo_sena_id` INT NULL AFTER `clasificacion_dian_id`,
  ADD COLUMN `tipo_cotizante_id` INT NULL AFTER `tipo_sena_id`,
  ADD COLUMN `subtipo_cotizante_id` INT NULL AFTER `tipo_cotizante_id`,
  ADD COLUMN `aplica_dotacion` TINYINT(1) NOT NULL DEFAULT 1 AFTER `subtipo_cotizante_id`;

ALTER TABLE `contrato`
  ADD CONSTRAINT `fk_contrato_empresa`
    FOREIGN KEY (`empresa_id`) REFERENCES `empresa` (`idempresa`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_contrato_clase_contrato`
    FOREIGN KEY (`clase_contrato_id`) REFERENCES `clase_contrato` (`idclase_contrato`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_contrato_periodo_pago`
    FOREIGN KEY (`periodo_pago_id`) REFERENCES `periodo_pago` (`idperiodo_pago`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_contrato_clasificacion_dian`
    FOREIGN KEY (`clasificacion_dian_id`) REFERENCES `clasificacion_dian` (`idclasificacion_dian`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_contrato_tipo_sena`
    FOREIGN KEY (`tipo_sena_id`) REFERENCES `tipo_sena` (`idtipo_sena`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_contrato_tipo_cotizante`
    FOREIGN KEY (`tipo_cotizante_id`) REFERENCES `tipo_cotizante` (`idtipo_cotizante`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_contrato_subtipo_cotizante`
    FOREIGN KEY (`subtipo_cotizante_id`) REFERENCES `subtipo_cotizante` (`idsubtipo_cotizante`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
--  3) users_company: declarante de renta + libreta militar
-- =====================================================================

ALTER TABLE `users_company`
  ADD COLUMN `declarante_renta` TINYINT(1) NOT NULL DEFAULT 0 AFTER `rut`,
  ADD COLUMN `libreta_militar_numero` VARCHAR(30) NULL AFTER `declarante_renta`;

SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET SQL_MODE=@OLD_SQL_MODE;
