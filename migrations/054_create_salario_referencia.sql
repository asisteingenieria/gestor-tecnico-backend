-- =====================================================================
--  Migracion 054: tabla de referencia Cliente + Cargo -> Salario, para
--  autocompletar el campo "Salario mensual" en el alta manual de empleado
--  (AgentForm.jsx) segun el Cliente y el Cargo elegidos.
--
--  Fuente: hoja "Salarios" de Descargas/Informacion 280926 (1).xlsx (59
--  filas, 4 bloques Cliente/Cargo/Salario): ASISTE, CLARO, OBAMACARE y
--  OBAMACARE-LV. Los 4 son clientes reales **distintos** entre si (el
--  usuario aclaro esto explicitamente el 2026-09-29, tras una confusion de
--  una version anterior de esta migracion que fusiono OBAMACARE-LV contra
--  OBAMACARE por error -- corregido antes de llegar a produccion). Los 4
--  ya existen tal cual en el catalogo `cliente` (Claro=1, Asiste=3,
--  OBAMACARE=4, OBAMACARE-LV=6). **Nota importante:** `OBAMACARE-LV`
--  (idCliente=6) esta huerfano en el sistema hoy -- ninguna `campania` lo
--  referencia (ver claude/modulo recursoshumanos.md §13.1), y el selector
--  "Cliente" de `AgentForm.jsx` solo lista clientes que tienen al menos una
--  campania real. Esto significa que, hasta que exista una campania real
--  bajo OBAMACARE-LV, estas 5 filas de referencia **no son alcanzables**
--  desde el formulario (el usuario nunca podria elegir "OBAMACARE-LV" como
--  Cliente). Se siembran igual porque son datos reales de la fuente, pero
--  queda pendiente crear esa campania si se quiere que el autocompletado
--  realmente funcione para este cliente.
--
--  De 48 cargos unicos, 46 matchean exacto contra el catalogo `cargo`; 2 no
--  matchean y se fusionaron contra el cargo existente mas parecido (decision
--  del usuario, sesion 2026-09-29):
--    - "GTR (Gestor en Tiempo Real)"  -> cargo existente "GTR"
--    - "FORMADOR SENIOR PE"           -> cargo existente "FORMADOR SENIOR"
--
--  No hay UNIQUE KEY sobre (Cliente_idCliente, cargo_idcargo): la
--  combinacion ASISTE + "AYUDANTE DE OBRA" trae 3 salarios reales distintos
--  en el Excel (2.200.000 / 2.300.000 / 2.500.000, sin ningun dato que
--  distinga cual aplica a cada caso). Se guarda tal cual esta en la fuente;
--  la logica de autocompletado (frontend, `AgentForm.jsx`) NO autocompleta
--  cuando encuentra mas de un salario distinto para la misma combinacion
--  Cliente+Cargo -- decision explicita del usuario, en vez de adivinar cual
--  aplica.
--
--  Las demas filas duplicadas del Excel con el MISMO salario (ej.
--  "COORDINADOR CALL" y "JEFE DE OPERACIONES" en CLARO, repetidos con igual
--  valor) se colapsaron a una sola fila antes de sembrar -- son redundancia
--  de la fuente, no informacion nueva.
--
--  Validada contra una copia temporal (`test_migracion_054_temp`, tablas
--  `cliente`/`cargo` clonadas con datos reales) antes de aplicarla.
-- =====================================================================

CREATE TABLE `salario_referencia` (
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
) ENGINE = InnoDB;

-- IDs resueltos contra la BD real (idCliente: Claro=1, Asiste=3, OBAMACARE=4,
-- OBAMACARE-LV=6; idcargo: ver catalogo `cargo`). Generadas por script a
-- partir del Excel, no tecleadas a mano.
INSERT INTO `salario_referencia` (`Cliente_idCliente`, `cargo_idcargo`, `salario`) VALUES
  (3, 61, 3200000.00),
  (3, 41, 1900000.00),
  (3, 58, 1925996.00),
  (3, 28, 1925996.00),
  (3, 26, 1925996.00),
  (3, 45, 1925996.00),
  (3, 38, 1750905.00),
  (3, 56, 2200000.00),
  (3, 56, 2300000.00),
  (3, 56, 2500000.00),
  (3, 60, 2300000.00),
  (3, 54, 2000000.00),
  (3, 55, 4000000.00),
  (3, 13, 2420000.00),
  (3, 42, 3000000.00),
  (3, 18, 2700000.00),
  (3, 36, 2500000.00),
  (3, 20, 2500000.00),
  (3, 30, 2400000.00),
  (3, 52, 2600000.00),
  (3, 29, 2600000.00),
  (3, 57, 5000000.00),
  (3, 23, 4070000.00),
  (3, 48, 5000000.00),
  (3, 34, 2750000.00),
  (3, 44, 2800000.00),
  (3, 39, 2627500.00),
  (3, 51, 1750905.00),
  (3, 46, 1925000.00),
  (1, 12, 1750905.00),
  (1, 25, 1925996.00),
  (1, 31, 1925996.00),
  (1, 17, 1850000.00),
  (1, 53, 2000000.00),
  (1, 10, 2223000.00),
  (1, 24, 2485000.00),
  (1, 11, 4070000.00),
  (1, 14, 4070000.00),
  (1, 43, 2000000.00),
  (1, 9, 2180000.00),
  (1, 16, 3124000.00),
  (1, 32, 1850000.00),
  (1, 35, 2000000.00),
  (1, 19, 2150000.00),
  (1, 21, 3124000.00),
  (4, 12, 1750905.00),
  (4, 49, 1750905.00),
  (4, 25, 1925996.00),
  (4, 27, 1925996.00),
  (4, 10, 2500000.00),
  (4, 24, 2485000.00),
  (4, 19, 2100000.00),
  (4, 16, 3124000.00),
  (6, 12, 1750905.00),
  (6, 37, 1750905.00),
  (6, 47, 1850000.00),
  (6, 27, 1850000.00),
  (6, 16, 2500000.00);
