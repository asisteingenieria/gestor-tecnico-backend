-- =====================================================================
--  Migracion 058: agrega "Independiente" al catalogo tipo_cotizante
--
--  La migracion 050 solo sembro "Dependiente" (unico valor visto en la
--  muestra del Excel de nomina). El formulario de registro de empleados
--  necesita ofrecer tambien "Independiente" en el selector "Tipo
--  cotizante" -- se agrega aqui sin tocar la fila existente.
--
--  INSERT IGNORE porque `tipo_cotizante.nombre` ya tiene UNIQUE KEY
--  (uq_tipo_cotizante_nombre, migracion 050): reejecutar esta migracion
--  no duplica la fila.
-- =====================================================================

INSERT IGNORE INTO `tipo_cotizante` (`nombre`) VALUES ('Independiente');
