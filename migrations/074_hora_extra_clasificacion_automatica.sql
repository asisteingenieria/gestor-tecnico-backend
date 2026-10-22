-- =====================================================================
-- 074 — Clasificación automática de la hora extra (asistencia.md §32, revisión 2)
--
-- El agente ya no elige la clase: ingresa la FRANJA (hora de inicio y fin) y el servidor la
-- clasifica solo, según el turno asignado, el umbral nocturno vigente y el calendario de festivos.
-- Una misma solicitud puede partirse en varias clases (p. ej. parte diurna + parte nocturna), así
-- que la clase deja de vivir en una sola columna y pasa a una tabla de tramos.
--
--   1. hora_extra: hora_inicio / hora_fin (la franja solicitada). `clase` se mantiene como la clase
--      dominante, solo para listar en la bandeja; el dinero y el reporte salen de los tramos.
--   2. hora_extra_tramo: la clasificación (1..n clases con sus minutos) de cada hora extra.
--   3. festivo_colombia: festivos nacionales 2025-2030 (Ley Emiliani, Pascua calculada). Los
--      domingos NO van aquí: salen del día de la semana.
--   4. ventana_nocturna: umbral nocturno con vigencia. La reforma (Ley 2466/2025) lo corre a las
--      7:00 p.m.; se guarda con fecha de vigencia para recalcular meses viejos con el valor que regía.
--   5. Backfill: a cada hora extra aprobada existente se le crea un tramo con su clase y minutos
--      actuales, para que el reporte siga cuadrando.
--
-- Idempotente salvo los ALTER TABLE (fallan si la columna ya existe), igual que la 073.
-- Depende de la 072+073 (rol financiera y hora_extra.clase). Aplicar después de ellas.
-- =====================================================================

-- 1. Franja solicitada en hora_extra --------------------------------------------------------
ALTER TABLE `hora_extra`
    ADD COLUMN `hora_inicio` TIME NULL AFTER `fecha`,
    ADD COLUMN `hora_fin` TIME NULL AFTER `hora_inicio`;

