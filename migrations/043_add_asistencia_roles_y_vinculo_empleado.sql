-- Migración 043: roles del módulo de asistencia + vínculo login <-> ficha de RRHH
-- Reescribe el ENUM completo de users.role (MySQL no permite agregar un solo valor).
-- Incluye todos los roles vigentes tras la migración 037 más los dos nuevos.

ALTER TABLE users MODIFY COLUMN role ENUM(
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
    'empleado'
) NOT NULL DEFAULT 'technician';

-- Vincula la cuenta de login con la ficha de RRHH. Nullable: los usuarios existentes
-- (técnicos, coordinadores, etc.) no tienen ficha en users_company y no se rompen.
ALTER TABLE users
  ADD COLUMN users_company_id INT NULL AFTER departamento,
  ADD CONSTRAINT fk_users_users_company
    FOREIGN KEY (users_company_id) REFERENCES users_company(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD UNIQUE KEY uq_users_users_company (users_company_id);
