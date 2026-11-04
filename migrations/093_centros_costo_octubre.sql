-- 093: centros de costo de Financiera desde octubre de 2026.
--
-- Financiera definió 19 centros de costo (correo "Centros De Costos Que Se Utilizaran a Partir De
-- Octubre"). Solo esos quedan `vigente = 1` y son los que ofrecen el alta y la edición de empleados
-- (AgentForm), los traspasos, Contratación Hydra y el cargue masivo en Excel. Ver
-- `claude/modulo recursoshumanos.md` §46.
--
-- Los demás no se borran: los traspasos históricos y los contratos retirados los siguen usando.
-- Quedan `vigente = 0`. Al editar a un empleado que todavía tenga uno, se sigue viendo.
--
-- Qué hace:
--   1. agrega `centro_costo.vigente`;
--   2. renombra al nombre oficial los que ya existían con otro nombre:
--      TIENDA → CBAH TIENDA, MOVIL DIGITALIZACION → CBAM DIGITACION y ADMINISTRATIVO CB → ADMINISTRATIVO
--      (conserva el código 2411287);
--   3. crea, con código PENDIENTE, los oficiales que falten (en local no falta ninguno);
--   4. marca vigentes solo los 19 oficiales;
--   5. pasa los contratos ACTIVOS y las plantillas de horario de los centros que se unieron
--      (direcciones administrativas, Workforce, WHATSAPP PYMES) a su centro oficial. Es el destino por
--      defecto; la homologación por empleado de Financiera va aparte, en
--      `Descargas/093b_centros_costo_octubre_empleados.sql` (con cédulas, no se versiona), y se corre
--      DESPUÉS de esta, porque manda sobre el destino por defecto;
--   6. verificación.
--
-- Todo va por nombre, nunca por id: los ids de producción no coinciden con los de local.
-- Se puede correr más de una vez.
-- Collation: la tabla temporal toma el default del servidor y `centro_costo` puede ser
-- utf8mb4_unicode_ci en producción. Las comparaciones entre ellas llevan COLLATE explícito
-- (CLAUDE.md, error 1267).
-- Va ANTES del código: el catálogo de empleados y el cargue en Excel leen `vigente`.

SET @safe_updates_previo := @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

-- 1. Columna `vigente` ---------------------------------------------------------------------
SET @existe := (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'centro_costo' AND COLUMN_NAME = 'vigente');
SET @ddl := IF(@existe = 0,
    'ALTER TABLE `centro_costo` ADD COLUMN `vigente` TINYINT(1) NOT NULL DEFAULT 1 COMMENT ''1 = centro oficial de Financiera, se ofrece en los formularios (migración 093)'' AFTER `nombre`',
    'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Renombrar al nombre oficial (solo si el oficial todavía no existe) ----------------------
SET @hay := (SELECT COUNT(*) FROM `centro_costo` WHERE `nombre` = 'CBAH TIENDA');
UPDATE `centro_costo` SET `nombre` = 'CBAH TIENDA' WHERE `nombre` = 'TIENDA' AND @hay = 0;

SET @hay := (SELECT COUNT(*) FROM `centro_costo` WHERE `nombre` = 'CBAM DIGITACION');
UPDATE `centro_costo` SET `nombre` = 'CBAM DIGITACION' WHERE `nombre` = 'MOVIL DIGITALIZACION' AND @hay = 0;

SET @hay := (SELECT COUNT(*) FROM `centro_costo` WHERE `nombre` = 'ADMINISTRATIVO');
UPDATE `centro_costo` SET `nombre` = 'ADMINISTRATIVO' WHERE `nombre` = 'ADMINISTRATIVO CB' AND @hay = 0;

-- 3. Los 19 oficiales ------------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS `tmp_cc_oficial`;
CREATE TEMPORARY TABLE `tmp_cc_oficial` (`nombre` VARCHAR(80) CHARACTER SET utf8mb4 NOT NULL PRIMARY KEY);
INSERT INTO `tmp_cc_oficial` (`nombre`) VALUES
    ('CBAP WEB CALL BACK'), ('CBAH WEB CALL BACK'), ('CBAH WHATSAPP'), ('CBAM WEB CALL BACK'),
    ('CBAM WHATSAPP'), ('CBAT OUTBOUND'), ('CBAT INBOUND'), ('CBAT WHATSAPP'), ('CBAP INBOUND'),
    ('CBAH INBOUND'), ('CBAH OUTBOUND'), ('CBAH TIENDA'), ('CBAH VENTA CRUZADA'), ('CBAP WHATSAPP'),
    ('CBAM DIGITACION'), ('ADMINISTRATIVO'), ('DIRECCION OPERATIVA'), ('EUAO OBAMA'), ('EUAL VITIEL');

INSERT INTO `centro_costo` (`codigo`, `nombre`, `vigente`)
SELECT 'PENDIENTE', o.`nombre`, 1
FROM `tmp_cc_oficial` o
WHERE NOT EXISTS (SELECT 1 FROM `centro_costo` c
                  WHERE c.`nombre` COLLATE utf8mb4_unicode_ci = o.`nombre` COLLATE utf8mb4_unicode_ci);

-- 4. Solo los oficiales quedan vigentes -----------------------------------------------------
UPDATE `centro_costo` c
   SET c.`vigente` = EXISTS (SELECT 1 FROM `tmp_cc_oficial` o
                             WHERE o.`nombre` COLLATE utf8mb4_unicode_ci = c.`nombre` COLLATE utf8mb4_unicode_ci)
 WHERE c.`idcentro_costo` > 0;

-- 5. Centros que se unieron a uno oficial: contratos activos y plantillas de horario ---------
--    (BEEMO, EUAP CUSTOMER SERVICE y PYMES HUNTER no tienen un destino único: Financiera los
--    reparte por persona en el 093b. Operación Claro y los CC-00x genéricos tampoco.)
DROP TEMPORARY TABLE IF EXISTS `tmp_cc_alias`;
CREATE TEMPORARY TABLE `tmp_cc_alias` (
    `viejo` VARCHAR(80) CHARACTER SET utf8mb4 NOT NULL PRIMARY KEY,
    `nuevo` VARCHAR(80) CHARACTER SET utf8mb4 NOT NULL
);
INSERT INTO `tmp_cc_alias` (`viejo`, `nuevo`) VALUES
    ('DIRECCION ADMINISTRATIVA', 'ADMINISTRATIVO'),
    ('DIRECCION TI',             'ADMINISTRATIVO'),
    ('DIRECCION FINANCIERA',     'ADMINISTRATIVO'),
    ('DIRECCION JURIDICA',       'ADMINISTRATIVO'),
    ('DIRECCION COMERCIAL',      'ADMINISTRATIVO'),
    ('WORKFORCE',                'ADMINISTRATIVO'),
    ('WHATSAPP PYMES',           'CBAP WHATSAPP');

UPDATE `contrato` k
JOIN `estado_contrato` ec ON ec.`idestado_contrato` = k.`estado_contrato_idestado_contrato`
JOIN `centro_costo` viejo ON viejo.`idcentro_costo` = k.`centro_costo_idcentro_costo`
JOIN `tmp_cc_alias` a ON a.`viejo` COLLATE utf8mb4_unicode_ci = viejo.`nombre` COLLATE utf8mb4_unicode_ci
JOIN `centro_costo` nuevo ON nuevo.`nombre` COLLATE utf8mb4_unicode_ci = a.`nuevo` COLLATE utf8mb4_unicode_ci
SET k.`centro_costo_idcentro_costo` = nuevo.`idcentro_costo`
WHERE ec.`nombre` = 'activo';

UPDATE `horario_plantilla` p
JOIN `centro_costo` viejo ON viejo.`idcentro_costo` = p.`centro_costo_id`
JOIN `tmp_cc_alias` a ON a.`viejo` COLLATE utf8mb4_unicode_ci = viejo.`nombre` COLLATE utf8mb4_unicode_ci
JOIN `centro_costo` nuevo ON nuevo.`nombre` COLLATE utf8mb4_unicode_ci = a.`nuevo` COLLATE utf8mb4_unicode_ci
SET p.`centro_costo_id` = nuevo.`idcentro_costo`;

-- Las plantillas que quedan en un centro no vigente sin destino pasan a generales (NULL).
UPDATE `horario_plantilla` p
JOIN `centro_costo` c ON c.`idcentro_costo` = p.`centro_costo_id`
SET p.`centro_costo_id` = NULL
WHERE c.`vigente` = 0;

DROP TEMPORARY TABLE IF EXISTS `tmp_cc_alias`;
DROP TEMPORARY TABLE IF EXISTS `tmp_cc_oficial`;

SET SESSION SQL_SAFE_UPDATES = @safe_updates_previo;

-- 6. Verificación: 19 vigentes; activos por centro (después del 093b, los no vigentes deberían
--    quedar solo con los empleados que Financiera no incluyó en su archivo).
SELECT SUM(`vigente`) AS vigentes, SUM(1 - `vigente`) AS no_vigentes FROM `centro_costo`;

SELECT c.`codigo`, c.`nombre`, c.`vigente`, COALESCE(SUM(ec.`nombre` = 'activo'), 0) AS activos
FROM `centro_costo` c
LEFT JOIN `contrato` k ON k.`centro_costo_idcentro_costo` = c.`idcentro_costo`
LEFT JOIN `estado_contrato` ec ON ec.`idestado_contrato` = k.`estado_contrato_idestado_contrato`
GROUP BY c.`idcentro_costo`, c.`codigo`, c.`nombre`, c.`vigente`
ORDER BY c.`vigente` DESC, c.`nombre`;
