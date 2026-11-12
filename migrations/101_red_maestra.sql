-- =====================================================================
-- 101_red_maestra.sql — Módulo Red Maestra (RM) de Claro, para el admin del Gestor
-- (claude/modulo recursoshumanos.md §52).
--
-- La Red Maestra es el registro que Claro lleva de los agentes del aliado. DOCUMENTO, CÉDULA,
-- NOMBRE, CAMPAÑA y USUARIO SSFF salen de la ficha de RRHH (users_company + contrato); aquí solo
-- se guarda lo que ingresa el admin:
--   * red_maestra: la ficha RM de cada empleado (novedades, estado agente, cargo RM, estado RM).
--   * red_maestra_requerimiento: el historial de requerimientos enviados a Claro
--     (número REQ, fecha de envío, observación = tipo de requerimiento, estado).
--   * red_maestra_opcion: las listas desplegables, editables por el admin.
--
-- Solo une por id entero con users_company/users: no compara texto entre tablas, así que el
-- collation distinto de producción (CLAUDE.md, error 1267) no aplica.
-- Idempotente: CREATE TABLE IF NOT EXISTS e INSERT IGNORE sobre la UNIQUE (campo, valor).
-- =====================================================================

CREATE TABLE IF NOT EXISTS red_maestra_opcion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    campo ENUM('cargo_rm', 'estado_rm', 'observacion', 'estado_requerimiento') NOT NULL,
    valor VARCHAR(120) NOT NULL,
    orden INT NOT NULL DEFAULT 0,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_red_maestra_opcion (campo, valor)
);

CREATE TABLE IF NOT EXISTS red_maestra (
    id INT AUTO_INCREMENT PRIMARY KEY,
    users_company_id INT NOT NULL,
    novedades TEXT NULL,
    cargo_rm_id INT NULL,
    estado_rm_id INT NULL,
    actualizado_por INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_red_maestra_empleado (users_company_id),
    CONSTRAINT fk_rm_empleado FOREIGN KEY (users_company_id) REFERENCES users_company (id) ON DELETE CASCADE,
    CONSTRAINT fk_rm_cargo_rm FOREIGN KEY (cargo_rm_id) REFERENCES red_maestra_opcion (id),
    CONSTRAINT fk_rm_estado_rm FOREIGN KEY (estado_rm_id) REFERENCES red_maestra_opcion (id),
    CONSTRAINT fk_rm_actualizado_por FOREIGN KEY (actualizado_por) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS red_maestra_requerimiento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    users_company_id INT NOT NULL,
    numero VARCHAR(40) NOT NULL,
    fecha_envio DATE NULL,
    observacion_id INT NULL,
    estado_requerimiento_id INT NULL,
    creado_por INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_rm_req_empleado_numero (users_company_id, numero),
    KEY idx_rm_req_fecha (fecha_envio),
    CONSTRAINT fk_rm_req_empleado FOREIGN KEY (users_company_id) REFERENCES users_company (id) ON DELETE CASCADE,
    CONSTRAINT fk_rm_req_observacion FOREIGN KEY (observacion_id) REFERENCES red_maestra_opcion (id),
    CONSTRAINT fk_rm_req_estado FOREIGN KEY (estado_requerimiento_id) REFERENCES red_maestra_opcion (id),
    CONSTRAINT fk_rm_req_creado_por FOREIGN KEY (creado_por) REFERENCES users (id) ON DELETE SET NULL
);

-- Valores iniciales de las listas: los de la PLANTILLA RM EJEMPLO más los obvios de cada lista.
-- El admin los edita, desactiva o agrega desde la pantalla ("Listas"); el cargue de Excel agrega
-- los que no existan.
INSERT IGNORE INTO red_maestra_opcion (campo, valor, orden) VALUES
    ('cargo_rm', 'NO TRAMITADO', 1),
    ('cargo_rm', 'WHATSAPP', 2),
    ('cargo_rm', 'WEB CALL BACK (IN)', 3),
    ('estado_rm', 'ACTIVO RM', 1),
    ('estado_rm', 'INACTIVO RM', 2),
    ('observacion', 'INGRESO', 1),
    ('observacion', 'CAMBIO DE CAMPAÑA', 2),
    ('observacion', 'RETIRO', 3),
    ('estado_requerimiento', 'PENDIENTE', 1),
    ('estado_requerimiento', 'EN PROCESO', 2),
    ('estado_requerimiento', 'FINALIZADA', 3);
