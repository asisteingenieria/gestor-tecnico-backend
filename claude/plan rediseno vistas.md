# Plan: llevar el diseño de Equipo (Hoy / Histórico) a RRHH, financiera y asistencia

Anotado el 2026-11-25. **Sin empezar.** Todo el trabajo es del frontend, sin backend ni migraciones.

## El diseño de referencia

Es el de `MonitorEquipo.jsx` (Hoy) y `EquipoMensual.jsx` + `GraficasEquipoMes.jsx` (Histórico), descrito en
`asistencia.md` §70. Tiene cinco piezas:

1. **Encabezado**: ícono, título grande, subtítulo (con "en vivo" si aplica) y las acciones en pastillas a la
   derecha (`.ai-monitor-head`, `.ai-monitor-acciones`).
2. **Mosaicos de color** por estado, con número, ícono y barra inferior. Pueden filtrar o ser fijos
   (`.ai-monitor-mosaico`, `--estatico`; colores en `.ai-st--<estado>`).
3. **Barra blanca** de búsqueda y filtros, con la leyenda de colores al lado (`.ai-monitor-barra`, `-leyenda`).
4. **Tabla**: encabezado azul marino con íconos y orden por columna, filas alternas, avatar, estados en pastilla,
   filas de grupo y fila de total (`.ai-monitor-tabla`, `--fija`, `tfoot`).
5. **Paneles** con encabezado azul marino y **gráficas** de barras apiladas en HTML con la paleta validada
   (`.ai-monitor-panel`, `.gm-*`, `--gm-*`).

Todo está en `src/styles/asiste-ui/components.css` y funciona en claro y oscuro (`--mon-*`).

## Estado al anotarlo

- Todas las pantallas de RRHH, financiera y asistencia ya usan el sistema anterior "Opción C" (`ai-kpi`,
  `ai-table`, `ai-card`), con casi nada de Tailwind suelto. El cambio es visual, no una reescritura.
- Solo `MonitorEquipo` y `EquipoMensual` usan el diseño nuevo, y sus piezas están dentro de cada archivo
  (`Mosaico` y `Pastilla` en `EquipoMensual.jsx`), sin poder reutilizarse.
- Incoherencia: `EquipoAsistencia.jsx` (en vivo de financiera y Hoy de los jefes, §78) sigue con el diseño viejo,
  mientras que el coordinador ya ve el nuevo en Hoy.

## Fases

**Fase 0. Base común, sin cambio visible**
- Sacar las piezas a `src/components/ui/`: `EncabezadoVista`, `Mosaicos`/`Mosaico`, `BarraFiltros` (con leyenda),
  `TablaVista` (encabezado navy, orden, grupos, total), `PanelVista` y `Pastilla`.
- Pasar `MonitorEquipo` y `EquipoMensual` a usarlas y comprobar que se ven igual.
- Dejar los nombres CSS `ai-monitor-*` como están.
- Definir y validar con el validador del skill `dataviz`, en claro y oscuro, las paletas de mosaicos nuevas:
  - empleado: activo, retirado, en proceso;
  - tipos de novedad;
  - estados de traspaso;
  - estados de Hydra/SST;
  - horas extra: solicitada, aprobada, rechazada.
- Corregir la barra horizontal de ~15 px (`100vw`, §70.4).

**Ola 1. Asistencia (gestión)**
- `EquipoAsistencia`.
- `NovedadesEquipo` y `RetirosEquipo` (pendientes de §70.4).
- Vacaciones del equipo.
- `HorasExtra`, `CambiosTurno` y `ReporteHorasExtra`.
- `TrazabilidadView`.
- `GestionHorarios`.

**Ola 2. Financiera**
- `HomeFinanciera`: KPIs a mosaicos y costo de nómina en panel con gráfica.
- `AsistenciaMensual`: puede reutilizar el layout de `EquipoMensual`.
- `ReportesHorasExtra` y `PasivoVacacional`, conservando el "Según los filtros · N en total".

**Ola 3. RRHH**
- `AgentManagement`: mosaicos por estado que filtran y tabla navy.
- `NovedadesRRHH` y `Traspasos`.
- Contratación Hydra: `ContratacionHydra`, `LoteHydra` y `ExamenesMedicos` de SST.

**Ola 4. Portal del empleado, opcional**
- `MisEstadisticas`, `MiHorario` y `MiTrazabilidad`.
- `MiJornada` conserva su reloj circular.

**Fuera del alcance:** formularios, modales y drawers (`AgentForm`, `EmpleadoDrawer`, cargues), que se quedan en
Opción C. También Red Maestra (admin), Inventario e Incidentes.

**En cada ola:**
- un commit en el frontend, con `lint` y `build`;
- revisión en el navegador por rol (financiera, RRHH, SST, jefe, coordinador), en claro y oscuro;
- su sección en el `.md` del módulo;
- despliegue solo del frontend: pull y `npm install && npm run build`.

**Riesgo:** en las tablas anchas de RRHH (Personal de la empresa), el encabezado navy con ícono en cada columna
puede quedar pesado. Íconos solo en las columnas clave.

## Decisiones pendientes del usuario

1. ¿`EquipoAsistencia` adopta el diseño de `MonitorEquipo` (recomendado, conservando las tarjetas que suman el
   total de §78) o solo cambia el estilo?
2. ¿Entran la ola 4 (portal del empleado) y Contratación Hydra/SST?
3. Orden propuesto: Fase 0, Asistencia, Financiera y RRHH.
