-- =====================================================================
-- 073 — Clase de la hora extra y reporte automático (asistencia.md §32, revisión)
--
-- Cambia el reporte de horas extras: ya NO lo arma ni lo envía el jefe. Cada hora extra que el
-- agente solicita lleva su clase (las 5 del formato V.3), el jefe la confirma al aprobar, y el
-- reporte del mes se calcula solo con las horas aprobadas. Financiera lo ve en tiempo real y,
-- además del reporte igual al del jefe, ve el costo en dinero por campaña y totales (valor hora =
-- salario vigente de historial_salarial / 240, con los recargos de ley).
--
--   1. hora_extra.clase: a cuál de las 5 clases pertenece la hora (la elige el agente al solicitar
--      y el jefe la ajusta al aprobar). Las filas viejas quedan como 'extras_diurnas' por defecto.
--   2. Se eliminan las tablas del flujo manual de la 072 (envío/aprobación/devolución y fecha
--      límite), que ya no se usan, y el parámetro del recordatorio de la campana.
--
-- El rol `financiera` (ENUM de users.role) lo dejó la 072 y SIGUE vigente: no se toca aquí.
-- Si la 072 no se aplicó todavía en un servidor, corre 072 y luego 073, en ese orden.
-- Idempotente.
-- =====================================================================

-- 1. Clase de la hora extra -----------------------------------------------------------------
ALTER TABLE `hora_extra`
    ADD COLUMN `clase` ENUM(
        'recargo_nocturno',
        'extras_diurnas',
        'extras_nocturnas',
        'dominicales_festivas',
        'extras_dominicales_festivas'
    ) NOT NULL DEFAULT 'extras_diurnas' AFTER `tipo`;

-- 2. Fuera el flujo manual de la 072 (el reporte ahora es automático) ------------------------
--    Se borran hijas antes que padres por las llaves foráneas.
DROP TABLE IF EXISTS `reporte_horas_extra_detalle`;
DROP TABLE IF EXISTS `reporte_horas_extra`;
DROP TABLE IF EXISTS `periodo_horas_extra`;

DELETE FROM `asistencia_parametro` WHERE `clave` = 'dias_aviso_reporte_horas_extra';
