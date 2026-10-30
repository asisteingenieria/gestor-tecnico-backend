-- Migración 087: documentos de contratación que envía Hydra
-- Motor: InnoDB | Charset: utf8mb4
-- Ver conexionhydra.md §15.
--
-- Al enviar a contratación, Hydra manda además de los datos del candidato:
--   * la hoja de vida y el tratamiento de datos firmados en FirmaCloud (obligatorios:
--     Hydra no deja enviar a quien no los firmó);
--   * los soportes de antecedentes que tenga cargados (ADRES, Policía, Comparendos,
--     Procuraduría), cada uno por separado. Si falta alguno, la nota de Contratación
--     viaja en el payload del candidato (datos_hydra → documentos).
--
-- Cada archivo llega en su propia petición (PUT /candidatos/:id/documentos/:tipo) y
-- se guarda en storage/contratacion-hydra/ (privado, como los soportes de novedades:
-- NO en uploads/, que se sirve sin login). Uno por tipo y candidato: un reenvío
-- reemplaza el anterior.
--
-- Los documentos se quedan ligados al candidato del staging. La ficha del empleado los
-- muestra por hydra_candidato.users_company_id, sin copiarlos.
--
-- Idempotente (IF NOT EXISTS). Sin dependencias más allá de la 059.

CREATE TABLE IF NOT EXISTS `hydra_candidato_documento` (
  `idhydra_candidato_documento` INT NOT NULL AUTO_INCREMENT,
  `hydra_candidato_id` INT NOT NULL,
  `tipo` VARCHAR(40) NOT NULL COMMENT 'Código de Hydra: hoja_vida_firmada, tratamiento_datos_firmado, antecedente_<codigo>',
  `nombre` VARCHAR(120) NOT NULL COMMENT 'Nombre para mostrar, tal como lo envía Hydra',
  `nombre_original` VARCHAR(255) NOT NULL COMMENT 'Solo para mostrar y descargar; nunca se usa como ruta',
  `mime` VARCHAR(100) NOT NULL,
  `tamano_bytes` INT UNSIGNED NOT NULL,
  `sha256` CHAR(64) NOT NULL COMMENT 'Hash que envió Hydra y que se comprobó al recibir',
  `archivo` VARCHAR(255) NOT NULL COMMENT 'Nombre generado en storage/contratacion-hydra/',
  `recibido_en` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_candidato_documento`),
  UNIQUE KEY `uq_hydra_documento_tipo` (`hydra_candidato_id`, `tipo`),
  CONSTRAINT `fk_hydra_documento_candidato`
    FOREIGN KEY (`hydra_candidato_id`) REFERENCES `hydra_candidato` (`idhydra_candidato`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
