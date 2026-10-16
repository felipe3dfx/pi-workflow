# ADR 0019: Operator question docks at the bottom

## Status

Acceptance: approval and merge of the introducing PR.

Amends ADR 0009 for the operator question's position, width, and frame. The question stays an overlay.

## Decision

The operator question is an overlay docked at the bottom across the full shell width, just above the footer, so the footer's key hints stay visible. It uses the input's frame and is capped at half the terminal height. Opening it still closes the children view.

The approved look is `prototype/operator-question/approved-questions-v2.md`.

## Considered Options

- Keep Pi's default overlay width. Rejected: on a wide terminal the question floats centered and does not match the shell.
- Take over the input. Rejected: Pi's input area holds one component, and no public API reports whether an extension dialog is mounted there or which component has focus. The question could push out a pending `ctx.ui.confirm` and leave it unresolved, or be pushed out itself and hang the tool until the turn is aborted. Overlays stack and return focus.
- Take over the input by patching pi-tui to read focus. Rejected: it ties a tool that blocks the agent to Pi internals.

## Consequences

While the question is open it covers the end of the transcript, up to half the terminal height. It never displaces another dialog and is never displaced by one.
