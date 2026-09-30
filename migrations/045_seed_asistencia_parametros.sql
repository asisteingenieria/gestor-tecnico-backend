-- Migración 045: semilla de asistencia_parametro (ver asistencia.md §5)

INSERT INTO `asistencia_parametro` (`clave`, `valor`, `tipo_dato`, `descripcion`) VALUES
('minutos_habilitar_salida', '10', 'entero', 'Ventana previa a la hora de salida en la que se habilita el botón Salida'),
('tolerancia_entrada_min', '5', 'entero', 'Tolerancia por defecto si el horario no define una propia'),
('limite_bano_min_por_pausa', '15', 'entero', 'Umbral de alerta por cada pausa de baño'),
('limite_bano_min_por_dia', '30', 'entero', 'Umbral de alerta del acumulado diario de baño'),
('desviacion_almuerzo_alerta_min', '15', 'entero', 'Desviación frente a la hora programada de almuerzo que dispara alerta'),
('dias_edicion_retroactiva', '7', 'entero', 'Días hacia atrás que el director puede ajustar jornadas cerradas');
