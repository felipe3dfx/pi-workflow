# Revisión de la definición: child-session delegation

Estado: PUBLISHED

Paquete: brief de delegación confirmado en la sesión de origen.
Handoff: `origin/main` `0e460e0`, ADR 0005 aceptado.
Veredicto: `READY`.

## Resultado

La revisión final del paquete, y la revisión enfocada posterior del default de background, no dejaron bloqueadores ni advertencias sin disposición.

La revisión enfocada usó `openai-codex/gpt-6-sol` en `medium`. Las tres lentes devolvieron ninguno. La regla no contradice print mode, el resultado empujado, quedarse en la sesión, ni el rechazo sin hijo.

La spec publicada omitió superficies que el brief ya revisado incluía. Esta publicación las restituye: tarjeta de agentes, transcript en `$EDITOR`, lista `todo`, `ask_user_choice`, `ask_user_question` y render compacto de tools. No es una decisión nueva. No copia los parches de thinking de gentle-shell.

## Autoridad

Handoff: `present (root-selected)`, `CONTEXT.md`. ADR 0005 aceptado por el merge del PR #62. El catálogo vigente en `0e460e0` todavía lista los companions viejos. Esa diferencia es la consecuencia aceptada del ADR hasta el cambio de código de esta feature.

## Decisions, Deviations and Accepted Risks

None identified.

La desviación autorizada es la del ADR 0005: child session y acceso a CodeGraph son capacidades del harness. `@tintinweb/pi-subagents` y `@vndv/pi-codegraph` dejan de ser companions esperados. `@heyhuynhgiabuu/pi-pretty` es un companion esperado. Esta feature es el cambio de código que el ADR dejó pendiente. No hay desinstalación silenciosa.

## Spec

`docs/specs/child-session-delegation.md`
