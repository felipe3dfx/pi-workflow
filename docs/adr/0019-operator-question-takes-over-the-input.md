# ADR 0019: Operator question takes over the input

## Status

Acceptance: approval and merge of the introducing PR.

Supersedes ADR 0009 only for the clauses "the operator question moves to the overlay" and "The operator question does not replace the input".

## Decision

The operator question occupies the input for one interaction. Its screen place is the input, not the overlay. The panel spans the shell width in the input's frame, and the transcript stays visible above it. The input and its text come back when the question is answered, dismissed, or aborted. Opening the question still closes the children view.

While an overlay is open, the question waits for it to close and tells the operator that a question is waiting. It never takes focus behind an overlay, and it never closes one.

The approved look is `prototype/operator-question/approved-questions-v2.md`.

## Considered Options

- Keep the overlay at Pi's default width. Rejected: on a wide terminal it floats centered and covers the transcript the operator needs in order to answer.
- Keep the overlay, docked at the bottom at full width. Rejected: it still covers the end of the transcript.
- Take over the input and close any open overlay first. Rejected: it discards unapplied work in `/workflow:config` or `/workflow:models`.
- Take over the input while an overlay stays open. Rejected: the overlay hides the panel, and keys meant for the overlay answer the question.

## Consequences

The shell gains a fifth screen place, the input, and the operator question is its only occupant. A question asked while the operator works in an overlay waits until that overlay closes. A question shown behind an overlay does not follow this decision.
