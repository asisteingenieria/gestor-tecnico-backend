-- 112 · Gestor de asistencia retirado → lo gestiona su jefe inmediato (asistencia.md §95)
--
-- `contrato.gestor_asistencia_id` (082, §44) dice quién gestiona la asistencia de un empleado cuando su jefe
-- de área no usa el sistema (German Arias). Si esa persona se retira, el empleado queda sin nadie que le
-- asigne horario ni le pida horas extra: su jefe lo ve en Equipo (consulta por jefe inmediato, §57) pero no en
-- Horarios. Caso real 2026-11-27: los 4 de mantenimiento seguían con Edwin Bello (retirado) y su jefe
-- inmediato ya es Geraldin Cruz.
--
-- Regla (la de §44, "al resto, su jefe inmediato"): contrato vigente cuyo gestor de asistencia tiene su último
-- contrato retirado/inactivo (o no tiene contrato) pasa a su jefe inmediato, si este está vigente y no es el
-- mismo empleado. Los que no tengan jefe inmediato vigente no se tocan y salen en la consulta final.
--
-- Idempotente: una segunda corrida no encuentra filas. Sin cédulas: solo ids.
-- En Workbench necesita SQL_SAFE_UPDATES = 0 (incluido).

-- 1) Vista previa: qué contratos cambian.
SELECT c.idcontrato, c.users_company_id, c.gestor_asistencia_id AS gestor_retirado, c.jefe_inmediato_id AS nuevo_gestor
FROM contrato c
JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
LEFT JOIN contrato cg ON cg.idcontrato = (SELECT MAX(x.idcontrato) FROM contrato x WHERE x.users_company_id = c.gestor_asistencia_id)
LEFT JOIN estado_contrato eg ON eg.idestado_contrato = cg.estado_contrato_idestado_contrato
LEFT JOIN contrato cji ON cji.idcontrato = (SELECT MAX(y.idcontrato) FROM contrato y WHERE y.users_company_id = c.jefe_inmediato_id)
LEFT JOIN estado_contrato eji ON eji.idestado_contrato = cji.estado_contrato_idestado_contrato
WHERE c.gestor_asistencia_id IS NOT NULL
  AND ec.nombre NOT IN ('retirado', 'inactivo')
  AND c.idcontrato = (SELECT MAX(z.idcontrato) FROM contrato z WHERE z.users_company_id = c.users_company_id)
  AND (eg.nombre IS NULL OR eg.nombre IN ('retirado', 'inactivo'))
  AND c.jefe_inmediato_id IS NOT NULL AND c.jefe_inmediato_id <> c.users_company_id
  AND eji.nombre NOT IN ('retirado', 'inactivo');

-- 2) Cambio. La lista va primero a una tabla temporal: MySQL no deja actualizar `contrato` leyendo
--    `contrato` en la misma sentencia (error 1093).
DROP TEMPORARY TABLE IF EXISTS tmp_gestor_112;
CREATE TEMPORARY TABLE tmp_gestor_112 AS
SELECT c.idcontrato, c.jefe_inmediato_id
FROM contrato c
JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
LEFT JOIN contrato cg ON cg.idcontrato = (SELECT MAX(x.idcontrato) FROM contrato x WHERE x.users_company_id = c.gestor_asistencia_id)
LEFT JOIN estado_contrato eg ON eg.idestado_contrato = cg.estado_contrato_idestado_contrato
LEFT JOIN contrato cji ON cji.idcontrato = (SELECT MAX(y.idcontrato) FROM contrato y WHERE y.users_company_id = c.jefe_inmediato_id)
LEFT JOIN estado_contrato eji ON eji.idestado_contrato = cji.estado_contrato_idestado_contrato
WHERE c.gestor_asistencia_id IS NOT NULL
  AND ec.nombre NOT IN ('retirado', 'inactivo')
  AND c.idcontrato = (SELECT MAX(z.idcontrato) FROM contrato z WHERE z.users_company_id = c.users_company_id)
  AND (eg.nombre IS NULL OR eg.nombre IN ('retirado', 'inactivo'))
  AND c.jefe_inmediato_id IS NOT NULL AND c.jefe_inmediato_id <> c.users_company_id
  AND eji.nombre NOT IN ('retirado', 'inactivo');

SET SQL_SAFE_UPDATES = 0;
UPDATE contrato c
JOIN tmp_gestor_112 t ON t.idcontrato = c.idcontrato
SET c.gestor_asistencia_id = t.jefe_inmediato_id;
SET SQL_SAFE_UPDATES = 1;

DROP TEMPORARY TABLE IF EXISTS tmp_gestor_112;

-- 3) Pendientes: gestor retirado y sin jefe inmediato vigente. Hay que decidir a mano quién los gestiona.
SELECT c.idcontrato, c.users_company_id, c.gestor_asistencia_id, c.jefe_inmediato_id
FROM contrato c
JOIN estado_contrato ec ON ec.idestado_contrato = c.estado_contrato_idestado_contrato
LEFT JOIN contrato cg ON cg.idcontrato = (SELECT MAX(x.idcontrato) FROM contrato x WHERE x.users_company_id = c.gestor_asistencia_id)
LEFT JOIN estado_contrato eg ON eg.idestado_contrato = cg.estado_contrato_idestado_contrato
WHERE c.gestor_asistencia_id IS NOT NULL
  AND ec.nombre NOT IN ('retirado', 'inactivo')
  AND c.idcontrato = (SELECT MAX(z.idcontrato) FROM contrato z WHERE z.users_company_id = c.users_company_id)
  AND (eg.nombre IS NULL OR eg.nombre IN ('retirado', 'inactivo'));
