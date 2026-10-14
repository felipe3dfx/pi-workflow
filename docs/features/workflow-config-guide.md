# Brief: guía de `/workflow:config`

Estado: aprobado por el desarrollador (contrato de UI v4).
Paquete: `workflow-config-guide/definition-1`.
Parent: [#248](https://github.com/felipe3dfx/pi-workflow/issues/248).
Revisión: [workflow-config-guide-review.md](workflow-config-guide-review.md).
Prototipo: rama `prototype/configure-ux`, commit `c2c2963`, contrato `prototype/configure-ux/approved-config-guide-v4.md`, disposición `reference-only`.

## Problema y usuario

El operador de Pi con este harness no distingue en `/workflow:config` qué filas son toggles y cuáles son selecciones de varios valores, cuáles son los pasos del menú ni cómo y cuándo se aplica la selección. Fuente: pedido del desarrollador del 2026-10-14.

Evidencia de la guía actual (`extensions/configure-guide.ts`):

- Cada fila es un ítem de `SettingsList` que se ve como `Label   value`; Delegation mode, con dos valores, se ve y se cambia igual que un on/off.
- Una sola lista plana mezcla 6 capacidades, Jev routing, Delegation mode y N companions, sin encabezados.
- Todas las capacidades comparten la descripción "Seat this harness capability".
- `Apply` es una fila con valor `review` que abre un submenú oculto; las líneas del plan parecen seleccionables y el último ítem es `Confirm apply` con valor `now`.
- No hay marca de cambios pendientes ni contador; el hint dice `Esc to cancel`.
- El estado de cada companion solo aparece en el plan, y las descripciones del catálogo (`assets/companions.json`) nunca se muestran.

## Resultado esperado

La misma capacidad de configuración, con controles reconocibles a simple vista, cambios pendientes visibles y un camino de aplicación explícito.

## Alcance

Dentro: la presentación y la interacción de la guía de `/workflow:config`.

Fuera: el formato y la validación de la Selection (`readSelection`), el plan (`planApply`), el conjunto de efectos al confirmar (guardar la selección, fijar Jev routing y Delegation mode, asentar, `workflow.setup`), los argumentos del comando, la necesidad de la TUI, el rechazo de una selección inválida o de un catálogo ilegible, y los demás comandos.

## Dirección aceptada

El contrato de UI aprobado v4 define la interacción. Reemplaza a v3, v2 y v1, que se conservan en la rama del prototipo. Evidencia: `snapshots.txt` (escenarios 1–17), `guide.ts`, `mocks.ts` y `extension.ts` en la misma rama.

## Escenarios, estados, acciones y errores

1. Abrir sin archivo de selección: valores por defecto (todas las capacidades encendidas y todos los companions esperados), sin cambios pendientes y con el foco en la primera fila.
2. Cambiar una capacidad, Jev routing o un companion con Space o Enter: la fila muestra `•` y el contador se actualiza en el título y en la acción. Si hay companions esperados sin instalar, el título y la acción también muestran `N to install`, aunque no haya cambios.
3. Cambiar Delegation mode con ← o → (Space o Enter avanzan): misma marca de cambio.
4. Elegir `orchestrator` con Child session apagado: aviso informativo; la elección se permite.
5. Estado de cada companion en su fila: `installed`, `will install` (falta y se espera), `not installed` (falta y no se espera), `installed · kept` (instalado y no esperado) o `unreadable` (error).
6. Tab lleva el foco a `Review and apply`; Enter abre la revisión.
7. Revisión: *Changes* (`from → to`, o "No changes to your selection."), *Packages* (`+` instalar; `!` ilegible con referencia a `/workflow:doctor`, solo mientras siga esperado; `=` se mantiene instalado) y *Always on apply* (alinear MCP, aplicar los default settings de Pi, no se desinstala nada). Enter aplica el conjunto de efectos actual. Esc vuelve a la lista con el borrador intacto y el foco en `Review and apply`. En terminales cortas, el cuerpo hace scroll con `Apply now` y los hints fijos.
8. Esc sin cambios cierra. Con cambios, el primer Esc pide confirmar el descarte y el segundo cierra sin escribir; cualquier otra tecla sigue editando.
9. Aplicar sin cambios en la selección está permitido y sigue alineando MCP y los default settings, como hoy.
10. Catálogo de companions ilegible: sin cambios respecto a hoy; `/workflow:config` informa el error y no abre la guía (`extensions/seating.ts:29`, `extensions/pi-workflow.ts:288-291`).
11. Mouse: la rueda mueve el foco o hace scroll en la revisión; un clic cambia un toggle, avanza una selección, abre la revisión o aplica; `[×]` se comporta como Esc.
12. Selección ilegible o inválida, sin TUI o con argumentos: sin cambios respecto a hoy (error y la guía no se abre).

## Decisiones

| Decisión | Resuelve | Fuente | Estado |
|---|---|---|---|
| Una lista en overlay con secciones, no un wizard | desarrollador | conversación del 2026-10-14; ADR 0009 | aceptada |
| Affordances: toggle `[x]`/`[ ]`, selección `‹ valor ›`, acción `›` | desarrollador | contrato v1 | aceptada |
| Marca `•` y contador de cambios | desarrollador | contrato v1 | aceptada |
| Estado y descripción del catálogo en la fila de cada companion | desarrollador | contrato v1 | aceptada |
| Tab salta a `Review and apply` | desarrollador | contrato v1 | aceptada |
| Doble Esc para descartar cambios pendientes | desarrollador | contrato v1 | aceptada |
| Aviso informativo, sin rechazo, para `orchestrator` con Child session apagado | desarrollador | contrato v1; `docs/specs/delegation-mode.md:102` | aceptada |
| Companion ilegible listado en la revisión | desarrollador | contrato v1 | aceptada |
| Disposición `reference-only` | desarrollador | contrato v1 | aceptada |
| Paridad de mouse; `[×]` como Esc (F1) | desarrollador | feature-review; contrato v2 | aceptada |
| Pantalla de error de catálogo (F2) | desarrollador | feature-review; contrato v2 | reemplazada por F6 |
| Mantener el rechazo actual ante un catálogo ilegible (F6) | desarrollador | segunda feature-review; `seating.ts:29`; contrato v3 | aceptada |
| `! unreadable` solo mientras el companion siga esperado (F3) | desarrollador | feature-review; GLOSSARY (Degraded harness); contrato v2 | aceptada |
| Scroll de la revisión con `Apply now` y hints fijos; Esc enfoca `Review and apply` (F4) | desarrollador | feature-review; contrato v2 | aceptada |
| Reescribir los tests de la guía (F5) | desarrollador | feature-review | riesgo aceptado |
| La guía recibe las descripciones del catálogo y se prueban contra el catálogo real (F7) | desarrollador | segunda feature-review; `pi-workflow.ts:293-300` | restricción aceptada para la spec |
| El título y la acción cuentan las instalaciones pendientes (F8) | desarrollador | tercera feature-review; contrato v4 | aceptada |
| Hint `←/→/Space change`, título reducido al resumen cuando no cabe y descripción de `orchestrator` alineada con la spec (F9–F11) | desarrollador | cuarta feature-review | corrección editorial |

## Supuestos

- Los textos de la UI siguen en inglés, como el resto del harness. Supuesto por convención del repositorio.

## Capacidades compartidas

- `extensions/chrome-menus.ts` (`modalFrame`, `sectionRule`, `selectedRow`, `hintRows`, `menuRow`): se reutiliza; `extensions/model-profiles-editor.ts` usa el mismo marco y los mismos hints.
- `SettingsList` de Pi, parchado por `renderMainList` de `chrome-menus`: se reemplaza solo en esta guía.
- El panel de preguntas al operador (`extensions/ask-user-panel.ts`) usa `[x]`/`[ ]` como marcas y `(●)`/`(○)` para una sola opción.

## Dependencias

ADR 0009 (guided configure), ADR 0012 (entrypoint del comando), spec de Delegation mode y ADR 0015, y los términos del GLOSSARY Configure, Selection, Seating, Companion expectation y Degraded harness.

## Riesgos

- F5 (aceptado): los tests que manejan la guía como `SettingsList` (`test/workflow-settings.test.mjs`, `test/delegation-mode.test.mjs`) deben reescribirse. La spec debe definir la cobertura de las teclas por tipo de control, Tab, el contador de cambios pendientes, los estados de los companions, la revisión, los dos caminos de Esc, el mouse, cancelar sin escribir y aplicar sin cambios.

## Brechas de evidencia

No hay Domain Authority Handoff para esta feature. Es una ausencia admisible.
