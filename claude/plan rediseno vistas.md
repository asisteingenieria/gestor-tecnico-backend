# Plan: llevar el diseño de Equipo (Hoy / Histórico) a RRHH, financiera y asistencia

Anotado el 2026-11-25. **Plan completo el 2026-11-25: Fase 0 y las olas 1 a 4 hechas** (ver "Fase 0 — hecho" y "Olas 1-4 — hecho" al final); falta el merge y el despliegue del frontend. Todo el
trabajo es del frontend, sin backend ni migraciones.

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

## Decisiones del usuario (2026-11-25)

1. `EquipoAsistencia` adopta el **diseño completo** de `MonitorEquipo`, conservando las tarjetas que suman el
   total de §78.
2. **Sí entran** la ola 4 (portal del empleado) y Contratación Hydra/SST.
3. Orden confirmado: Fase 0, Asistencia, Financiera y RRHH.

## Fase 0 — hecho (2026-11-25)

**Piezas en `src/components/ui/`** (frontend), importables desde `'../ui'`:

| Pieza | Para qué |
|---|---|
| `EncabezadoVista` | `icono`, `titulo`, `subtitulo`, `enVivo`; las acciones van como hijos |
| `Mosaicos` / `Mosaico` | `color`, `icono`, `valor`, `label`; con `onClick` filtra (`activo`), sin él es KPI fijo |
| `BarraFiltros`, `CampoBusqueda`, `Leyenda` | barra blanca; la leyenda acepta `color` (punto) o `fondo` (cuadrito), `enPanel` para el encabezado de un panel |
| `TablaVista`, `FilaGrupo`, `AvatarVista` | `columnas` [{id,label,icono,title}], `orden` + `onOrdenar` (opcional), `fija`, `pie` (celdas del total); el `<tbody>` lo arma la vista |
| `siguienteOrden` (`ordenVista.js`) | `setOrden(siguienteOrden(col))` |
| `PanelVista`, `CargandoVista`, `VistaVacia` | panel con encabezado azul (`icono`, `titulo`, `extra`); cargando y vacío/error |
| `Pastilla` | `color`, `punto` (estado de la fila) o sin punto (valor compacto), `minWidth`, `title` |
| `paletasEstado.js` | `TONO`, `claseEstado` y los mapas por módulo |

