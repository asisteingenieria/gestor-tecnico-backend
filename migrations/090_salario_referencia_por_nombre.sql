-- =====================================================================
--  Migracion 090: carga de `salario_referencia` (sueldo sugerido por Cliente + Cargo) para
--  PRODUCCION, buscando cliente y cargo por NOMBRE en vez de por ID.
--
--  La 054 sembro esta tabla con IDs quemados de la BD local y nunca corrio en produccion: alla se
--  creo la tabla vacia a mano el 2026-10-01 (claude/modulo recursoshumanos.md §29.3). Con la tabla
--  vacia, el formulario de nuevo empleado no sugiere salario ni filtra el Cargo por Cliente.
--
--  Datos: las 58 filas que hoy tiene la BD local (las de la 054, hoja "Salarios" de
--  Informacion 280926 (1).xlsx, con los ajustes posteriores de §29). En la BD local no cambia nada.
--
--  - Idempotente: no inserta una fila (cliente, cargo, salario) que ya exista.
--  - Una fila cuyo cliente o cargo no exista con ese nombre se salta; el SELECT del final las
--    lista para resolverlas a mano.
--  - Nombres comparados con COLLATE utf8mb4_0900_ai_ci en los dos lados (sin mayusculas ni tildes):
--    en produccion `cliente`/`cargo` pueden tener otro collation (error 1267, CLAUDE.md).
-- =====================================================================

