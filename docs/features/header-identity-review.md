# Revisión de la definición: header del Chrome con identidad sutil

Paquete: `header-identity/definition-1`.
Handoff: `header-identity/feature-review-1`.
Resultado: **READY**.
Parent: [#243](https://github.com/felipe3dfx/pi-workflow/issues/243).
Brief: [header-identity.md](header-identity.md).

## Paquete revisado

Las tres lentes revisaron la misma captura literal del brief en sub-agentes independientes y de solo lectura. La primera corrida sobre el brief v4 terminó en `BLOCKED`; el desarrollador dispuso cada hallazgo y el brief pasó a v5. Una reverificación sobre v5 se descartó porque las lentes evaluaron el código en lugar de la definición. La reverificación válida sobre v5 dejó dos advertencias, dispuestas en v6.

## Hallazgos y disposiciones

| # | Lente | Hallazgo | Severidad | Disposición |
|---|---|---|---|---|
| 1 | Las tres | «Nunca se ocultan» y «una sola línea» chocan en anchos muy pequeños (`extensions/visual-language.ts:16-22`, `test/chrome.test.mjs:72-79`). | advertencia | Resuelto: la garantía aplica mientras lo protegido cabe; por debajo, la línea se trunca como hoy. |
| 2 | Completitud | Faltaban redondeo, llenado de celdas y comportamiento sobre 100 %. | advertencia | Resuelto: porcentaje redondeado sin tope; celdas limitadas entre 0 y 8. |
| 3 | Completitud | Datos parciales sin definir (`HeaderData`, `extensions/chrome.ts:101-107`). | informativo | Resuelto: `ctx ? · ventana` sin tokens; sin ventana se omite el bloque. |
| 4 | Completitud | Umbrales de cada paso de degradación. | informativo | Resuelto: cada paso aplica si el contenido no cabe en el ancho útil. |
| 5 | Simplificación | El orden ruta → rama no estaba decidido de forma explícita (`extensions/chrome.ts:132-139`). | informativo | Confirmado por el desarrollador. |
| 6 | Simplificación | La marca repite el nombre del repositorio. | informativo | Se mantiene por decisión del desarrollador. |
| 7 | Viabilidad | Separador `·` frente a `│` del footer (`extensions/chrome.ts:145, 202`). | informativo | Divergencia autorizada, solo en el header. |
| 8 | Completitud | Truncado de la ruta sin dirección ni marcador. | advertencia | Resuelto: por el inicio, conservando el final, con `…`. |
| 9 | Simplificación | El ejemplo `~/D/r/pi-workflow` contradecía `shortenPath`. | advertencia | Corrección editorial: ejemplo ilustrativo; `shortenPath` sin cambios. |

La reverificación de las correcciones 8 y 9 se hizo en la sesión principal contra `extensions/chrome.ts:60-72`, porque solo precisan reglas existentes sin cambiar la intención.

## Coherencia transversal

| Capacidad | Resultado |
|---|---|
| `usageColor` | Compatible. |
| `formatContextTokens` | Compatible. |
| `HeaderData` | Compatible: no requiere nuevas fuentes de datos. |
| `marginFor` | Compatible. |
| Slot fijo del header (`fixed-header.ts`) | Compatible. |
| `spread` | Divergencia autorizada: el header necesita un layout propio por prioridad. |
| Ancho de `π` y `▰▱` | Evidencia insuficiente; cubierto por el riesgo aceptado. |

## Decisions, Deviations and Accepted Risks

- Desviación autorizada: separador `·` solo en el header; el footer conserva `│`.
- Desviación autorizada: el header no usa `spread`.
- Riesgo aceptado por el desarrollador: ancho de los glifos en algunas fuentes, mitigado con pruebas de `visibleWidth` y revisión visual antes de cerrar.
- Brecha admisible: no hay Domain Authority Handoff.