**Paletas.** Los módulos no inventan colores: usan `TONO` (exito verde, alerta ámbar, peligro rojo, info azul
marino, neutro gris, acento morado, cian, novedad magenta, suave gris claro), que son clases `.ai-st--*` ya
existentes más una nueva, `.ai-st--peligro` (#c8221c). Mapas:

- `COLOR_EMPLEADO`: activo exito · periodo_prueba info · suspendido/en_proceso alerta · retirado/inactivo peligro · sin_contrato neutro;
- `COLOR_SOLICITUD` (horas extra y cambios de turno): pendiente alerta · aprobada exito · rechazada peligro · cancelada neutro;
- `COLOR_ALERTA_TRASPASO`: programada suave · enviada alerta · leida exito;
- `COLOR_CANDIDATO`: pendiente alerta · listo exito · registrado info · no_apto peligro · descartado/cancelado_hydra neutro;
- `COLOR_EXAMEN`: pendiente alerta · reagendado acento · asistio info · aprobado exito · no_aprobado peligro · no_asistio novedad;
- `COLOR_LOTE`: abierto alerta · listo exito · registrado info · cancelado neutro;
- `colorTipoNovedad(nombre)`: incapacidad novedad · vacaciones cian · licencia acento · suspensión peligro · otras alerta.

Validadas con `scripts/validate_palette.js` del skill `dataviz`, `--pairs all`, en claro (`#ffffff`) y en oscuro
(`#121d2e`): ningún par bajo el piso de visión normal (ΔE 15). Se cambiaron tres por eso: "sin contrato" iba en gris
claro (chocaba con el azul en oscuro), en exámenes "no asistió" iba en naranja y "reagendado" en celeste (chocaban
con rojo y azul), y en novedades "otras" iba en azul/gris (chocaba con celeste/magenta). Verde↔rojo queda en ΔE 7,5
para deuteranopía: legal solo con codificación secundaria, por eso mosaico y pastilla llevan siempre ícono y texto.
Los avisos de "banda de luminosidad" y "croma" del script son de paletas categóricas de gráficas, no de colores de
estado.

**Otros cambios:**
- `MonitorEquipo` y `EquipoMensual` usan las piezas; `Mosaico` y `Pastilla` locales de `EquipoMensual` se borraron.
  Revisados en el navegador como coordinador (seed `9000000001`) en claro y oscuro: Hoy, filtro por mosaico,
  Histórico con tabla, total, grupos y gráficas, sin errores en consola.
- Barra horizontal de ~15 px (§70.4) corregida: `#root` pasó de `width: 100vw` a `100%` en `src/index.css`.
  Verificado: con scroll vertical, `scrollWidth` = `clientWidth`.
- Fila de grupo ilegible en oscuro (texto azul marino sobre azul): `[data-theme="dark"] .ai-monitor-grupo` usa la tinta clara.
- `npm run build` sin errores; `npm run lint` sin problemas nuevos (los 84 que reporta ya estaban).

## Olas 1-4 — hecho (2026-11-25)

Un commit de frontend por ola, en `sebas-branch`, **sin push** (Fase 0 `3e31d40`). Ninguna toca el backend ni la BD.

| Ola | Commit | Pantallas |
|---|---|---|
| 1 · Asistencia | `f4f9d59` | Equipo del jefe y Asistencia en vivo de financiera (`EquipoAsistencia`, diseño completo del monitor con las 7 tarjetas de §78 + "Llegaron tarde"), Novedades, Retiros, Horas extra, Cambios de turno, Reporte de horas extras del jefe, Trazabilidad (`TrazabilidadView`, la usan jefe, financiera y empleado) y Horarios |
| 2 · Financiera | `4a6f232` | Home (KPIs → mosaicos, costo de nómina y gráficas en paneles navy con gráfica ↔ tabla), Reporte de asistencia mensual, Reporte de horas extras, Pasivo vacacional (también "Vacaciones del equipo" de los jefes) |
| 3 · RRHH | `094f4e4` | Personal de la empresa (`AgentManagement`, también la vista de solo lectura del admin), Consolidado de novedades, Traspasos, Contratación Hydra (lotes, avisos, equivalencias), el lote y los exámenes médicos de SST |
| 4 · Portal del empleado | `b7bbdde` | Mis estadísticas, Mi horario, Mi trazabilidad. Mi jornada conserva su reloj circular |

**Lo que cambia para el usuario:**
- Encabezado con ícono y acciones en pastillas.
- Mosaicos de color en vez de las tiras de KPI. Los que filtran se marcan al hacer clic y se quitan con otro clic:
  - empleados: activos y retirados, por Estado;
  - novedades: por estado de soportes;
  - horas extra y cambios de turno: por estado.
- Barras blancas de filtros.
- Tablas navy con las filas clicables: ficha del empleado, detalle de la novedad, despliegue del traspaso, lote de Hydra, campaña del reporte mensual.
- Estados en pastillas de color con texto, sin depender solo del color.
- "Según los filtros · N en total" pasó a la línea de detalle del mosaico.

**Piezas nuevas, además de las de la Fase 0:**
- Lógica en vivo compartida entre `MonitorEquipo` y `EquipoAsistencia`: `utils/monitorAsistencia.js`, `hooks/useTiemposEnVivo.js` y `asistencia/CeldasMonitor.jsx`.
- `Mosaico` acepta `detalle`, una línea chica debajo de la etiqueta.
- En CSS:
  - `.ai-monitor-tabla--simple`, la tabla navy sin columnas de estado;
  - `.ai-monitor-reparto`, la barra del reparto del día;
  - `.ai-monitor-btn--primario`;
  - botones de pastilla dentro de paneles navy y tablas.
- En el Home de financiera la variación de los mosaicos va como texto con flecha y signo (`deltaTexto`), porque el color del mosaico ya está tomado.

**Fuera, como decía el plan:** formularios, ventanas y cajones (el detalle de campaña del reporte mensual, `CandidatoHydraDrawer`, `EmpleadoDrawer`…), Red Maestra, Inventario e Incidentes.

**Verificado:**
- En el navegador, en claro y oscuro, como:
  - jefe/coordinador (seed `9000000001`): las ocho pantallas de la ola 1;
  - financiera (`finanzas.prueba`, con un token firmado en local): Asistencia en vivo, las cuatro de la ola 2 y las de la ola 3;
  - empleado (`empleado1`): la ola 4.
- El mosaico de Retirados filtra y pasa solo el rango a "fecha de retiro".
- Sin errores en consola.
- `npm run build` sin errores en cada ola.
- El lint de los archivos tocados está limpio. Los errores que quedan son anteriores y de archivos que no se tocaron: `AsistenciaLayout`, `useNotifications` y `CandidatoHydraDrawer`.

**Despliegue:** solo frontend (merge + pull + `npm install && npm run build`).

## Ola 5 — formularios, ventanas y cajones (2026-11-25)

El usuario pidió llevar al estilo de Equipo también los formularios, ventanas y cajones de RRHH, financiera y asistencia, que el plan había dejado por fuera. Commit de frontend `048200c`, sin push. Antes, en el mismo día: `1624f00` pasó las gráficas del Home de financiera a las barras de Equipo y `ff592b7`/`9548a7d` dejaron Cargos solo para Recursos Humanos (§61.4 de `claude/modulo recursoshumanos.md`).

**Cómo se hizo:** todas esas ventanas usan las clases comunes `ai-overlay`, `ai-modal*`, `ai-drawer*` y `ai-field`. El cambio es un bloque de CSS acotado a `.ai-overlay`, al final de `components.css`, así que las páginas no cambian. Ese bloque da:
- encabezado navy, como los paneles;
- títulos de sección como las bandas de grupo;
- campos con esquina de 10 px y foco azul;
- botones en pastilla;
- tablas con cabecera navy y filas alternas;
- cajón con encabezado navy plano, en lugar del degradado.

El detalle de campaña del reporte mensual cambió sus KPIs propios por mosaicos.

**Alcance:** lo toman de una vez estas ventanas:
- nuevo y editar empleado;
- la ficha del ojo;
- registrar retiro, traspasos y novedades (formulario y detalle);
- cargue y descarga de empleados, ajuste del pasivo y cargos;
- horarios (plantilla, asignar, malla), horas extra y cambios de turno;
- el candidato y los lotes de Hydra/SST.

Las ventanas de Red Maestra del admin usan las mismas clases, así que también cambian.

**Verificado:** en el navegador, en claro y en oscuro, sin errores en consola. Las revisé como:
- RRHH: nuevo empleado, ficha, retiro, nueva novedad y candidato de Hydra;
- financiera: detalle de campaña y ajuste del pasivo;
- jefe: asignar horario y solicitar horas extra.

`npm run build` pasa.

**Despliegue:** solo frontend.
