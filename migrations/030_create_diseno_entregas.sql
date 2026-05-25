-- Migración 030: Tabla de archivos de entrega de diseños

CREATE TABLE IF NOT EXISTS diseno_entregas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    diseno_id INT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mimetype VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
    size BIGINT NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_diseno_entregas_diseno FOREIGN KEY (diseno_id) REFERENCES disenos(id) ON DELETE CASCADE
);

CREATE INDEX idx_diseno_entregas_diseno ON diseno_entregas(diseno_id);
