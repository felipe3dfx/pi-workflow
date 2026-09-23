# Revisión de la definición: child-session delegation

Estado: PUBLISHED

Paquete: `docs/features/child-session-delegation.md` y el prototipo `prototype/child-session-operator/`.
Handoff: `present (root-selected)`, `CONTEXT.md`, ADR 0005 aceptado.
Veredicto: `READY WITH WARNINGS`.

## Resultado

La revisión del paquete nuevo usó tres lentes en `openai-codex/gpt-6-sol` con `medium`. El usuario dispuso los hallazgos.

La spec anterior pedía una tarjeta y un transcript en `$EDITOR`. Esta publicación la reemplaza por el header de Pi y el detalle dentro de la TUI. Un spike en Pi 0.87.1 mostró que `setHeader` puede pintar las listas encima del chat. No prueba un ancla al hacer scroll ni un reemplazo de toda la pantalla.

## Autoridad

Handoff: `present (root-selected)`, `CONTEXT.md`. ADR 0005 aceptado. El informe de autoridad está en `docs/features/child-session-delegation-authority-review.md`. El encabezado visible `Subagents` no es un término del glosario. No se escribió uno.

## Decisions, Deviations and Accepted Risks

La desviación autorizada sigue siendo la del ADR 0005. No hay desinstalación silenciosa.

Advertencias aceptadas por el usuario:

- La lista no define si un hijo terminado sigue visible, ni cómo el teclado mueve la fila.
- `Tab` avanza de pregunta, sin definir la respuesta parcial que se conserva.
- La selección de modelo y el comando que investiga listas siguen más amplios que el lanzamiento.
- Tareas, preguntas y tools siguen en esta feature aunque no creen un hijo.

## Spec

`docs/specs/child-session-delegation.md`
