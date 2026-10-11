# Diagramas · Conexión Hydra → Gestor Técnico

Diagramas de la integración descrita en [`conexionhydra.md`](../../../conexionhydra.md). Cada
`.html` es autocontenido: se abre directo en el navegador, tiene tema claro y oscuro, y se puede
exportar a PNG o SVG desde el botón **Exportar**.

| Diagrama | Tipo | Muestra |
|---|---|---|
| [Arquitectura](arquitectura/arquitectura.html) | architecture | Las dos apps, sus bases, la API de integración y el despachador de avisos |
| [Envío de un lote](envio-lote/envio-lote.html) | sequence | Hydra encola el lote → lo envía firmado → Gestor lo guarda en staging |
| [Registro y aviso](registro-aviso/registro-aviso.html) | sequence | Simulación, registro todo o nada y aviso de `contratado` a Hydra |
| [Estados del candidato](estados-candidato/estados-candidato.html) | lifecycle | Pendiente → Listo → Registrado → Contratado, con cancelación, reenvío y descarte |
| [Flujo de datos](flujo-datos/flujo-datos.html) | dataflow | Del formulario de Hydra a `users_company`: copia fiel, traducción de catálogos, verificación |

## Cómo editarlos

Se generaron con la skill [Archify](https://github.com/tt-a1i/archify) (v3.0.1). La fuente de
cada diagrama es su `candidate.json`; el `.html` se regenera, **no se edita a mano**. Por ejemplo:

```bash
node ~/.claude/skills/archify/bin/archify.mjs finalize architecture \
  docs/diagramas/conexion-hydra/arquitectura/candidate.json \
  docs/diagramas/conexion-hydra/arquitectura/arquitectura.html --quality showcase --json
```

Corre desde la raíz del repo. El tipo va según la tabla de arriba.

Antes de regenerar, borra los `*.json` de evidencia (`*.finalize*.json`, `*.browser-check.json`,
`*.delivery.json`) de esa carpeta: Archify no sobrescribe evidencia que no creó la misma corrida.
Esos archivos no se versionan (ver `.gitignore`).

Se describieron a partir del código del 2026-10-01, que aún no estaba commiteado. Por eso no
llevan enlaces a líneas del repo. Si cambia el flujo, hay que actualizar el `candidate.json`
correspondiente.
