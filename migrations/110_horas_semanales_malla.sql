-- =====================================================================
-- 110 — Horas semanales de la malla (asistencia.md §90)
--
-- Al cargar la malla de horarios en Excel, cada persona debe sumar exactamente estas horas por semana
-- (lunes a domingo, sin el almuerzo) y tener al menos un día de descanso; si no, no se carga nada.
-- 42 h = jornada máxima legal desde julio de 2026 (Ley 2101 de 2021). Se cambia aquí sin tocar código.
--
-- Va ANTES del código: sin este parámetro el cargue de la malla responde que falta y no carga nada.
-- Idempotente: si ya existe, no lo toca.
-- =====================================================================

INSERT INTO asistencia_parametro (clave, valor, tipo_dato, descripcion)
VALUES ('horas_semanales_malla', '42', 'entero', 'Horas exactas por semana que debe sumar cada persona en la malla en Excel (sin almuerzo)')
ON DUPLICATE KEY UPDATE clave = clave;
