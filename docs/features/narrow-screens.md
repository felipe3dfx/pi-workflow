# Brief: Chrome on narrow screens

Status: accepted by the owner on 2026-11-21; feature-critic verdict READY WITH WARNINGS (see `narrow-screens-review.md`); ready for `to-spec`.
Package: `narrow-screens/definition-1`.
Parent: no tracker issue yet.
Review: `docs/features/narrow-screens-review.md`.

## Problem and user

The user is the operator who runs pi-workflow inside Herdr mobile on an iPhone 13, about 44 columns wide. The owner reported that the Chrome wastes too much width on margins and indentation, so text is hard to read, and asked for visual coherence across components.

Real renders on `7fad399` (`prototype/narrow-screens/renders-before-7fad399.txt`) show where the width goes at 44 columns with `fullscreenScrollbar` set to always:

- The chat gets 43 columns; the scrollbar takes the last one.
- Assistant text wraps at 27 columns: 3 + 3 columns of margin and a 10-column stamp reserve on every wrapped line, although the stamp only draws on the first line. User text wraps at 25 columns.
- `edgeFor` only shrinks the margin below 26 columns, so 44 columns keeps the full desktop margin.
- The context backstop and exploration budget heads truncate the `→` action (`· de...`, `· ...`).
- The ResultCard drops the `ctrl+o` hint at 44 columns, and the expanded card cuts the model (`claude-opus...`).
- Model profiles hard-cut descriptions without an ellipsis (`anthropic/claude-opus-5-`).
- The config guide's `minWidth: 48` is clamped to 44.
- The operator question panel has no `handleMouse`, so it cannot be tapped.
- Hints, frames, cursors, and state glyphs differ between components (`Key:action` with `│`, `Key action` with `|`, `❯` and `▸` cursors, `□`/`◐`/`✓` in the Todo, `?`/`⠦` in the subagents box).

## Expected outcome

At about 44 columns every transcript block gains usable width, no action or identity is truncated away, and every component follows one shared set of layout rules. Assistant text goes from 27 to 40 columns.

## Scope

Delivery is split into three slices (critique S1, S2, S4, accepted 2026-11-21; see `narrow-screens-review.md`): slice 1 width, slice 2 coherence (gated on a device check of glyph widths and the real terminal size), slice 3 Markdown under ADR 0007. Every in-scope item belongs to exactly one slice (slice map: parent, 2026-11-21):

| Slice | Items |
|---|---|
| 1, width | Margin helper with separate left and right values (W2); one 60-column constant compared with terminal columns (W3); all UI state preserved across 60 columns (W1); left edge `0` and right margin `1`; the 2-column glyph lane; the stamp without per-line reserve (S3); backstop and budget structure: head with metric and `›`, `→` action line, advisor-status line (B2); card `›` affordances, including the ResultCard; model profiles cut with `…`; config guide and other overlays at full width below 60 columns (W9, risk accepted); empty and overflow rules (W7); the single duration format (B1) |
| 2, coherence (gated by the device check below) | Shared state-glyph table (W6); compact tool row colour (W10); hint format and footer order; footer hides its hints while the operator question panel is open (W5); frame styles; cursor `▸`; Todo unframed with heading collapse (W4); subagents box; editor; Advisor card; Fleet view rows; settings; model profiles two-line rows; Pi selectors and `SelectList` by inheritance (W8); operator question layout (per ADR 0031) |
| 3, Markdown | List indent and the `▎` code rail, as a new Pi patch under ADR 0007 |

- Slice 1 has no dependency on ADR 0019 or ADR 0007: it changes neither the operator question panel nor Pi's Markdown rendering.
- Slice 2 exit criterion (critique S4; parent, 2026-11-21): slice 2 unblocks when the owner reports the output of `tput cols; tput lines` from Herdr on the iPhone and confirms that `◐ ▸ ▎ ◈ – ✗ ✓ ○ ⠋` each render one column wide there.


- In scope:
  - Compact density below 60 columns for every component confirmed in the contract.
  - The coherence rules: state glyphs, hint format, frame styles, cursor, undocked widgets, and no stamp reserve. They apply only below 60 columns (D-open-1, resolved).
  - Pi selectors and `SelectList`, by inheritance only: below 60 columns they inherit the changes of the shared menu patch (`hintGap`, `swapMarker`, `menuRow` in `chrome-menus.ts`). This feature gives them no layout of their own (critique W8, owner 2026-11-21).
