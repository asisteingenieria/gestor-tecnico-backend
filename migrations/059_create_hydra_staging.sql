-- Migración 059: staging de la conexión Hydra → Gestor (contratación)
-- Motor: InnoDB | Charset: utf8mb4
-- Ver conexionhydra.md §4.1 y §6.
--
-- Hydra envía candidatos aprobados en lotes. Aterrizan aquí, NUNCA directo en
-- users_company: RRHH completa lo que Hydra no tiene, verifica sección por sección y
-- solo entonces el lote se registra como empleados (UserCompany).
--
-- Idempotente (IF NOT EXISTS): no hay runner de migraciones, así que correrla dos
-- veces no debe romper ni borrar nada. Sin IDs de catálogo quemados.

-- ---------------------------------------------------------------------
-- hydra_lote: un envío de Hydra (un grupo de formación / una fecha de ingreso)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hydra_lote` (
  `idhydra_lote` INT NOT NULL AUTO_INCREMENT,
  `lote_externo_id` VARCHAR(64) NOT NULL COMMENT 'ID que genera Hydra; llave de idempotencia',
  `nombre` VARCHAR(150) NOT NULL,
  `fecha_ingreso_sugerida` DATE NULL COMMENT 'Fecha de negocio (Bogotá), no un instante',
  `estado` ENUM('abierto','listo','registrado','cancelado') NOT NULL DEFAULT 'abierto'
    COMMENT 'Derivado de sus candidatos (domain/contratacionHydra); no se edita a mano',
  `registrado_por_user_id` INT NULL,
  `registrado_en` DATETIME NULL COMMENT 'UTC',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_lote`),
  UNIQUE KEY `uq_hydra_lote_externo` (`lote_externo_id`),
  KEY `idx_hydra_lote_estado` (`estado`, `created_at`),
  CONSTRAINT `fk_hydra_lote_registrado_por`
    FOREIGN KEY (`registrado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- hydra_candidato: un candidato del lote, en borrador hasta registrarse
-- ---------------------------------------------------------------------
-- `datos_hydra` es el payload tal como llegó (última versión aceptada).
-- `datos_empleado` es el borrador que edita RRHH, con la MISMA forma que el body de
-- POST /api/users-company: al registrar se pasa tal cual a UserCompany.
-- Las columnas de identificación/nombre son copias para listar y buscar.
CREATE TABLE IF NOT EXISTS `hydra_candidato` (
  `idhydra_candidato` INT NOT NULL AUTO_INCREMENT,
  `hydra_lote_id` INT NOT NULL,
  `hydra_candidato_externo_id` INT UNSIGNED NOT NULL COMMENT 'candidatos.id en Hydra',
  `tipo_identificacion` VARCHAR(10) NOT NULL COMMENT 'Código tal como lo envía Hydra (CC, CE, PPT...)',
  `numero_identificacion` VARCHAR(20) NOT NULL,
  `nombre_completo` VARCHAR(200) NOT NULL,
  `cargo_hydra` VARCHAR(120) NULL,
  `datos_hydra` JSON NOT NULL,
  `version_hydra` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Se ignoran reenvíos con versión <= a esta',
  `datos_empleado` JSON NOT NULL,
  `estado` ENUM('pendiente','listo','registrado','descartado','cancelado_hydra') NOT NULL DEFAULT 'pendiente'
    COMMENT 'Derivado de la completitud y las verificaciones; no se edita a mano',
  `motivo_descarte` VARCHAR(255) NULL,
  `users_company_existente_id` INT NULL COMMENT 'Reintegro: la cédula ya existía en users_company al recibirlo',
  `users_company_id` INT NULL COMMENT 'Empleado creado al registrar el lote',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_candidato`),
  UNIQUE KEY `uq_hydra_candidato_externo` (`hydra_candidato_externo_id`),
  KEY `idx_hydra_candidato_lote` (`hydra_lote_id`, `estado`),
  KEY `idx_hydra_candidato_identificacion` (`numero_identificacion`),
  CONSTRAINT `fk_hydra_candidato_lote`
    FOREIGN KEY (`hydra_lote_id`) REFERENCES `hydra_lote` (`idhydra_lote`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_hydra_candidato_existente`
    FOREIGN KEY (`users_company_existente_id`) REFERENCES `users_company` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_hydra_candidato_users_company`
    FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- ---------------------------------------------------------------------
-- hydra_candidato_verificacion: el checkbox "Verificado" de cada sección
-- ---------------------------------------------------------------------
-- Existe la fila = la sección está marcada. `hash_contenido` es el SHA-256 de la
-- sección al momento de marcarla: si después cambia el contenido, el hash ya no
-- coincide y la sección vuelve a "pendiente" sin que nadie tenga que desmarcarla.
-- Las secciones válidas viven en domain/contratacionHydra/secciones.js; el ENUM debe
-- mantenerse alineado con esa lista.
CREATE TABLE IF NOT EXISTS `hydra_candidato_verificacion` (
  `hydra_candidato_id` INT NOT NULL,
  `seccion` ENUM('personal','contrato','salario','seguridad_social',
                 'cuenta_bancaria','direccion_contacto','dotacion') NOT NULL,
  `hash_contenido` CHAR(64) NOT NULL,
  `verificado_por_user_id` INT NULL,
  `verificado_en` DATETIME NOT NULL COMMENT 'UTC',
  PRIMARY KEY (`hydra_candidato_id`, `seccion`),
  CONSTRAINT `fk_hydra_verificacion_candidato`
    FOREIGN KEY (`hydra_candidato_id`) REFERENCES `hydra_candidato` (`idhydra_candidato`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_hydra_verificacion_user`
    FOREIGN KEY (`verificado_por_user_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
