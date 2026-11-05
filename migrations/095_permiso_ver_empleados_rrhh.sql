-- 095: Permiso por usuario para ver el módulo de empleados de RRHH en SOLO LECTURA.
--
-- `users.ver_empleados_rrhh` (0/1) es independiente del rol. Un usuario con la bandera en 1 ve
-- exactamente lo mismo que el admin en "Empleados RRHH": la lista, la ficha completa y los
-- documentos (ver y descargar). NO crea, edita, elimina, importa, retira ni traspasa, ni entra a
-- novedades/traspasos/vacaciones (eso lo sigue bloqueando `verificarGestionRRHH`). Sirve para
-- habilitarle esa vista a un usuario puntual de otro rol (p. ej. un técnico) sin abrirle el rol
-- completo ni darle escritura.
--
-- El admin ya ve la vista por su rol; esta bandera no lo afecta. Frontend: ítem de menú
-- "Empleados RRHH" (/empleados-consulta) y checkbox en el panel de usuarios.
-- Ver claude/modulo recursoshumanos.md §47.
--
-- Idempotente: solo agrega la columna si no existe.

SET @existe := (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'ver_empleados_rrhh'
);

SET @sql := IF(@existe = 0,
    'ALTER TABLE users ADD COLUMN ver_empleados_rrhh TINYINT(1) NOT NULL DEFAULT 0 AFTER users_company_id',
    'DO 0'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
