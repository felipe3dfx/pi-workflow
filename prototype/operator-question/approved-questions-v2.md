# Approved prototype: operator question v2

Disposition: reference-only. The user approved variant V1 of `index.html` on 2026-10-16. On the same day, a review moved its placement from the input to a docked overlay (ADR 0019). It is evidence, not an implementation base. It supersedes the visual points of `../child-session-operator/approved-questions-v1.md`.

## Confirmed

- The question is an overlay docked at the bottom across the full shell width, just above the footer.
- It uses the input's frame: rounded border in `borderAccent` and a `question` caption on the bottom border.
- The question, the options, and the free-text row all live inside the frame.
- The active row is marked with `❯` and bold, like the command menu. There are no radios. `[x]`/`[ ]` appear only with `multiple: true`.
- Descriptions sit to the right in `dim`.
- The panel stops at half the terminal height, and the option list scrolls with `↑ n more` / `↓ n more`. A question longer than that is shown in full.
- When the question is answered, the stream keeps the existing `◆ Asked … ↳ answer` row.

## Unchanged from v1

- `z` is the free-text row, with today's browse and edit modes.
- `Esc` leaves the panel open and is not a refusal. `Shift+x` dismisses it, and the tool receives a refusal.
- Answering does not launch a child.

## Out of scope

- The v1 header with waiting count, elapsed time, and tokens.
- `Tab` to the next answer.
