# Approved prototype: narrow screens v1

Disposition: reference-only. The user approved every component of `index.html` on 2026-11-21, with variants narrow margin `0` and floating stamp. The user message was approved in its second version. It is evidence, not an implementation base. The real "before" renders on `7fad399` are in `renders-before-7fad399.txt`.

Superseded points (editorial pointer added 2026-11-21 by the parent, not a new contract version; the body below is unchanged). Critique corrections and owner decisions recorded after this approval supersede these points; see `docs/features/narrow-screens.md`, which wins where they differ:

- Header: now out of scope; `docs/features/header-identity.md` stays authoritative (critique B3).
- Stamp: at the end of the last line if it fits, otherwise on its own row; never on the first line of a multi-line message (critique S3).
- Context backstop and exploration budget: the head carries a `›` affordance that is never dropped, and the advisor status goes on a dim line of its own (critique B2).
- Pi selectors and `SelectList`: in scope by inheritance of the shared menu patch changes (critique W8).
- Footer: hides its hints while the operator question panel is open (critique W5).
- Todo: tapping the heading collapses it; `n/m` is done over total (critique W4).
- Durations: `1m 05s` at every width, not only below 60 columns (critique B1).

Question: how should the chrome read on a terminal of about 44 columns, such as an iPhone 13 in Herdr mobile? Success criterion: every transcript block gains usable width, no action or identity is truncated away, and every component follows one shared set of layout rules.

## Shared rules

The rules fall in two groups. Density rules apply only below 60 columns. Coherence rules (glyphs, hint format, frame styles, cursor, undocked widgets, no stamp reserve) also apply only below 60 columns, as the owner decided on 2026-11-21. At 60 columns and above today's layout stays; the prototype's wide panes that show coherence changes are superseded by this decision.

Density rules:

- Compact density applies below 60 columns.
- Transcript blocks use outer margin `0` and right margin `1`. The fullscreen scrollbar already separates them from the edge.
- Every block has a 2-column glyph lane (glyph and space). Body text starts right after it, at the same column in every block.
- The stamp reserves no columns on wrapped lines. It goes on the first line if it fits, otherwise at the end of the last line, otherwise on a line of its own. Risk: while a message streams, the stamp can jump between lines.

Coherence rules:

- Overlays use square corners. Input surfaces (editor, operator question) use rounded corners. Docked widgets (tasks, subagents) have no frame.
- In compact density, modals span the full width with padding `1`, and the editor and docked surfaces use margin `0`.
- Hints read `Key action`, are joined by ` · `, are left-aligned, and are ordered by priority.
- Actions and instructions wrap. Identifiers are cut with `…`. Nothing is cut without an ellipsis.
- Confirmed on 2026-11-21 (derived in the prototype's system section; durations by the owner, the rest delegated by the owner to the agent):
  - Durations use `1m 05s` everywhere.
  - Labels use sentence case and state words are lowercase.
  - `✗` also covers timed out, replacing `⧖`.
  - Abort and stop are shown as `cancelled`.

State glyphs:

| State | Glyph |
|---|---|
| Queued or pending | `○` muted |
| Running | `◐` cyan or the braille spinner |
| Waiting for the operator | `?` warning |
| Blocked | `!` warning |
| Done | `✓` success |
| Failed or timed out | `✗` error |
| Cancelled or aborted | `–` muted |

Other marks:

| Mark | Glyph |
|---|---|
| Event | `◆` |
| Group | `◈` |
| Cursor | `▸` |
| Input prompt | `❯` |

## Confirmed per component (compact density)

### Assistant text
Assistant text gets the lane and right margin `1`, and the floating stamp. At 44 columns that is 40 columns, up from 27.

### User message
- Today's look stays: the background block and one background row above and one below.
- There is no outer margin. The background reaches the edge and the inner padding is `1`.
- The stamp reserves no columns. When it fits on neither the first nor the last line, it sits in the bottom background row. (Superseded: see S3 in the note above.)
- The text starts one column right of the shared lane.

### Thinking
- The `┃` rail sits in the lane.
- The inline expand hint is hidden. The row stays tappable.

### Tool rows and groups
These rows use the lane. The glyph colour follows the shared state scale.

### Error and abort notice
Red is used only for errors. An abort uses `–` muted.

### Advisor card
- The glyph is `◆` in accent.
- The head is short: `Advisor 12s ›`. The model goes on its own dim line.
- The tail `+N lines · tap or ctrl+o` always shows.

### Subagent and parent cards
- The collapsed head always carries a 1-column `›` affordance. The open state (`⌄`) was not laid out.
- The state is shown as a coloured word.
- The reason takes up to 2 lines.

### Context backstop and exploration budget
The metric stays in the head. The `→` action goes on its own warning line, which wraps and is never truncated.

### Asked
The question has a hanging indent. The `↳` answer sits in the lane.

### Markdown
- List indent is 2 columns per level.
- Code blocks use a `▎` rail with no fences and no indent.
- Tables are out of scope.

### Header
The header shows the repository name instead of the path, and the compact `◆2 · 13% 256K`.

### Status row
The spinner sits in the lane.

### Footer
- Hints are joined by ` · `.
- When idle, `Ctrl+O expand` comes first.
- While working, the order is `Esc interrupt · Enter steer · Ctrl+O expand`.

### Editor
- Margin is `0`.
- The placeholder is `What should we build?`.
- The caption is `opus-5-5 · high`, without the provider.

### Tasks
- The heading is `▾ Todo 1/3`, the same pattern as Subagents. `Todo` is the glossary term; the prototype's `Tasks` is replaced.
- There is no frame and there are no blank rows.
- The glyphs are the shared ones.

### Subagents box
- The model is omitted, because Fleet shows it. Id, step and time stay.
- There is no selection background.
- The hint is `Alt+A`, following the `Key action` casing.

### Operator question
- The description goes below the label, at full width. The prototype also stacks it below 70 inner columns; that threshold was dropped by the below-60 decision.
- The cursor is `▸`, and the hints are inside the panel.
- This supersedes the `❯` cursor and right-hand descriptions of `../operator-question/approved-questions-v2.md`, below 60 columns only. Recorded by ADR 0031 (`docs/adr/0031-operator-question-on-narrow-screens.md`, owner-approved 2026-11-21) amends ADR 0019 for this below 60 columns.

### Settings
- The modal is full width with padding `1`, giving 40 columns at 44.
- `▸` marks only the selected row.

### Model profiles
- Each specialist takes two lines: role and thinking level first, the full model second.

### Workflow config
- The modal is full width with padding `1`.
- The hints are left-aligned.

### Fleet
- Rows always take two lines: identity and state first, detail and usage second.
- Only the hints for the current focus show, on one or two rows.

## Out of scope and follow-ups

- Touch support for the operator question panel (no `handleMouse` today) is a separate behavioural change.
- These surfaces are not laid out yet. They follow the shared rules:
  - The Fleet detail.
  - The model catalog.
  - Pi selectors and `SelectList`.
  - The slash menu.
  - The config Review screen.
  - The expanded subagent card.
  - The collapsed tasks state and its control row.
  - Markdown tables.
- The Markdown changes need a new Pi patch under ADR 0007.
- The real `tput cols; tput lines` from Herdr on the iPhone has not been measured.
- Glyph width under iOS fallback fonts has not been checked.

## Mock inventory

Renders are simulated by a per-cell model in `index.html`. The "before" panes are captured renderer output, cropped, with approximate colours. Some panes are derived from the code, and each is marked as such. No production code is used.
