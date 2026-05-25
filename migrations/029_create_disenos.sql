-- Migración 029: Crear tabla de diseños y tabla de imágenes asociadas

CREATE TABLE IF NOT EXISTS disenos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    descripcion LONGTEXT NOT NULL,
    estado ENUM('pendiente', 'en_progreso', 'completado') NOT NULL DEFAULT 'pendiente',
    solicitante_id INT NOT NULL,
    disenador_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_disenos_solicitante FOREIGN KEY (solicitante_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_disenos_disenador FOREIGN KEY (disenador_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS diseno_imagenes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    diseno_id INT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_diseno_imagenes_diseno FOREIGN KEY (diseno_id) REFERENCES disenos(id) ON DELETE CASCADE
);

CREATE INDEX idx_disenos_solicitante ON disenos(solicitante_id);
CREATE INDEX idx_disenos_disenador ON disenos(disenador_id);
CREATE INDEX idx_disenos_estado ON disenos(estado);
CREATE INDEX idx_diseno_imagenes_diseno ON diseno_imagenes(diseno_id);
