-- =====================================================================
-- 071 — Usuarios de la pantalla gris de AsisLock (asistencia.md §31)
--
-- La pantalla gris es el bloqueo de AsisLock donde el empleado inicia sesión en su equipo. Sus
-- credenciales son DISTINTAS de la cuenta por cédula del portal de asistencia (`cuenta_empleado`,
-- 065): cada una tiene su propia clave.
--
--   1. `usuario_pantalla_gris`: una por ficha de RRHH. Usuario = cédula, clave inicial = cédula
--      (bcrypt), cambio obligatorio en el primer ingreso. AsisLock no guarda claves: valida cada
--      inicio de sesión contra Gestor (POST /api/integraciones/asislock/v1/pantalla-gris/validar).
--   2. `asislock_envio_saliente`: avisos a AsisLock (alta, baja, reactivación) con reintentos,
--      igual que el outbox hacia Hydra (061). Lo despacha scripts/despacharEnviosAsislock.js.
--
-- No crea usuarios para las fichas existentes (la clave va en bcrypt y no se puede calcular en
-- SQL): eso lo hace `node scripts/crearUsuariosPantallaGris.js --aplicar`.
-- Idempotente (IF NOT EXISTS).
-- =====================================================================

CREATE TABLE IF NOT EXISTS `usuario_pantalla_gris` (
  `idusuario_pantalla_gris` INT NOT NULL AUTO_INCREMENT,
  `users_company_id` INT NOT NULL,
  `usuario` VARCHAR(50) NOT NULL COMMENT 'cédula de la ficha',
  `password` VARCHAR(255) NOT NULL COMMENT 'bcrypt',
  `debe_cambiar_password` TINYINT(1) NOT NULL DEFAULT 1,
  `intentos_fallidos` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `bloqueado_hasta` DATETIME NULL COMMENT 'UTC, tras varios intentos fallidos seguidos',
  `ultimo_ingreso` DATETIME NULL COMMENT 'UTC',
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idusuario_pantalla_gris`),
  UNIQUE KEY `uq_usuario_pantalla_gris_ficha` (`users_company_id`),
  UNIQUE KEY `uq_usuario_pantalla_gris_usuario` (`usuario`),
  CONSTRAINT `fk_usuario_pantalla_gris_ficha` FOREIGN KEY (`users_company_id`) REFERENCES `users_company` (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Sin FK a users_company: el aviso de baja de una ficha borrada tiene que sobrevivirla.
-- El payload no lleva claves.
CREATE TABLE IF NOT EXISTS `asislock_envio_saliente` (
  `idasislock_envio_saliente` INT NOT NULL AUTO_INCREMENT,
  `evento` ENUM('alta','baja','reactivacion') NOT NULL,
  `users_company_id` INT NOT NULL,
  `usuario` VARCHAR(50) NOT NULL,
  `payload` JSON NOT NULL,
  `idempotency_key` CHAR(36) NOT NULL COMMENT 'UUID v4, AsisLock no aplica dos veces la misma',
  `estado` ENUM('pendiente','enviado','fallido') NOT NULL DEFAULT 'pendiente',
  `intentos` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `proximo_intento` DATETIME NOT NULL COMMENT 'UTC',
  `ultimo_error` VARCHAR(500) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idasislock_envio_saliente`),
  UNIQUE KEY `uq_asislock_envio_idempotency` (`idempotency_key`),
  KEY `idx_asislock_envio_pendiente` (`estado`, `proximo_intento`),
  KEY `idx_asislock_envio_ficha` (`users_company_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
