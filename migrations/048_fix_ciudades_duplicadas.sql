-- =====================================================================
--  Migracion 048: elimina ciudades duplicadas en el catalogo `ciudad`.
--
--  Detectado al usuario reportar ciudades repetidas en el selector "Ciudad
--  de expedicion" del formulario de empleados. Causa raiz (ya documentada
--  en claude/modulo recursoshumanos.md §11.5): el seed de ciudades
--  (migraciones 035/036) se corrio dos veces, insertando las mismas 20
--  ciudades otra vez en vez de detectar que ya existian. Los IDs del
--  segundo grupo quedaron desplazados +20 respecto al primero (Bogota
--  1 y 21, Medellin 2 y 22, etc.), pero eso es un detalle de esta base en
--  particular — este script NO depende de esos numeros, actua por nombre,
--  asi que corrige el mismo problema sin importar que IDs tenga cada
--  entorno.
--
--  Verificado antes de escribir esto: ambos IDs de varias ciudades
--  duplicadas (ej. Bogota 1 y 21) ya estaban en uso por empleados reales
--  en las 4 columnas que referencian `ciudad`
--  (users_company.ciudad_nacimiento_id, users_company.ciudad_expedicion_id,
--  contrato.ciudad_idciudad, direccion.ciudad_idciudad). Por eso el fix no
--  es un simple DELETE: primero reapunta esas referencias hacia el ID que
--  se conserva (el mas bajo por nombre, mismo criterio ya usado en el
--  seed original) y solo despues borra las filas sobrantes.
--
--  Ejecutar UNA sola vez. Es idempotente en el sentido de que si no hay
--  duplicados no hace nada (la tabla temporal queda vacia), pero no tiene
--  sentido correrla dos veces contra el mismo problema porque ya lo deja
--  resuelto la primera vez.
-- =====================================================================

CREATE TEMPORARY TABLE tmp_ciudad_dup AS
SELECT c.idciudad AS id_viejo, m.id_bueno
FROM ciudad c
JOIN (
    SELECT nombre, MIN(idciudad) AS id_bueno
    FROM ciudad
    GROUP BY nombre
    HAVING COUNT(*) > 1
) m ON m.nombre = c.nombre
WHERE c.idciudad <> m.id_bueno;

UPDATE users_company u
JOIN tmp_ciudad_dup t ON u.ciudad_nacimiento_id = t.id_viejo
SET u.ciudad_nacimiento_id = t.id_bueno;

UPDATE users_company u
JOIN tmp_ciudad_dup t ON u.ciudad_expedicion_id = t.id_viejo
SET u.ciudad_expedicion_id = t.id_bueno;

UPDATE contrato c
JOIN tmp_ciudad_dup t ON c.ciudad_idciudad = t.id_viejo
SET c.ciudad_idciudad = t.id_bueno;

UPDATE direccion d
JOIN tmp_ciudad_dup t ON d.ciudad_idciudad = t.id_viejo
SET d.ciudad_idciudad = t.id_bueno;

DELETE c FROM ciudad c
JOIN tmp_ciudad_dup t ON c.idciudad = t.id_viejo;

DROP TEMPORARY TABLE tmp_ciudad_dup;
