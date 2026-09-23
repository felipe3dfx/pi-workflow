# Approved prototype: children card v1

Disposition: reference-only. The user approved this page on 2026-09-23, then replaced the visual with the Grok TUI list. This file is no longer the card contract.

## Confirmed

- The card sits between the scrolling transcript and the input box. It is not at the top of the screen and not below the cursor.
- The header reads `Agents · N active`.
- Each row shows a glyph, the agent, and the task text on the left.
- The right side reads `model · effort · tokens · elapsed`.
- A queued row shows `queued` on the right and no model, effort, or tokens.
- While the child is waiting, the task text is the current step. Otherwise it is the task label.
- The card is not a live conversation.

## Delta from the published spec

The spec row was agent, label, model, and elapsed time, with the current step added only while waiting. This version adds effort and tokens, uses the gentle-shell order, and replaces the label with the step instead of adding a second line.
