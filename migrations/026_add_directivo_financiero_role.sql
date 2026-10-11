-- Agrega el rol directivoFinanciero al ENUM de usuarios
--
-- NOTA (2026-09-15): este archivo fue recuperado desde producción (commit 1092305)
-- con una lista de roles ya desactualizada. Se corrigió para incluir también
-- 'disenador' y 'recursosHumanos' (agregados después por las migraciones 029/031
-- y 037) y así no revertir el ENUM si esta migración se corre después de esas.
ALTER TABLE users
  MODIFY COLUMN role ENUM(
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
    'recursosHumanos'
  ) NOT NULL DEFAULT 'technician';