- Out of scope:
  - Touch support for the operator question panel (no `handleMouse` today). It is a separate behavioural change.
  - Markdown tables.
  - Surfaces not laid out yet. They follow the shared rules when they are built or touched, but this feature does not define them:
    - The Fleet view detail.
    - The model catalog.
    - The slash menu.
    - The config Review screen.
    - The expanded subagent card (the open `⌄` state).
    - The layout of the collapsed Todo state. The collapse action itself is defined under Todo in Behaviour (critique W4, owner 2026-11-21).

## Behaviour

The contract `prototype/narrow-screens/approved-narrow-screens-v1.md` (v1) is the approved prototype evidence. This section restates it. Where this brief records a critique correction or an owner decision dated after the prototype approval of 2026-11-21, the brief wins; the contract's "Superseded points" note lists those points (parent, 2026-11-21).

### Density rules (below 60 columns)

- The only signal is the terminal's column count, compared with one named constant (60). The chat width, the scrollbar setting, and the width given to each component do not affect it (critique W3, owner 2026-11-21).
- Transcript blocks use left margin `0` and right margin `1`. The right margin `1` applies whether or not the fullscreen scrollbar is shown (critique W3, owner 2026-11-21).
- One margin helper takes separate left and right values. Every margin site uses it: `Framed`, `ThinkingHeader`, `wrapRowRender`/`wrapRowMouse`, `foldChat`, the `child-result-card` `frame()`, `runtime-notice-card`, `advisor-card` through the row inset, and the group label row in `chrome-groups.ts:387` (`width - edge * 2`). None of them assumes symmetric margins (`outer - edge*2`). Each site has a test that mouse offsets match the rendered layout (critique W2, owner 2026-11-21; detail for to-spec). Note for to-spec: confirm whether `foldChat` (`chrome-messages.ts:598`) applies a margin itself or only regroups children, and drop it from the list if it applies none (parent, 2026-11-21).
- Every block has a 2-column glyph lane (glyph and space). Body text starts right after it, at the same column in every block.
- Modals and other overlays open at the full width with padding `1`. The editor and docked surfaces use margin `0`. An overlay that is open during a resize keeps the layout it opened with; reopening it lays it out again (critique W9, `risk accepted` by the owner 2026-11-21).

### Coherence rules

- The stamp reserves no columns on wrapped lines. It goes at the end of the last line if it fits, otherwise on a row of its own; for the user message, in the bottom background row (critique S3, accepted 2026-11-21).
- Overlays use square corners. Input surfaces (editor, operator question) use rounded corners. Docked widgets (Todo, subagents box) have no frame.
- Hints read `Key action`, are joined by ` · `, are left-aligned, and are ordered by priority.
- Actions and instructions wrap. Identifiers are cut with `…`. Nothing is cut without an ellipsis.
- One state glyph scale. `visual-language.ts` holds the only state-glyph table, with two mappings, Run state and Task state, that share these glyphs. It replaces the copied maps in `children-box.ts` and `todo-header.ts`; `children-view.ts` already consumes `childGlyph` from `children-box.ts` and follows through it. The Fleet view's `⊘` for an interrupted child stays as an extra row of the Run state mapping (parent, 2026-11-21). Which glossary state each row names is routed to `domain-modeling` (critique W6, owner 2026-11-21):

| State | Glyph |
|---|---|
| Queued or pending | `○` muted |
| Running | `◐` cyan or the braille spinner |
| Waiting for the operator | `?` warning |
| Blocked | `!` warning |
| Done | `✓` success |
| Failed or timed out | `✗` error; the state word tells them apart (D-open-2) |
| Cancelled or aborted | `–` muted |

- Other marks: event `◆`, group `◈`, cursor `▸`, input prompt `❯`. Compact tool rows keep `◆` in every state; only its colour follows the state scale (critique W10, owner 2026-11-21).

### Scenarios and states

