CREATE TABLE IF NOT EXISTS diseno_devoluciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    diseno_id INT NOT NULL,
    nota TEXT NOT NULL,
    numero_devolucion INT NOT NULL,
    solicitante_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (diseno_id) REFERENCES disenos(id) ON DELETE CASCADE,
    FOREIGN KEY (solicitante_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_diseno_devoluciones_diseno (diseno_id)
);
