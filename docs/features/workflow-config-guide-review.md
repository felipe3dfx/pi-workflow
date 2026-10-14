# Revisión de la definición: guía de `/workflow:config`

Paquete: `workflow-config-guide/definition-1`.
Handoff: `workflow-config-guide/feature-review-1`.
Resultado: **READY**.
Parent: [#248](https://github.com/felipe3dfx/pi-workflow/issues/248).
Brief: [workflow-config-guide.md](workflow-config-guide.md).

Fecha: 2026-10-14. Captura revisada: el brief de trabajo y el Approved Prototype UI Contract v4 (`approved-config-guide-v4.md`), con su evidencia en `snapshots.txt`, `guide.ts` y `mocks.ts`, en la rama `prototype/configure-ux` (último commit `c2c2963`).

## Veredicto

`READY`. No quedan bloqueos ni advertencias sin disposición.

## Rondas

| Ronda | Commit revisado | Resultado |
|---|---|---|
| 1 | contrato v1 (`b6dca84`) | F1–F5; disposición del usuario: aceptar las recomendaciones |
| 2 | contrato v2 (`c325e69`) | F6 y F7; F2 resultó inalcanzable y se revirtió |
| 3 | contrato v3 (`cb0690d`) | F8; el usuario eligió la opción 1 |
| 4 | contrato v4 (`448dd06`) | F9–F11; correcciones editoriales sin cambiar el contrato (`c2c2963`) |

Cada ronda usó tres lentes independientes de solo lectura: completitud y coherencia; simplificación y alcance; factibilidad y coherencia transversal.

## Hallazgos

| # | Lente | Hallazgo | Evidencia | Severidad | Responsable | Disposición | Estado |
|---|---|---|---|---|---|---|---|
| F1 | 1, 2 | El prototipo eliminaba el mouse que hoy ofrece `SettingsList` y dibujaba un `[×]` sin función. | `pi-tui/.../settings-list.js:132-155` | warning | Owner | Paridad de mouse; `[×]` se comporta como Esc. | Corregido en v2, reverificado |
| F2 | 1 | Un catálogo de companions roto parecía vacío. | `pi-workflow.ts:293-295` | warning | Owner | Aceptado en la ronda 1. | Reemplazado por F6 |
| F3 | 1 | No estaba definido si un companion ilegible pero apagado aparece en la revisión. | `guide.ts`, filtro `row.on` | warning | Owner | `!` solo mientras sigue esperado. | Corregido en v2, reverificado |
| F4 | 1, 2 | La revisión no tenía límite de alto y el foco al volver no estaba definido. | `guide.ts` `renderReview` | warning | Owner | Scroll con `Apply now` y los hints fijos; Esc enfoca `Review and apply`. | Corregido en v2, reverificado |
| F5 | 3 | Los tests manejan la guía como `SettingsList`. | `test/workflow-settings.test.mjs:91-112`; `test/delegation-mode.test.mjs:91-96,139-140` | warning | Owner | Riesgo aceptado; la spec define la cobertura. | Riesgo aceptado |
| F6 | 1, 2, 3 | La pantalla de catálogo roto de v2 nunca se mostraría: `seating.read()` rechaza antes de abrir la guía. | `seating.ts:29`; `pi-workflow.ts:288-291` | warning | Owner | Revertir F2 y mantener el rechazo actual. | Corregido en v3, reverificado |
| F7 | 1, 3 | Las descripciones del catálogo no llegan hoy a `guideSelection`. | `pi-workflow.ts:293-300` | warning | Owner / `to-spec` | Restricción para la spec, con test sobre el catálogo real. | Restricción aceptada |
| F8 | 3 | "no changes" ocultaba las instalaciones pendientes. | `snapshots.txt` escenario 9 | warning | Owner | Contar `N to install` en el título y la acción. | Corregido en v4, reverificado |
| F9 | 3 | El hint de las selecciones no mencionaba Space. | `guide.ts` `editHints` | warning | Owner | Corrección editorial: `←/→/Space change`. | Corregido (`c2c2963`) |
| F10 | 3 | En anchos angostos, el título truncaba el conteo de F8. | `chrome-menus.ts:205-216` | warning | Owner | Corrección editorial: si el título no cabe, mostrar solo el resumen. | Corregido (`c2c2963`), snapshot 17 |
| F11 | 2 | La descripción de `orchestrator` omitía *asking* y *directing children*. | `delegation-mode.md:15` | informativo | Owner | Corrección editorial alineada con la spec. | Corregido (`c2c2963`) |

## Coherencia transversal

| Capacidad compartida | Resultado |
|---|---|
| Marco, hints y cierre de `chrome-menus` (sibling: `model-profiles-editor.ts`) | compatible |
| Marcas `[x]`/`[ ]` de `ask-user-panel` | compatible |
| `SettingsList` de Pi | divergencia autorizada (el brief lo reemplaza) |
| Pantallas de `model-profiles-editor` | compatible |
| ADR 0009, ADR 0012, GLOSSARY, spec de Delegation mode | compatible |

## Decisions, Deviations and Accepted Risks

- **Riesgo aceptado F5:** hay que reescribir los tests que manejan la guía. La spec debe cubrir las teclas de cada tipo de control, Tab, el contador de cambios e instalaciones, los estados de los companions, la revisión, los dos caminos de Esc, el mouse, cancelar sin escribir y aplicar sin cambios.
- **Restricción F7:** la guía debe recibir las descripciones del catálogo desde `loaded.companions[].description`.
- **Divergencia autorizada:** se reemplaza `SettingsList` por un componente propio que reutiliza las primitivas de `chrome-menus`.
- **Brecha de evidencia admisible:** no existe un Domain Authority Handoff para esta feature.