- **Narrow vs wide.** Below 60 columns the density rules apply. At 60 columns and above neither the density nor the coherence rules apply; today's layout stays (D-open-1). Crossing 60 columns on resize, for example on device rotation, switches density on the next render. Only the rendering changes: all UI state stays, including expanded or collapsed blocks, the selection, the scroll position, and the focus (critique W1, owner 2026-11-21).
- **Streaming stamp.** While an assistant message streams, the stamp goes at the end of the last line if it fits, otherwise on a row of its own, re-evaluated on each render (critique S3). It never goes on the first line of a multi-line message.
- **Durations.** One formatter for every duration, at every width (critique B1; owner decision for `1m 05s`, exception to D-open-1; rule detail parent, 2026-11-21): under 10 s one decimal (`3.2s`); then whole seconds, rounded (`12s`); then `1m 05s`; then `1h 05m`. `childElapsed` and `formatDuration` share it.
- **User message.** The background block with one background row above and below stays. No outer margin; the background reaches the edge with inner padding `1`; text starts one column right of the shared lane. When the stamp does not fit at the end of the last line, it sits in the bottom background row (S3).
- **Thinking.** The `┃` rail sits in the lane. The inline expand hint is hidden; the row stays tappable.
- **Tool rows and groups.** They use the lane. Tool rows keep `◆` in every state; only its colour follows the state scale (critique W10, owner 2026-11-21).
- **Error and abort.** Red only for errors. An abort uses `–` muted.
- **Collapsed and expanded cards.**
  - Advisor card: `◆` in accent; short head `Advisor 12s ›`; the model on its own dim line; the tail `+N lines · tap or ctrl+o` always shows.
  - Subagent and parent cards: the collapsed head always carries a 1-column `›` affordance; the state is a coloured word; the reason takes up to 2 lines. The expanded (`⌄`) state is not laid out.
  - Context backstop and exploration budget: the head carries the metric and a `›` affordance that is never dropped; the `→` action goes on its own warning line, which wraps and is never truncated; the backstop's advisor status goes on a dim line of its own, only when present (critique B2, owner 2026-11-21).
- **Asked.** The question has a hanging indent; the `↳` answer sits in the lane.
- **Markdown.** List indent is 2 columns per level. Code blocks use a `▎` rail with no fences and no indent.
- **Header.** Out of scope: `docs/features/header-identity.md` stays authoritative, and its degradation already fits 44 columns (critique B3, owner 2026-11-21).
- **Status row.** The spinner sits in the lane.
- **Footer.** Hints joined by ` · `. Idle: `Ctrl+O expand` first. Working: `Esc interrupt · Enter steer · Ctrl+O expand`. While the operator question panel is open, the footer hides its hints because the panel shows its own (critique W5, owner 2026-11-21).
- **Editor.** Margin `0`; placeholder `What should we build?`; caption `opus-5-5 · high`, without the provider.
- **Todo.** Heading `▾ Todo 1/3`, the same pattern as the subagents box; no frame and no blank rows; shared glyphs. `n/m` in the heading means done tasks over total tasks. The control row keeps today's visible over total counter; only the heading counter is done over total (parent, 2026-11-21). With no frame there is no `×` target: tapping or clicking the `▾ Todo` heading collapses the Todo, and Alt+Shift+T still works. The capacity and the hit rows are recomputed without the frame rows (critique W4, owner 2026-11-21).
- **Empty and overflow.** A docked list with no items shows no heading and no rows. A long docked list keeps today's 8-row cap: the subagents box's overflow tail reads `… N more · Alt+A`, and the Todo keeps its pagination (parent, 2026-11-21). A modal taller than the screen scrolls, with its hints pinned in view. A token wider than the body with no break point is hard-wrapped in bodies and cut with `…` in heads (critique W7, owner 2026-11-21).
- **Subagents box.** The model is omitted because the Fleet view shows it; id, step, and time stay. No selection background. Hint `Alt+A`.
- **Modals.**
  - Operator question: the description goes below the label at full width; cursor `▸`; hints inside the panel, and the footer hides its own hints while the panel is open (critique W5). At 60 columns and above the panel stays as today (D-open-1), so there is no 70-inner-column threshold; the contract states the same (critique I1, owner 2026-11-21).
  - Settings: full width with padding `1` (40 columns at 44); `▸` marks only the selected row.
  - Model profiles: each specialist takes two lines, role and thinking level first, the full model second.
  - Workflow config: full width with padding `1`; hints left-aligned.
  - Fleet view: rows always take two lines, identity and state first, detail and usage second; only the hints for the current focus show, on one or two rows.

### Errors