-- 2. Tramos: la clasificación de cada hora extra -------------------------------------------
CREATE TABLE IF NOT EXISTS `hora_extra_tramo` (
  `idhora_extra_tramo` INT NOT NULL AUTO_INCREMENT,
  `idhora_extra` INT NOT NULL,
  `clase` ENUM(
    'recargo_nocturno',
    'extras_diurnas',
    'extras_nocturnas',
    'dominicales_festivas',
    'extras_dominicales_festivas'
  ) NOT NULL,
  `minutos` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`idhora_extra_tramo`),
  UNIQUE KEY `uq_hora_extra_tramo` (`idhora_extra`, `clase`),
  CONSTRAINT `fk_hora_extra_tramo_he` FOREIGN KEY (`idhora_extra`) REFERENCES `hora_extra` (`idhora_extra`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- 3. Festivos de Colombia (solo festivos; los domingos salen del día de la semana) ----------
CREATE TABLE IF NOT EXISTS `festivo_colombia` (
  `fecha` DATE NOT NULL,
  `nombre` VARCHAR(120) NOT NULL,
  PRIMARY KEY (`fecha`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Festivos 2025-2030 generados con Pascua (algoritmo gregoriano) + Ley Emiliani (traslado al lunes).
-- Si dos festivos caen el mismo día, INSERT IGNORE deja uno: solo importa que la fecha sea festiva.
INSERT IGNORE INTO `festivo_colombia` (`fecha`, `nombre`) VALUES
  ('2025-01-01', 'Año Nuevo'),
  ('2025-01-06', 'Reyes Magos'),
  ('2025-03-24', 'San José'),
  ('2025-04-17', 'Jueves Santo'),
  ('2025-04-18', 'Viernes Santo'),
  ('2025-05-01', 'Día del Trabajo'),
  ('2025-06-02', 'Ascensión del Señor'),
  ('2025-06-23', 'Corpus Christi'),
  ('2025-06-30', 'San Pedro y San Pablo'),
  ('2025-07-20', 'Día de la Independencia'),
  ('2025-08-07', 'Batalla de Boyacá'),
  ('2025-08-18', 'Asunción de la Virgen'),
  ('2025-10-13', 'Día de la Raza'),
  ('2025-11-03', 'Todos los Santos'),
  ('2025-11-17', 'Independencia de Cartagena'),
  ('2025-12-08', 'Inmaculada Concepción'),
  ('2025-12-25', 'Navidad'),
  ('2026-01-01', 'Año Nuevo'),
  ('2026-01-12', 'Reyes Magos'),
  ('2026-03-23', 'San José'),
  ('2026-04-02', 'Jueves Santo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Día del Trabajo'),
  ('2026-05-18', 'Ascensión del Señor'),
  ('2026-06-08', 'Corpus Christi'),
  ('2026-06-15', 'Sagrado Corazón de Jesús'),
  ('2026-06-29', 'San Pedro y San Pablo'),
  ('2026-07-20', 'Día de la Independencia'),
  ('2026-08-07', 'Batalla de Boyacá'),
  ('2026-08-17', 'Asunción de la Virgen'),
  ('2026-10-12', 'Día de la Raza'),
  ('2026-11-02', 'Todos los Santos'),
  ('2026-11-16', 'Independencia de Cartagena'),
  ('2026-12-08', 'Inmaculada Concepción'),
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-01-11', 'Reyes Magos'),
  ('2027-03-22', 'San José'),
  ('2027-03-25', 'Jueves Santo'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-05-01', 'Día del Trabajo'),
  ('2027-05-10', 'Ascensión del Señor'),
  ('2027-05-31', 'Corpus Christi'),
  ('2027-06-07', 'Sagrado Corazón de Jesús'),
  ('2027-07-05', 'San Pedro y San Pablo'),
  ('2027-07-20', 'Día de la Independencia'),
  ('2027-08-07', 'Batalla de Boyacá'),
  ('2027-08-16', 'Asunción de la Virgen'),
  ('2027-10-18', 'Día de la Raza'),
  ('2027-11-01', 'Todos los Santos'),
  ('2027-11-15', 'Independencia de Cartagena'),
  ('2027-12-08', 'Inmaculada Concepción'),
  ('2027-12-25', 'Navidad'),
  ('2028-01-01', 'Año Nuevo'),
  ('2028-01-10', 'Reyes Magos'),
  ('2028-03-20', 'San José'),
  ('2028-04-13', 'Jueves Santo'),
  ('2028-04-14', 'Viernes Santo'),
  ('2028-05-01', 'Día del Trabajo'),
  ('2028-05-29', 'Ascensión del Señor'),
  ('2028-06-19', 'Corpus Christi'),
  ('2028-06-26', 'Sagrado Corazón de Jesús'),
  ('2028-07-03', 'San Pedro y San Pablo'),
  ('2028-07-20', 'Día de la Independencia'),
  ('2028-08-07', 'Batalla de Boyacá'),
  ('2028-08-21', 'Asunción de la Virgen'),
  ('2028-10-16', 'Día de la Raza'),
  ('2028-11-06', 'Todos los Santos'),
  ('2028-11-13', 'Independencia de Cartagena'),
  ('2028-12-08', 'Inmaculada Concepción'),
  ('2028-12-25', 'Navidad'),
  ('2029-01-01', 'Año Nuevo'),
  ('2029-01-08', 'Reyes Magos'),
  ('2029-03-19', 'San José'),
  ('2029-03-29', 'Jueves Santo'),
  ('2029-03-30', 'Viernes Santo'),
  ('2029-05-01', 'Día del Trabajo'),
  ('2029-05-14', 'Ascensión del Señor'),
  ('2029-06-04', 'Corpus Christi'),
  ('2029-06-11', 'Sagrado Corazón de Jesús'),
  ('2029-07-02', 'San Pedro y San Pablo'),
  ('2029-07-20', 'Día de la Independencia'),
  ('2029-08-07', 'Batalla de Boyacá'),
  ('2029-08-20', 'Asunción de la Virgen'),
  ('2029-10-15', 'Día de la Raza'),
  ('2029-11-05', 'Todos los Santos'),
  ('2029-11-12', 'Independencia de Cartagena'),
  ('2029-12-08', 'Inmaculada Concepción'),
  ('2029-12-25', 'Navidad'),
  ('2030-01-01', 'Año Nuevo'),
  ('2030-01-07', 'Reyes Magos'),
  ('2030-03-25', 'San José'),
  ('2030-04-18', 'Jueves Santo'),
  ('2030-04-19', 'Viernes Santo'),
  ('2030-05-01', 'Día del Trabajo'),
  ('2030-06-03', 'Ascensión del Señor'),
  ('2030-06-24', 'Corpus Christi'),
  ('2030-07-01', 'San Pedro y San Pablo'),
  ('2030-07-20', 'Día de la Independencia'),
  ('2030-08-07', 'Batalla de Boyacá'),
  ('2030-08-19', 'Asunción de la Virgen'),
  ('2030-10-14', 'Día de la Raza'),
  ('2030-11-04', 'Todos los Santos'),
  ('2030-11-11', 'Independencia de Cartagena'),
  ('2030-12-08', 'Inmaculada Concepción'),
  ('2030-12-25', 'Navidad');

-- 4. Ventana nocturna con vigencia ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ventana_nocturna` (
  `vigente_desde` DATE NOT NULL COMMENT 'desde qué fecha rige esta ventana (hora de Colombia)',
  `hora_inicio` TIME NOT NULL COMMENT 'inicio del recargo nocturno',
  `hora_fin` TIME NOT NULL COMMENT 'fin del recargo nocturno (del día siguiente)',
  PRIMARY KEY (`vigente_desde`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- Antes de la reforma la noche empezaba a las 9:00 p.m.; la Ley 2466/2025 la corre a las 7:00 p.m.
-- OJO: confirmar la fecha de entrada en vigencia del tramo de las 7:00 p.m. y ajustarla si cambia.
INSERT IGNORE INTO `ventana_nocturna` (`vigente_desde`, `hora_inicio`, `hora_fin`) VALUES
  ('2000-01-01', '21:00:00', '06:00:00'),
  ('2025-12-25', '19:00:00', '06:00:00');

-- 5. Backfill de tramos para las horas extra ya aprobadas -----------------------------------
--    Idempotente: solo crea el tramo si la hora extra todavía no tiene ninguno.
INSERT INTO `hora_extra_tramo` (`idhora_extra`, `clase`, `minutos`)
SELECT he.idhora_extra, he.clase, COALESCE(he.minutos_aprobados, he.minutos_estimados)
FROM `hora_extra` he
WHERE he.estado = 'aprobada'
  AND NOT EXISTS (SELECT 1 FROM `hora_extra_tramo` t WHERE t.idhora_extra = he.idhora_extra);
