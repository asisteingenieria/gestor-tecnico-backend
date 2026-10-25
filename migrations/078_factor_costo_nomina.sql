-- 078 · Factores de prestaciones sociales para el costo de nómina del Home de financiera
-- (asistencia.md §38).
--
-- El costo mensual de nómina se calcula en vivo: salario prorrateado por días + bonos + prestaciones.
-- Las prestaciones son un porcentaje del salario básico (los bonos no prestacionales y de cafetería
-- no son base). Los porcentajes viven aquí para poder ajustarlos sin tocar código.
--
-- Valores de ley en Colombia (provisión mensual sobre el salario):
--   cesantías 8,33 % · intereses sobre cesantías 1 % (12 % anual de las cesantías) · prima de
--   servicios 8,33 % · vacaciones 4,17 %  → 21,83 %.
-- No incluye aportes a seguridad social ni parafiscales (salud, pensión, ARL, caja, ICBF, SENA):
-- se agregarían aquí con su propia categoría si se decide sumarlos.
--
-- Idempotente: se puede correr dos veces. Sin dependencias de IDs.

CREATE TABLE IF NOT EXISTS factor_costo_nomina (
    codigo      VARCHAR(40)   NOT NULL,
    nombre      VARCHAR(80)   NOT NULL,
    categoria   ENUM('prestacion') NOT NULL DEFAULT 'prestacion',
    porcentaje  DECIMAL(6,3)  NOT NULL COMMENT 'Porcentaje sobre el salario básico mensual',
    orden       TINYINT       NOT NULL DEFAULT 0,
    activo      TINYINT(1)    NOT NULL DEFAULT 1,
    updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (codigo)
);

INSERT INTO factor_costo_nomina (codigo, nombre, categoria, porcentaje, orden) VALUES
    ('cesantias',           'Cesantías',                 'prestacion', 8.330, 1),
    ('intereses_cesantias', 'Intereses sobre cesantías', 'prestacion', 1.000, 2),
    ('prima',               'Prima de servicios',        'prestacion', 8.330, 3),
    ('vacaciones',          'Vacaciones',                'prestacion', 4.170, 4)
ON DUPLICATE KEY UPDATE codigo = codigo;