- No content is cut without `…`. An action or instruction that does not fit wraps instead.
- A surface whose minimum width exceeds the terminal (today the config guide's `minWidth: 48`) follows the full-width modal rule instead of being clamped.
- A token with no break point that is wider than the body is hard-wrapped in bodies and cut with `…` in heads (critique W7).

## Decisions

All resolved by the owner; source: prototype verdicts 2026-11-21 (`prototype/narrow-screens/approved-narrow-screens-v1.md`, variants narrow margin `0` and floating stamp, user message in its second version); status: accepted.

| Decision | Replaces |
|---|---|
| Compact density below 60 columns, measured on terminal columns against one named constant (critique W3, owner 2026-11-21) | `edgeFor` shrinking only below 26 columns |
| Crossing 60 columns on resize keeps all UI state; only rendering changes (critique W1, owner 2026-11-21) | — |
| Transcript left margin `0`, right margin `1` whether or not the scrollbar shows (critique W3) | Margin 3 on each side |
| One margin helper with separate left and right values at every margin site, with a mouse-offset test per site (critique W2, owner 2026-11-21) | Symmetric `outer - edge*2` in each mechanism |
| Shared 2-column glyph lane; body at the same column in every block | Per-component indentation |
| Stamp with no reserve on wrapped lines: end of the last line if it fits, otherwise its own row (critique S3) | 10-column stamp reserve on every line |
| One duration formatter at every width: `3.2s` under 10 s, then `12s`, `1m 05s`, `1h 05m` (critique B1; parent, 2026-11-21) | `formatDuration` `1m5s` and `childElapsed` `1m 05s` |
| Overlays square, input surfaces rounded, docked widgets unframed | Framed Todo, mixed frames |
| Full-width modals and overlays with padding `1` below 60 columns; editor and docked surfaces margin `0`; an open overlay does not reflow on resize (critique W9, `risk accepted` by the owner 2026-11-21) | Modal and editor margins, config guide `minWidth: 48` |
| Empty docked list shows nothing; long docked lists keep the 8-row cap with `… N more · Alt+A` for subagents and pagination for the Todo; tall modals scroll with pinned hints; unbreakable tokens hard-wrap in bodies and end with `…` in heads (critique W7, owner 2026-11-21) | — |
| Hints `Key action`, joined by ` · `, left-aligned, by priority | `Key:action` with `│`, `|` separators, centered hints |
| Actions wrap; identifiers cut with `…`; nothing cut without `…` | Truncated actions, hard cuts in model profiles |
| Shared state glyph scale and marks (`◆`, `◈`, `▸`, `❯`); one table in `visual-language.ts` with Run state and Task state mappings (critique W6, owner 2026-11-21) | `□`, `⠦`, mixed cursors; maps copied per component |
| Compact tool rows keep `◆`; only the colour follows the state scale (critique W10, owner 2026-11-21) | — |
| Pi selectors and `SelectList` in scope by inheritance of the shared menu patch (critique W8, owner 2026-11-21) | Pi selectors out of scope |
| User message: background block kept, no outer margin, padding `1`, stamp in bottom row as last resort | User text at 25 columns with `❯` prefix margin |
| Thinking rail in lane; inline expand hint hidden | Inline hint |
| Error red only; abort `–` muted | — |
| Advisor card head `Advisor 12s ›`, model on own line, tail always shown | — |
| Subagent and parent cards: `›` affordance, coloured state word, reason up to 2 lines | ResultCard dropping `ctrl+o` hint at 44 |
| Backstop and budget: metric in head, `→` action on its own wrapping warning line | Action truncated in the head |
| Asked: hanging indent, `↳` in lane | — |
| Markdown: list indent 2 per level; code blocks with `▎` rail, no fences, no indent | Pi's list indent and fenced code |
| Header: unchanged; `header-identity` stays authoritative (critique B3) | Nothing |
| Footer order idle and working; footer hints hidden while the operator question panel is open (critique W5, owner 2026-11-21) | `Shift+Tab:thinking │ Ctrl+P:model` order; hints in both footer and panel |
| Editor placeholder `What should we build?` and caption without provider | `claude-opus-5-5 (high)` caption |
| Todo heading `▾ Todo 1/3`, `n/m` done over total (the control row keeps visible over total); the heading collapses on tap or click, Alt+Shift+T kept; capacity without frame rows (critique W4, owner 2026-11-21) | Prototype's `Tasks`; framed Todo; `×` collapse target |
| Subagents box without model or selection background; hint `Alt+A`; overflow tail `… N more · Alt+A` | `alt+a view`, model per row |
| Operator question: description below label, cursor `▸`, hints inside the panel | `❯` cursor and right-hand descriptions of `prototype/operator-question/approved-questions-v2.md` |
| Settings full width, `▸` only on the selected row | `▸` on every row |
| Model profiles: two lines per specialist | One line with hard cut |
| Fleet view rows on two lines; focus-only hints | — |
| Out-of-scope list and follow-ups as in the contract | — |

## Open questions

| ID | Question | Resolver | Status | Options |
|---|---|---|---|---|
| D-open-1 | Do the coherence rules (glyphs, hint format, frames, cursor, undocked widgets, no stamp reserve) apply at all widths, or only below 60 columns? The owner reviewed at 44 columns only. | owner | resolved 2026-11-21: only below 60 columns; at 60 columns and above today's layout stays | (a) all widths; (b) only below 60 columns; (c) per rule |
| D-open-2 | Confirm the contract's "pending confirmation" rules, derived from the prototype's system section, which had no verdict control: durations as `1m 05s` everywhere; sentence-case labels with lowercase state words; `✗` covering timed out, replacing `⧖`; abort and stop shown as `cancelled`; operator question stacking descriptions below 70 inner columns also at wide widths. | owner | resolved 2026-11-21, all below 60 columns: durations `1m 05s` accepted by the owner; the 70-inner-column stacking dropped by D-open-1; the owner delegated the rest to the agent, which accepted sentence-case labels with lowercase state words, `✗` for timed out with the word `timed out` carrying the difference, and `cancelled` for abort and stop, matching the glossary Run state | Confirm or reject each rule separately |

## Assumptions

| Assumption | Source | Status |
|---|---|---|
| The iPhone 13 in Herdr mobile gives about 44 columns. The real `tput cols; tput lines` has not been measured. | Owner report; contract follow-ups | open, to measure; slice 2 exit criterion |
| Glyph widths (`◐ ▸ ▎ ◈ – ✗ ✓ ○ ⠋`) are 1 column under iOS fallback fonts. Not checked. | Contract follow-ups | open, to check; slice 2 exit criterion |
| `fullscreenScrollbar` is set to always, so the chat gets one column less than the terminal. | Real renders C13 | observed |
| 60 columns is the density threshold for every component. | Contract | accepted |

## Shared capabilities and invariants

| Capability | Use | Observable invariant |
|---|---|---|
| `visual-language.ts` state-glyph table (new) | The only state-glyph table, with Run state and Task state mappings sharing glyphs; replaces the maps in `children-box.ts` and `todo-header.ts`; `children-view.ts` already consumes `childGlyph` from `children-box.ts`; `⊘` interrupted stays as an extra Run state row (critique W6, owner 2026-11-21; parent, 2026-11-21) | Every component shows the same glyph for the same state |
| `visual-language.ts` `spread` | Reused where left/right layout stays; replaced by wrapping where an action would be cut | Never truncates an action; identifiers end with `…` |
| `visual-language.ts` `formatDuration` | Becomes the single duration formatter, shared by `childElapsed`: under 10 s one decimal (`3.2s`), then whole seconds rounded (`12s`), then `1m 05s`, then `1h 05m`, at every width (owner decision 2026-11-21, exception to D-open-1; critique B1; rule detail parent, 2026-11-21; today `formatDuration` gives `1m5s` and `childElapsed` floors seconds with no decimal). Note for to-spec: existing duration tests, such as `test/chrome.test.mjs:245`, update accordingly | One duration format across the stream, cards, status row, and Fleet view |
| `chrome-messages.ts` `Framed`, `edgeFor` | Extended: left edge `0` and right margin `1` below 60 columns, lane, floating stamp | Body text starts at the same column in every block; no wrapped line loses width to the stamp; `handleMouse` offsets match the rendered layout |
| Margin helper (new) | One helper with separate left and right values, used by `Framed`, `ThinkingHeader`, `wrapRowRender`/`wrapRowMouse`, `foldChat` (to confirm), `child-result-card` `frame()`, `runtime-notice-card`, `advisor-card` through the row inset, and `chrome-groups.ts:387` (critique W2, owner 2026-11-21; detail for to-spec) | No site assumes symmetric margins; a mouse-offset test per site |
| Narrow-width constant (new) | One named constant (60) compared with the terminal's column count (critique W3, owner 2026-11-21) | Every component switches density at the same terminal width; all UI state survives the switch (critique W1) |
| `chrome-menus.ts` `modalFrame`, `hintRows`, `hintGap`, `swapMarker`, `menuRow` | Extended: full width with padding `1` below 60 columns; ` · ` joined, left-aligned hints; tall modals scroll with pinned hints (critique W7); Pi selectors and `SelectList` inherit the changes (critique W8, owner 2026-11-21) | Square corners; hints in `Key action` form, by priority |
| `chrome-editor.ts` `marginFor` | Extended: margin `0` below 60 columns | Rounded frame; caption without provider |
| `compact-tools.ts` | Tool rows and groups in the lane | Glyph stays `◆`; its colour comes from the shared state scale (critique W10, owner 2026-11-21) |
| `children-box.ts` | Unframed docked widget, no model, no selection background | Heading pattern `▾ Label …`; hint `Alt+A`; no heading and no rows when empty; 8-row cap with tail `… N more · Alt+A` (critique W7) |
| `todo-header.ts` | Unframed, `▾ Todo n/m` heading with `n/m` done over total, shared glyphs; the heading is the collapse target; capacity and hit rows recomputed without frame rows (critique W4, owner 2026-11-21) | No blank rows; same heading pattern as the subagents box; Alt+Shift+T still collapses; no heading and no rows when empty (critique W7) |
| `ask-user-panel.ts` | Description below label, `▸` cursor, hints inside; the footer hides its hints while the panel is open (critique W5, owner 2026-11-21) | Docked placement and rounded input frame of ADR 0019 unchanged; hints show in one place only |
| Comparison implementations | `child-result-card.ts`, `advisor-card.ts`, `context-backstop-card.ts`, `exploration-budget-card.ts`, `model-profiles-editor.ts`, `configure-guide.ts`, `children-view.ts` | Each follows the same lane, hint, and ellipsis rules. The header (`chrome.ts` `renderHeader`) is excluded: `docs/features/header-identity.md` stays authoritative (critique B3) |

## Prototype

- Artifact: `prototype/narrow-screens/index.html`, with real "before" renders in `renders-before-7fad399.txt`.
- Disposition: reference-only, contract v1 (`approved-narrow-screens-v1.md`). Every component approved by the owner on 2026-11-21. Evidence, not an implementation base; renders are a per-cell simulation and some panes are derived from code.

## Dependencies and deviations

- Dependency: the Markdown changes (list indent, code-block rail) touch Pi internals and need a new Pi patch under ADR 0007, with its source note naming the Pi version.
- Deviation: this feature supersedes the `❯` cursor and right-hand descriptions of `prototype/operator-question/approved-questions-v2.md`, below 60 columns only.
- Deviation resolved: superseding the cursor and description layout of `prototype/operator-question/approved-questions-v2.md` below 60 columns is recorded by ADR 0031 (`docs/adr/0031-operator-question-on-narrow-screens.md`, owner-approved 2026-11-21) amends ADR 0019 for this below 60 columns.
- Hints inside the operator question panel, with the footer hiding its own hints while the panel is open (critique W5, owner 2026-11-21): ADR 0031 (`docs/adr/0031-operator-question-on-narrow-screens.md`, owner-approved 2026-11-21) amends ADR 0019 for this below 60 columns.

## Risks and gaps

- Risk: the stamp can move from the end of the last line to its own row while a message streams (critique S3 reduced the placements to these two). Mitigation: render tests for each placement, and owner visual review of streaming before closing.
- Risk: a Pi upgrade can break the patches, now including the Markdown patch (ADR 0007 has no version guard). Mitigation: source notes and re-verification on every upgrade.
- Risk: glyph fallback widths under iOS fonts can misalign the lane. Mitigation: `visibleWidth` tests and a check on the device.
- Accepted risk: an overlay open during a resize across 60 columns does not reflow; it keeps the layout it opened with. Accepted by the owner on 2026-11-21 (critique W9): it is rare, and reopening the overlay fixes it.
- Gap for `domain-modeling`: the shared state-glyph table maps both Run state and Task state; their terminology is routed to `domain-modeling` (critique W6, owner 2026-11-21).
- Gap: the real terminal size on the iPhone is not measured. It is the slice 2 exit criterion (see Scope).
- Admissible gap: there is no Domain Authority Handoff; `docs/agents/domain.md` records `present (root-selected)`, so `GLOSSARY.md` (Chrome, Todo, Fleet view, Operator question, Run state, Task state) is the root authority.
- Terminology gap for `domain-modeling`: the UI label "Subagents" (box and cards) is not a glossary term; the glossary names child sessions and avoids "subagent package".
