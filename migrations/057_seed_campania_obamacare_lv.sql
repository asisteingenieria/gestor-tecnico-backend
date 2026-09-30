-- =====================================================================
--  Migracion 057: siembra una campania real para el cliente "OBAMACARE-LV"
--  (`cliente.idCliente=6`).
--
--  El cliente ya existia (creado por el import masivo, ver
--  claude/modulo recursoshumanos.md §13.1), pero quedo huerfano: ninguna
--  `campania` lo referenciaba. El selector "Cliente" de `AgentForm.jsx`
--  deriva sus opciones de `catalogos.campanias` (solo clientes con al menos
--  una campania real), asi que "OBAMACARE-LV" nunca aparecia como opcion al
--  dar de alta un empleado -- a pesar de que la migracion 054 ya sembro sus
--  5 filas de `salario_referencia`, esas filas eran inalcanzables. Pedido
--  explicito del usuario, sesion 2026-09-29: agregar la campania para que
--  "OBAMACARE-LV" sea seleccionable.
--
--  Se usa el mismo nombre que el cliente ("OBAMACARE-LV"), igual que la
--  campania "OBAMACARE" (id 10) ya sembrada para el cliente OBAMACARE
--  (id 4) -- mismo patron 1 campania = 1 nombre de cliente que ya tienen
--  Asiste (8 campanias reales) y Claro (9 campanias reales), aplicado aqui
--  con una sola campania porque es lo unico que trae el Excel fuente.
-- =====================================================================

INSERT INTO `campania` (`nombre`, `Cliente_idCliente`) VALUES
  ('OBAMACARE-LV', 6);
