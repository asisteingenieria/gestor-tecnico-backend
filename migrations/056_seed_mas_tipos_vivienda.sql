-- =====================================================================
--  Migracion 056: el catalogo `tipo_vivienda` (creado en la 052) solo
--  tenia "Casa" -- el unico valor visto en la muestra real del Excel en
--  ese momento (7 filas, ver claude/modulo recursoshumanos.md §19). El
--  usuario pidio agregar el resto de opciones estandar para que el
--  selector "Tipo de vivienda" de AgentForm.jsx no quede limitado a una
--  sola opcion.
--
--  `tipo_vivienda.nombre` tiene UNIQUE KEY: el INSERT usa
--  `INSERT IGNORE` para poder correr esto sin romper si "Casa" ya existe
--  (siempre existe, sembrada en la 052).
-- =====================================================================

INSERT IGNORE INTO `tipo_vivienda` (`nombre`) VALUES
  ('Casa'),
  ('Apartamento'),
  ('Apartaestudio'),
  ('Habitación'),
  ('Finca'),
  ('Otro');
