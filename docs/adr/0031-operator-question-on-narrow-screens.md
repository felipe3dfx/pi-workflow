# ADR 0031: Operator question on narrow screens

## Status

Acceptance: approval and merge of the introducing PR.

Amends ADR 0019 for the operator question's look and key hints on narrow screens. Placement, width, frame, and height stay as ADR 0019 decides.

## Decision

Below the narrow-screen threshold, the operator question uses the menus' `▸` cursor, puts each option's description below its label at full width, and shows its own key hints inside the panel, while the footer hides its hints until the panel closes. At or above the threshold, ADR 0019 and `prototype/operator-question/approved-questions-v2.md` stay the approved look.

The threshold and the narrow look are governed by `docs/features/narrow-screens.md` and `prototype/narrow-screens/approved-narrow-screens-v1.md`.

## Considered Options

- Keep the right-hand descriptions. Rejected: at about 44 columns they wrap in an 18-column strip and split labels.
- Keep the footer hints visible, as ADR 0019 intends. Rejected below the threshold: the footer fits only two hints there, and the panel's own hints already show the keys that apply.

## Consequences

While the question is open on a narrow screen, the footer's general hints are not visible; they return when the panel closes.
