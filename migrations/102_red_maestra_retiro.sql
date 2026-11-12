-- =====================================================================
-- 102_red_maestra_retiro.sql — Fecha de "retiro Red Maestra" de los retirados de Claro
-- (claude/modulo recursoshumanos.md §53, asistencia.md §59).
--
-- Cuando RRHH registra el retiro de un empleado de Claro, sus jefes (jefe inmediato, jefe de área y
-- gestor de asistencia del contrato retirado) reciben un aviso en la campana del portal y, en
-- Equipo → Retiros, eligen la fecha en que se hizo el retiro en la Red Maestra de Claro. El admin la
-- ve (y puede corregirla) en el módulo Red Maestra.
--
--   red_maestra.fecha_retiro_rm                 fecha del retiro en la Red Maestra (NULL = pendiente)
--   red_maestra.retiro_rm_por_users_company_id  ficha del jefe que la registró (entre con usuario o cédula)
--   red_maestra.retiro_rm_por_user_id           usuario del sistema que la registró (el admin)
--   red_maestra.retiro_rm_registrado_en         cuándo se registró (UTC)
--
-- Requiere la 101. El aviso de la campana usa notificacion_asistencia (084) con tipo 'retiro_empleado',
-- sin columnas nuevas. Idempotente: solo agrega las columnas si no existen. No compara texto entre tablas.
-- =====================================================================

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'red_maestra'
      AND COLUMN_NAME = 'fecha_retiro_rm'
);

SET @sql := IF(@existe = 0,
    'ALTER TABLE red_maestra
        ADD COLUMN fecha_retiro_rm DATE NULL AFTER estado_rm_id,
        ADD COLUMN retiro_rm_por_users_company_id INT NULL AFTER fecha_retiro_rm,
        ADD COLUMN retiro_rm_por_user_id INT NULL AFTER retiro_rm_por_users_company_id,
        ADD COLUMN retiro_rm_registrado_en DATETIME NULL AFTER retiro_rm_por_user_id,
        ADD CONSTRAINT fk_rm_retiro_por_ficha FOREIGN KEY (retiro_rm_por_users_company_id) REFERENCES users_company (id) ON DELETE SET NULL,
        ADD CONSTRAINT fk_rm_retiro_por_usuario FOREIGN KEY (retiro_rm_por_user_id) REFERENCES users (id) ON DELETE SET NULL',
    'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
