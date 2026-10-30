-- =====================================================================
-- Migración 089: rol SST y control de exámenes médicos en Contratación Hydra
-- Motor: InnoDB | Charset: utf8mb4
-- Ver conexionhydra.md §16.
--
-- SST recibe los candidatos que envía Hydra y lleva el último control antes del
-- registro: marca si el candidato asistió a los exámenes médicos y, si asistió, si
-- los aprobó. RRHH sigue completando los datos, pero solo registra a los aprobados.
--
--   pendiente ─asistió→ asistio ─aprobó→ aprobado   (registrable)
--       │                  └─no aprobó (nota obligatoria)→ no_aprobado  (candidato 'no_apto')
--       └─no asistió (nota opcional)→ no_asistio ─Hydra: continuar→ reagendado
--                                         │                 └─Hydra: no continuar→ candidato 'cancelado_hydra'
--                                         └─(nueva cita) SST vuelve a marcar asistencia
--
-- Cada marca queda en `hydra_candidato_examen` (no se borra ni se edita): si no asistió y
-- después se le reagenda, la traza conserva el "no asistió", su nota y la decisión de Hydra.
-- Las marcas de SST se avisan a Hydra por el outbox (`candidato_examen`).
--
-- Va ANTES del código. NO es idempotente (ALTER ... ADD COLUMN): correrla una sola vez.
-- =====================================================================

-- 1. Rol ---------------------------------------------------------------------------------
-- MySQL no admite agregar un valor suelto al ENUM: se reescribe completo (ver 072).
ALTER TABLE `users` MODIFY COLUMN `role` ENUM(
    'admin',
    'supervisor',
    'coordinador',
    'jefe_operaciones',
    'technician',
    'administrativo',
    'anonimo',
    'gestorActivos',
    'tecnicoInventario',
    'directivoFinanciero',
    'disenador',
    'recursosHumanos',
    'director_operaciones',
    'empleado',
    'financiera',
    'sst'
) NOT NULL DEFAULT 'technician';

-- 2. Estado del examen en el candidato ---------------------------------------------------
-- NULL = el candidato es anterior a SST y ya estaba cerrado (registrado, descartado o
-- cancelado): no aplica.
ALTER TABLE `hydra_candidato`
  MODIFY COLUMN `estado` ENUM('pendiente','listo','registrado','descartado','cancelado_hydra','no_apto')
    NOT NULL DEFAULT 'pendiente',
  ADD COLUMN `examen_estado` ENUM('pendiente','no_asistio','reagendado','asistio','aprobado','no_aprobado')
    NULL DEFAULT 'pendiente'
    COMMENT 'Exámenes médicos (SST). Solo los aprobados se registran. NULL = anterior a SST'
    AFTER `estado`;

UPDATE `hydra_candidato` SET `examen_estado` = NULL
WHERE `estado` IN ('registrado', 'descartado', 'cancelado_hydra');

-- Los candidatos en curso pasan a necesitar el examen: 'listo' ya no basta para registrar.
UPDATE `hydra_candidato` SET `estado` = 'pendiente' WHERE `estado` = 'listo';
UPDATE `hydra_lote` SET `estado` = 'abierto' WHERE `estado` = 'listo';

-- 3. Traza de exámenes ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hydra_candidato_examen` (
  `idhydra_candidato_examen` INT NOT NULL AUTO_INCREMENT,
  `hydra_candidato_id` INT NOT NULL,
  `evento` ENUM('asistio','no_asistio','aprobado','no_aprobado','continuidad','no_continuidad') NOT NULL
    COMMENT 'asistio..no_aprobado los marca SST; continuidad/no_continuidad los decide Hydra',
  `nota` VARCHAR(1000) NULL,
  `origen` ENUM('gestor','hydra') NOT NULL DEFAULT 'gestor',
  `users_id` INT NULL COMMENT 'Quién marcó en Gestor; NULL si vino de Hydra',
  `usuario_hydra` VARCHAR(150) NULL COMMENT 'Nombre de quien decidió en Hydra',
  `creado_en` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`idhydra_candidato_examen`),
  KEY `idx_hydra_examen_candidato` (`hydra_candidato_id`, `idhydra_candidato_examen`),
  CONSTRAINT `fk_hydra_examen_candidato`
    FOREIGN KEY (`hydra_candidato_id`) REFERENCES `hydra_candidato` (`idhydra_candidato`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 4. Aviso a Hydra --------------------------------------------------------------------------
ALTER TABLE `hydra_envio_saliente`
  MODIFY COLUMN `tipo` ENUM('candidato_registrado','candidato_descartado','candidato_examen') NOT NULL;
