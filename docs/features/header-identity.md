# Brief: header del Chrome con identidad sutil

Estado: aprobado por el desarrollador (v6).
Paquete: `header-identity/definition-1`.
Parent: [#243](https://github.com/felipe3dfx/pi-workflow/issues/243).
Revisión: [header-identity-review.md](header-identity-review.md).

## Problema y usuario

El header del Chrome (`renderHeader`) es funcional pero no tiene identidad, y el uso de contexto `45K / 200K` obliga a calcular mentalmente qué tan lleno está. El usuario es el operador de Pi que trabaja en la TUI con pi-workflow.

## Resultado esperado

Una sola línea, inspirada en gentle-shell sin perder el minimalismo, con identidad y uso de contexto legible de un vistazo, sin nuevas fuentes de datos.

```
π-workflow · ~/D/repos/pi-workflow · main          ◆ 2 · ctx ▰▰▰▰▱▱▱▱ 50% · 200K
```

La ruta del ejemplo es ilustrativa: `shortenPath` se conserva sin cambios.

## Alcance

- Solo el header del Chrome y sus pruebas. El footer, el editor y la fila de estado no cambian.
- Fuera de alcance: costo, uso semanal, proveedor, atajos, regla inferior y alternativa ASCII para los glifos.

## Comportamiento

- Izquierda, en este orden: marca `π-workflow` en `accent` sin negrita, ruta en `text`, rama en `dim`.
- Derecha: `◆ N` solo con hijos activos; bloque `ctx` con barra de 8 celdas (`▰` llena, `▱` vacía), porcentaje y total de la ventana en `dim`.
- Separadores `·` en `borderAccent`, solo en el header.
- La barra y el porcentaje usan los umbrales actuales: desde 75 % `warning`, desde 95 % `error`.
- El total de la ventana usa el formato compacto actual. Se elimina el conteo absoluto de tokens usados.

### Reglas numéricas

- Porcentaje: `round(tokens / ventana × 100)`, sin tope (por ejemplo `103%`, en `error`).
- Celdas llenas: `round(porcentaje / 100 × 8)`, limitado entre 0 y 8.

### Datos parciales

- Tokens desconocidos con ventana conocida: `ctx ? · 200K` en `dim`, sin barra.
- Ventana en 0 o desconocida: se omite el bloque `ctx`; `◆ N` se mantiene si hay hijos activos.
- Sin bloque `ctx` ni hijos activos: se omite el lado derecho.

### Degradación por ancho

Cada paso se aplica solo si el contenido no cabe en el ancho útil (ancho menos los márgenes de `marginFor`):

1. Se quita la marca.
2. Se quita la barra (queda `ctx 50% · 200K`).
3. Se trunca la ruta por el inicio, conservando el final, con `…` al comienzo (`…repos/pi-workflow`).

La rama, `◆ N`, el porcentaje y el total de la ventana se garantizan mientras quepan. Por debajo de ese ancho, la línea completa se trunca como hoy y nunca desborda.

## Decisiones

Todas las resolvió el desarrollador en la sesión de definición del 2026-10-14; estado: aceptadas.

| Decisión | Reemplaza |
|---|---|
| Propuesta B (identidad sutil) entre A, B y C | — |
| Marca `π-workflow`, sin glifo adicional | — |
| Orden ruta → rama | Orden actual rama → ruta |
| Sin tokens absolutos; el total de la ventana sigue visible | `usado / ventana` |
| El total de la ventana nunca se oculta | Línea errónea del borrador v4 que lo ocultaba con la barra |
| Orden de degradación y garantía acotada al ancho | — |
| Reglas numéricas y de datos parciales | — |
| Truncado de la ruta por el inicio con `…` | — |

## Capacidades compartidas e invariantes

- `usageColor`, `formatContextTokens`, `marginFor`, `terminalSafeLine` y el slot fijo del header se reutilizan sin cambios.
- `spread` deja de usarse en el header: la degradación por prioridad necesita un layout propio.
- Una sola línea; márgenes de `marginFor`; texto saneado con `terminalSafeLine`.

## Riesgos y brechas

- Riesgo aceptado: el ancho de `π` y `▰▱` en algunas fuentes. Mitigación: pruebas de ancho con `visibleWidth` y revisión visual del desarrollador antes de cerrar.
- Brecha admisible: no hay Domain Authority Handoff; `GLOSSARY.md` (Chrome, Place) es la autoridad raíz.
- Prototipo: ninguno.
