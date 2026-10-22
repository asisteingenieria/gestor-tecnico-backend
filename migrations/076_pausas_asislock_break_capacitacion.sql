-- =====================================================================
-- 076 — Pausas de AsisLock: break y capacitación (asistencia.md §18, revisión)
--
-- AsisLock ya manda un registro por cada cambio de estado (Conectado, Break, Almuerzo,
-- Capacitación, Baño, Desconectado) en `estado_conexion`; hasta ahora solo se usaban
-- Conectado/Desconectado y las pausas de baño/almuerzo se marcaban en el portal. Ahora el
-- Gestor interpreta los 4 estados de pausa de AsisLock.
--
--   1. jornada_evento.tipo: agrega inicio_break/fin_break e inicio_capacitacion/fin_capacitacion
--      (baño, almuerzo, extra y desconexión ya existían).
--   2. jornada: columnas minutos_break (tiempo libre, DESCUENTA del trabajado, como baño) y
--      minutos_capacitacion (cuenta COMO LABORADA, no descuenta — decisión del negocio).
--
-- Idempotente salvo los ALTER (fallan si ya existen). Aplicar después de 071.
-- =====================================================================

-- 1. Nuevos tipos de evento -----------------------------------------------------------------
ALTER TABLE `jornada_evento` MODIFY COLUMN `tipo` ENUM(
    'entrada',
    'inicio_bano', 'fin_bano',
    'inicio_break', 'fin_break',
    'inicio_almuerzo', 'fin_almuerzo',
    'inicio_capacitacion', 'fin_capacitacion',
    'salida',
    'inicio_extra', 'fin_extra',
    'inicio_desconexion', 'fin_desconexion'
) NOT NULL;

-- 2. Totales por tipo de pausa --------------------------------------------------------------
ALTER TABLE `jornada`
    ADD COLUMN `minutos_break` INT NOT NULL DEFAULT 0 AFTER `minutos_pausa_almuerzo`,
    ADD COLUMN `minutos_capacitacion` INT NOT NULL DEFAULT 0 AFTER `minutos_break`;
