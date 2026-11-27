-- =====================================================================
-- 111 — Límites legales de horas extra (asistencia.md §91.1)
--
-- La solicitud de horas extra en Excel no deja pedir más de 2 horas extra al día ni más de 12 a la semana
-- (lunes a domingo), contando las ya pendientes o aprobadas (CST art. 22, Ley 50 de 1990): con la jornada de
-- 42 h, 54 h a la semana. Los recargos dentro del turno no cuentan. Se cambian aquí sin tocar código.
--
-- Va ANTES del código: sin estos parámetros la solicitud en Excel responde que faltan y no envía nada.
-- Idempotente: si ya existen, no los toca.
-- =====================================================================

INSERT INTO asistencia_parametro (clave, valor, tipo_dato, descripcion) VALUES
  ('max_horas_extra_diarias', '2', 'entero', 'Máximo de horas extra por persona y día (CST art. 22)'),
  ('max_horas_extra_semanales', '12', 'entero', 'Máximo de horas extra por persona y semana de lunes a domingo (CST art. 22)')
ON DUPLICATE KEY UPDATE clave = clave;
