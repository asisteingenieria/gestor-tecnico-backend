-- Migración 028: Crear tabla agentes y agregar FK agente_id en activos

CREATE TABLE IF NOT EXISTS agentes (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    cedula     VARCHAR(20)  NOT NULL UNIQUE COMMENT 'Cédula del agente (única)',
    nombres    VARCHAR(100) NOT NULL,
    apellidos  VARCHAR(100) NOT NULL,
    campana    VARCHAR(100) NOT NULL COMMENT 'Campaña a la que pertenece el agente',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_agentes_cedula   ON agentes(cedula);
CREATE INDEX idx_agentes_campana  ON agentes(campana);

-- Agregar FK en activos apuntando al agente asignado
-- Un agente puede tener varios activos; cada activo pertenece a un agente (o ninguno)
ALTER TABLE activos
    ADD COLUMN agente_id INT NULL
        COMMENT 'FK al agente al que está asignado este activo'
    AFTER tipo;

ALTER TABLE activos
    ADD CONSTRAINT fk_activos_agente
    FOREIGN KEY (agente_id) REFERENCES agentes(id) ON DELETE SET NULL;

CREATE INDEX idx_activos_agente_id ON activos(agente_id);