CREATE TABLE IF NOT EXISTS `salario_referencia` (
  `idsalario_referencia` INT NOT NULL AUTO_INCREMENT,
  `Cliente_idCliente` INT NOT NULL,
  `cargo_idcargo` INT NOT NULL,
  `salario` DECIMAL(12,2) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`idsalario_referencia`),
  KEY `idx_salario_referencia_cliente_cargo` (`Cliente_idCliente`, `cargo_idcargo`),
  CONSTRAINT `fk_salario_referencia_cliente`
    FOREIGN KEY (`Cliente_idCliente`) REFERENCES `cliente` (`idCliente`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_salario_referencia_cargo`
    FOREIGN KEY (`cargo_idcargo`) REFERENCES `cargo` (`idcargo`)
    ON DELETE RESTRICT ON UPDATE CASCADE
);

DROP TEMPORARY TABLE IF EXISTS tmp_salario_referencia;
CREATE TEMPORARY TABLE tmp_salario_referencia (
  cliente VARCHAR(150) NOT NULL,
  cargo VARCHAR(150) NOT NULL,
  salario DECIMAL(12,2) NOT NULL
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci;

INSERT INTO tmp_salario_referencia (cliente, cargo, salario) VALUES
  ('Asiste', 'ABOGADO LABORAL', 3200000.00),
  ('Asiste', 'ANALISTA ADMINSTRATIVA Y CONTABLE', 1900000.00),
  ('Asiste', 'ANALISTA DE GESTIÓN HUMANA', 1925996.00),
  ('Asiste', 'ANALISTA DE RECLUTAMIENTO', 1925996.00),
  ('Asiste', 'ANALISTA JURIDICO', 1925996.00),
  ('Asiste', 'AUXILIAR DE GESTION HUMANA', 1925996.00),
  ('Asiste', 'AUXILIAR DE SERVICIOS GENERALES', 1750905.00),
  ('Asiste', 'AYUDANTE DE OBRA', 2200000.00),
  ('Asiste', 'AYUDANTE DE OBRA', 2300000.00),
  ('Asiste', 'AYUDANTE DE OBRA', 2500000.00),
  ('Asiste', 'COMMUNITY MANAGER', 2300000.00),
  ('Asiste', 'CONSERJE', 2000000.00),
  ('Asiste', 'CONTADOR', 4000000.00),
  ('Asiste', 'COORDINADOR DE CONTRATACION', 2420000.00),
  ('Asiste', 'COORDINADOR DE DESARROLLO', 3000000.00),
  ('Asiste', 'COORDINADOR DE NOMINA', 2700000.00),
  ('Asiste', 'COORDINADOR DE RECLUTAMIENTO Y SELECCIÓN', 2500000.00),
  ('Asiste', 'COORDINADOR DE USUARIOS', 2500000.00),
  ('Asiste', 'COORDINADOR TECNICO', 2400000.00),
  ('Asiste', 'DESARROLLADOR FULLSTACK', 2600000.00),
  ('Asiste', 'DESARROLLADOR WEB', 2600000.00),
  ('Asiste', 'DIRECTOR DE GESTION HUMANA', 5000000.00),
  ('Asiste', 'DIRECTOR DE TECNOLOGIA', 4070000.00),
  ('Asiste', 'DIRECTOR FINANCIERO', 5000000.00),
  ('Asiste', 'DISEÑADOR GRAFICO', 2750000.00),
  ('Asiste', 'GESTOR DE COMPRAS Y LOGISTICA', 2800000.00),
  ('Asiste', 'JEFE DE MANTEMINIENTO', 2627500.00),
  ('Asiste', 'RECEPCIONISTA', 1750905.00),
  ('Asiste', 'TECNICO EN SOPORTE DE SISTEMAS', 1925000.00),
  ('Claro', 'AGENTE CALL CENTER', 1750905.00),
  ('Claro', 'ANALISTA DE CALIDAD', 1925996.00),
  ('Claro', 'ANALISTA PQR', 1925996.00),
  ('Claro', 'BACKOFFICE', 1850000.00),
  ('Claro', 'COORDINADOR BACKOFFICE PE', 2000000.00),
  ('Claro', 'COORDINADOR CALL', 2223000.00),
  ('Claro', 'DATAMARSHALL SENIOR', 2485000.00),
  ('Claro', 'DIRECTOR DE FORMACION', 4070000.00),
  ('Claro', 'DIRECTOR DE OPERACIONES', 4070000.00),
  ('Claro', 'FORMADOR', 2000000.00),
  ('Claro', 'FORMADOR SENIOR', 2150000.00),
  ('Claro', 'GTR', 2180000.00),
  ('Claro', 'JEFE DE BACKOFFICE', 3124000.00),
  ('Claro', 'JEFE DE OPERACIONES', 3124000.00),
  ('Claro', 'LEGALIZADOR', 1850000.00),
  ('Claro', 'TEAM LEADER', 2000000.00),
  ('OBAMACARE', 'AGENTE CALL CENTER', 1750905.00),
  ('OBAMACARE', 'AGENTE CALL CENTER CUSTUMER', 1750905.00),
  ('OBAMACARE', 'ANALISTA DE CALIDAD', 1925996.00),
  ('OBAMACARE', 'BACKOFFICE OBAMACARE', 1925996.00),
  ('OBAMACARE', 'COORDINADOR CALL', 2500000.00),
  ('OBAMACARE', 'DATAMARSHALL SENIOR', 2485000.00),
  ('OBAMACARE', 'FORMADOR SENIOR', 2100000.00),
  ('OBAMACARE', 'JEFE DE OPERACIONES', 3124000.00),
  ('OBAMACARE-LV', 'AGENTE CALL CENTER', 1750905.00),
  ('OBAMACARE-LV', 'AGENTE COMERCIAL', 1750905.00),
  ('OBAMACARE-LV', 'ANALISTA DE CALIDAD OBAMACARE', 1850000.00),
  ('OBAMACARE-LV', 'BACKOFFICE OBAMACARE', 1850000.00),
  ('OBAMACARE-LV', 'JEFE DE OPERACIONES', 2500000.00);

INSERT INTO salario_referencia (Cliente_idCliente, cargo_idcargo, salario)
SELECT cl.idCliente, ca.idcargo, t.salario
  FROM tmp_salario_referencia t
  JOIN cliente cl ON TRIM(cl.nombre) COLLATE utf8mb4_0900_ai_ci = t.cliente COLLATE utf8mb4_0900_ai_ci
  JOIN cargo ca ON TRIM(ca.nombre) COLLATE utf8mb4_0900_ai_ci = t.cargo COLLATE utf8mb4_0900_ai_ci
 WHERE NOT EXISTS (
        SELECT 1 FROM salario_referencia s
         WHERE s.Cliente_idCliente = cl.idCliente AND s.cargo_idcargo = ca.idcargo AND s.salario = t.salario);

-- Filas que no encontraron su cliente o su cargo (deberia salir vacio).
SELECT t.cliente, t.cargo, t.salario,
       IF(cl.idCliente IS NULL, 'falta cliente', 'falta cargo') AS problema
  FROM tmp_salario_referencia t
  LEFT JOIN cliente cl ON TRIM(cl.nombre) COLLATE utf8mb4_0900_ai_ci = t.cliente COLLATE utf8mb4_0900_ai_ci
  LEFT JOIN cargo ca ON TRIM(ca.nombre) COLLATE utf8mb4_0900_ai_ci = t.cargo COLLATE utf8mb4_0900_ai_ci
 WHERE cl.idCliente IS NULL OR ca.idcargo IS NULL;

SELECT COUNT(*) AS filas_salario_referencia FROM salario_referencia;

DROP TEMPORARY TABLE tmp_salario_referencia;
