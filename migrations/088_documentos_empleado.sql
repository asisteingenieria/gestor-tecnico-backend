-- Migración 088: documentos del empleado
-- Motor: InnoDB | Charset: utf8mb4
-- Ver claude/modulo recursoshumanos.md §42.
--
-- Después de registrar un empleado, RRHH carga dos PDF unificados en su ficha:
--   * documentacion_empleado — Documentación del empleado
--   * contrato_anexos        — Contrato y anexos
-- Aplica a todos los empleados (manuales, carga Excel y Hydra). No es obligatorio para
-- crear el empleado: la ficha y la lista muestran los que faltan.
--
-- Uno por tipo y empleado: subir otro lo reemplaza. El archivo vive en
-- storage/empleados/ (privado, NO en uploads/, que se sirve sin login) y solo se
-- descarga por la API con sesión de RRHH. Hasta 50 MB por PDF.
--
-- Idempotente (IF NOT EXISTS). Sin dependencias.

CREATE TABLE IF NOT EXISTS `empleado_documento` (
  `idempleado_documento` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `tipo` ENUM('documentacion_empleado', 'contrato_anexos') NOT NULL,
  `archivo` VARCHAR(255) NOT NULL COMMENT 'nombre del archivo en storage/empleados/ (generado, no el original)',
  `nombre_original` VARCHAR(255) NOT NULL,
  `mime` VARCHAR(100) NOT NULL,
  `tamano` INT UNSIGNED NOT NULL,
  `subido_por_user_id` INT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idempleado_documento`),
  UNIQUE KEY `uq_empleado_documento_tipo` (`users_company_id`, `tipo`),
  CONSTRAINT `fk_empleado_documento_empleado`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
