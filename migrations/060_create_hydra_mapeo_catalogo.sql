-- Migración 060: mapeo de catálogos Hydra → Gestor
-- Motor: InnoDB | Charset: utf8mb4
-- Ver conexionhydra.md §4.2.
--
-- Hydra envía códigos de catálogo (nunca IDs). Al resolverlos, Gestor busca primero
-- aquí y, si no hay fila, por nombre normalizado. Lo que no casa queda "sin mapear" y
-- RRHH elige el valor correcto desde la UI, con la opción de recordarlo (una fila nueva).
--
-- Nace VACÍA a propósito: un seed con IDs de Gestor quemados es justo lo que dejó
-- 049/054/057 sin poder correr en producción. Idempotente (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS `hydra_mapeo_catalogo` (
  `idhydra_mapeo_catalogo` INT NOT NULL AUTO_INCREMENT,
  `catalogo` VARCHAR(40) NOT NULL COMMENT 'Ver CATALOGOS en domain/contratacionHydra/mapearPayloadHydra.js',
  `valor_hydra` VARCHAR(150) NOT NULL COMMENT 'Código de Hydra, tal como llega',
  `id_gestor` INT NOT NULL COMMENT 'ID en la tabla de catálogo correspondiente de Gestor',
  `creado_por_user_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_mapeo_catalogo`),
  UNIQUE KEY `uq_hydra_mapeo` (`catalogo`, `valor_hydra`),
  CONSTRAINT `fk_hydra_mapeo_creado_por`
    FOREIGN KEY (`creado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
