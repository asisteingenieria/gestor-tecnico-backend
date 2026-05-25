ALTER TABLE disenos
  MODIFY COLUMN estado ENUM('pendiente','en_progreso','en_espera','completado','devuelto')
  NOT NULL DEFAULT 'pendiente';
