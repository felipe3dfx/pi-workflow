# Chrome on Narrow Screens

Status: approved specification, READY WITH WARNINGS; not implemented. Tracker state is authoritative. Specification identity: `narrow-screens/specification-1`; definition: `narrow-screens/definition-1`; feature-critic report: [`docs/features/narrow-screens-review.md`](../features/narrow-screens-review.md), READY WITH WARNINGS (final check 2026-11-21). Parent: none yet; the tracker issue is recorded in [the specification index](README.md). Companions: [brief](../features/narrow-screens.md), [feature review](../features/narrow-screens-review.md), [specification review](narrow-screens-review.md), and the reference-only [approved prototype contract v1](../../prototype/narrow-screens/approved-narrow-screens-v1.md).

The [brief](../features/narrow-screens.md) is the authoritative statement of approved behaviour. Where this specification restates it, the brief wins on any difference; where the brief records a critique correction or owner decision dated after the prototype approval of 2026-11-21, the brief wins over the prototype contract (see [Prototype decisions](#prototype-decisions)). This specification adds no functional decision. It adds technical decisions labelled **mandatory** (with source and necessity) or **recommendation**, and one slice-map clarification recorded by the parent under the owner's delegation.

## Problem

The operator runs pi-workflow inside Herdr mobile on an iPhone 13, about 44 terminal columns wide. The Chrome spends too much of that width on margins, indentation and reserves, so text is hard to read, actions and identities are truncated away, and components disagree on hints, frames, cursors and state glyphs.

Real renders on commit `7fad399` ([renders](../../prototype/narrow-screens/renders-before-7fad399.txt)) measure the failure at 44 columns with `fullscreenScrollbar` set to always:

- The chat gets 43 columns; the scrollbar takes the last one. Widgets above the editor get 44 (C13).
- Assistant text wraps at 27 columns: a 3-column margin on each side plus a 10-column stamp reserve on every wrapped line, although the stamp draws only on the first line (C1). User text wraps at 25 columns (C2).
- The message margin only shrinks below 26 columns, so 44 columns keeps the full desktop margin (C1 `edgeFor` probe).
- The context backstop and exploration budget heads truncate their `→` action (C5).
- The subagent ResultCard drops its expand hint at 44 columns, and the expanded card cuts the model mid-name (C4).
- Model profiles hard-cut models without an ellipsis (C11).
- The config guide's 48-column minimum is clamped to 44 (C12).
- Hints, frames, cursors and state glyphs differ between components (C7–C11).

## Solution

Below one named narrow-width threshold of 60 terminal columns, every Chrome surface switches to a compact density and to one shared set of coherence rules. At 60 columns and above today's layout stays, except for the single duration format, which applies at every width. At about 44 columns, assistant text goes from 27 to 40 columns, no action or identity is cut away, and every component follows the same lane, margin, hint, frame, cursor, glyph and ellipsis rules.

Delivery is three ordered slices: slice 1 width, slice 2 coherence (gated on a device check), slice 3 Markdown (a new Pi patch under ADR 0007).

## User stories

- As the operator on a phone-width terminal, I read assistant and user text at nearly the full terminal width, so long answers do not become narrow columns.
- As the operator, I always see a card's expand affordance and a notice's recommended action in full, so I never lose an action to truncation.
- As the operator, I see the same glyph for the same state, the same hint format, and the same cursor in every component, so I learn the Chrome once.
- As the operator rotating the device across 60 columns, I keep my expanded blocks, selection, scroll position and focus; only the rendering changes.
- As the operator on a wide terminal, I keep today's layout, so the narrow redesign does not disturb desktop use.
- As the operator answering an operator question on a narrow screen, I see the panel's own key hints in one place, with descriptions below each label.

## Authority and terminology

- Resolver for every product decision: the owner, 2026-11-21, through the prototype verdicts and the critique dispositions recorded in the brief and the feature review. Rule details and slice assignments marked "parent, 2026-11-21" were recorded by the parent under the owner's delegation.
- Domain authority: `GLOSSARY.md`, state `present (root-selected)` per `docs/agents/domain.md` (Chrome, Shell, Visual language, Screen place, Todo, Task state, Fleet view, Operator question, Run state, Child session, Compact rendering, Advisor, Context backstop). No Domain Authority Handoff was supplied; the absence is admissible because functional and semantic decisions are closed, and it is recorded as an evidence gap.
- Terminology gap routed to `domain-modeling` (critique W6): the UI label "Subagents" (docked box and cards) is not a glossary term; the glossary names Child session and avoids "subagent package". This specification keeps the existing label "Subagents" as current behaviour and renames nothing. Which glossary state each row of the shared state-glyph table names (Run state versus Task state) is also routed to `domain-modeling`; the glyph per row is decided.
- Binding decisions: ADR 0007 (Pi internals are patched with source notes, no version guard), ADR 0019 (operator question docks at the bottom), ADR 0031 (amends ADR 0019 below the narrow-screen threshold), and `docs/features/header-identity.md` (header stays authoritative).

## Decisions

All rows: resolver owner; source prototype verdicts 2026-11-21 (`approved-narrow-screens-v1.md`, variants narrow margin `0` and floating stamp, user message second version) plus the cited critique disposition; status accepted. "Slice" is the delivery slice (see [Delivery structure](#delivery-structure)). "Replaces" is the superseded current behaviour or earlier decision.

| ID | Decision (brief wording condensed) | Critique / detail source | Replaces | Slice |
|---|---|---|---|---|
| NS-01 | Compact density below 60 columns, measured on terminal columns against one named constant | W3, owner 2026-11-21 | Margin shrinking only below 26 columns | 1 |
| NS-02 | Crossing 60 columns on resize keeps all UI state; only rendering changes | W1, owner 2026-11-21 | — | 1 (holds in every slice) |
| NS-03 | Transcript left margin `0`, right margin `1`, whether or not the scrollbar shows | W3 | Margin 3 on each side | 1 |
| NS-04 | One margin helper with separate left and right values at every margin site, with a mouse-offset test per site | W2, owner 2026-11-21; site list parent 2026-11-21 | Symmetric `outer - edge*2` per mechanism | 1 |
| NS-05 | Shared 2-column glyph lane; body at the same column in every block | — | Per-component indentation | 1 |
| NS-06 | Stamp with no reserve on wrapped lines: end of the last line if it fits, otherwise its own row; never on the first line of a multi-line message | S3, accepted 2026-11-21 | 10-column reserve on every line; prototype "first line if it fits" | 1 |
| NS-07 | One duration formatter at every width: `3.2s` under 10 s, then whole seconds rounded (`12s`), then `1m 05s`, then `1h 05m`; `formatDuration` and `childElapsed` share it; explicit exception to D-open-1 | B1; owner decision for `1m 05s`; rule detail parent 2026-11-21 | `formatDuration` `1m5s`; `childElapsed` flooring with no decimal | 1 |
| NS-08 | Overlays square corners, input surfaces (editor, operator question) rounded, docked widgets (Todo, subagents box) unframed | — | Framed Todo, mixed frames | 2 |
| NS-09 | Below 60 columns modals and overlays open at full width with padding `1`; an overlay open during a resize keeps the layout it opened with; reopening lays it out again | W9, **risk accepted** by the owner 2026-11-21 | Modal margins; config guide minimum width 48 clamped | 1 (overlays) |
| NS-10 | Editor and docked surfaces use margin `0` below 60 columns | — | Editor and docked margins | 2 (editor, docked widgets) |
| NS-11 | Empty docked list shows no heading and no rows; long docked lists keep today's 8-row cap, the subagents tail reads `… N more · Alt+A`, the Todo keeps its pagination; modals taller than the screen scroll with hints pinned; an unbreakable token wider than the body hard-wraps in bodies and ends with `…` in heads | W7, owner 2026-11-21; residuals parent 2026-11-21 | — | 1 |
| NS-12 | Hints read `Key action`, joined by ` · `, left-aligned, ordered by priority | — | `Key:action` with `│`, `|` separators, centred hints | 2 |
| NS-13 | Actions and instructions wrap; identifiers are cut with `…`; nothing is cut without `…` | — | Truncated actions; hard cuts in model profiles | 1 and 2 (each slice's surfaces) |
| NS-14 | One state-glyph scale and marks (`◆` event, `◈` group, `▸` cursor, `❯` input prompt); one table in `visual-language.ts` with Run state and Task state mappings; `⊘` interrupted stays as an extra Run state row | W6, owner 2026-11-21; residual parent 2026-11-21 | `□`, `⠦`, mixed cursors; maps copied per component | 2 |
| NS-15 | Compact tool rows keep `◆` in every state; only its colour follows the state scale | W10, owner 2026-11-21 | — | 2 (colour); 1 (lane) |
| NS-16 | Pi selectors and `SelectList` are in scope by inheritance of the shared menu patch; no layout of their own | W8, owner 2026-11-21 | Pi selectors out of scope | 2 |
| NS-17 | User message: background block kept with one background row above and below; no outer margin; inner padding `1`; text one column right of the lane; stamp in the bottom background row as last resort | S3 for the stamp | User text at 25 columns with `❯` prefix margin | 1 |
| NS-18 | Thinking: `┃` rail in the lane (slice 1); inline expand hint hidden, row stays tappable (slice 2) | slice-map clarification | Inline hint | 1 / 2 |
| NS-19 | Error red only; abort `–` muted | — | — | 2 |
| NS-20 | Advisor card: short head `Advisor 12s ›`, model on its own dim line, tail `+N lines · tap or ctrl+o` always shown (slice 1); glyph `◆` in accent replacing `◇` (slice 2) | slice-map clarification | — | 1 / 2 |
| NS-21 | Subagent and parent cards: collapsed head always carries a 1-column `›` affordance (slice 1); state as a coloured word and reason up to 2 lines (slice 2); expanded `⌄` state not laid out | slice-map clarification | ResultCard dropping its expand hint at 44 | 1 / 2 |
| NS-22 | Context backstop and exploration budget: head with metric and a `›` affordance never dropped; `→` action on its own warning line that wraps and is never truncated; backstop advisor status on a dim line of its own, only when present | B2, owner 2026-11-21 | Action truncated in the head | 1 |
| NS-23 | Asked: `↳` answer in the lane (slice 1); question with a hanging indent (slice 2) | slice-map clarification | — | 1 / 2 |
| NS-24 | Markdown: list indent 2 columns per level; code blocks with a `▎` rail, no fences, no indent | S2 moved to slice 3 | Pi's list indent and fenced code | 3 |
| NS-25 | Header unchanged; `docs/features/header-identity.md` stays authoritative | B3, owner 2026-11-21 | Prototype header redesign | none |
| NS-26 | Footer: hints joined by ` · `; idle `Ctrl+O expand` first; working `Esc interrupt · Enter steer · Ctrl+O expand`; footer hides its hints while the operator question panel is open | W5, owner 2026-11-21; ADR 0031 | `Shift+Tab:thinking │ Ctrl+P:model` order; hints in both footer and panel | 2 |
| NS-27 | Editor: margin `0`, placeholder `What should we build?`, caption `opus-5-5 · high` without the provider | — | `claude-opus-5-5 (high)` caption | 2 |
| NS-28 | Todo: heading `▾ Todo n/m` with `n/m` done over total; control row keeps visible over total; no frame, no blank rows, shared glyphs; tapping or clicking the heading collapses it; Alt+Shift+T kept; capacity and hit rows recomputed without frame rows | W4, owner 2026-11-21; control row parent 2026-11-21 | Prototype `Tasks`; framed Todo; `×` target | 2 |
| NS-29 | Subagents box: no model (the Fleet view shows it), id, step and time stay; no selection background; hint `Alt+A` | — | `alt+a view`, model per row | 2 (tail `… N more · Alt+A` is NS-11, slice 1) |
| NS-30 | Operator question: description below the label at full width; cursor `▸`; hints inside the panel; at 60 columns and above unchanged, no 70-inner-column threshold | W5, I1; ADR 0031 | `❯` cursor and right-hand descriptions of `approved-questions-v2.md`, below 60 only | 2 |
| NS-31 | Settings: full width with padding `1` (slice 1, overlay rule); `▸` marks only the selected row (slice 2) | — | `▸` on every row | 1 / 2 |
| NS-32 | Model profiles: models cut with `…` (slice 1); each specialist on two lines, role and thinking level first, full model second (slice 2) | — | One line with hard cut | 1 / 2 |
| NS-33 | Workflow config: full width with padding `1` (slice 1); hints left-aligned (slice 2) | W9 | Minimum width 48 clamped | 1 / 2 |
| NS-34 | Fleet view: overlay full width (slice 1); rows always two lines, identity and state first, detail and usage second; only the hints for the current focus, on one or two rows (slice 2) | — | — | 1 / 2 |
| NS-35 | Out-of-scope list and follow-ups as in the contract, corrected by the brief | B3, W4, W8 | — | — |
| D-open-1 | Coherence rules apply only below 60 columns; at 60 and above today's layout stays | owner, resolved 2026-11-21 | Prototype wide panes showing coherence changes | all |
| D-open-2 | Below 60 columns: durations `1m 05s` (owner; superseded in scope by NS-07 to every width); 70-inner-column stacking dropped (D-open-1); sentence-case labels with lowercase state words, `✗` for timed out with the word `timed out` carrying the difference (replacing `⧖`), and `cancelled` for abort and stop, matching the glossary Run state (owner delegated to the agent). The Advisor phase word `stopped` also becomes `cancelled` below 60 columns: the delegated rationale was "Advisor says `stopped` while subagents say `cancelled` for the same thing" (parent, 2026-11-21) | owner, resolved 2026-11-21; owner-delegated | `⧖`; `stopped` | 2 |
| Slice map | Three slices (S1), Markdown in slice 3 (S2), slice 2 gated on the device check (S4); every in-scope item in exactly one slice | S1, S2, S4 accepted by the owner; map parent 2026-11-21 | One delivery | — |
| Slice-map clarification | Items the brief's slice map did not name: lane-derived items (thinking rail, asked `↳`, status-row spinner, user-message edge, padding and stamp row) go to slice 1; the thinking hint, card state word and reason, notice colours, asked hanging indent and D-open-2 label rules go to slice 2; the Advisor card is split as NS-20 states. An assignment of already-approved behaviour, not a functional change | parent, 2026-11-21, under the owner's delegation | — | — |

## Required behaviour

"Narrow" means the terminal's column count is below the narrow-width constant (60). "Wide" means 60 or more. Wide rendering is today's rendering except where a row above says "at every width" (NS-07 only).

### Density (narrow)

- The only signal is the terminal's column count compared with the constant. The chat width (43 with the scrollbar), the scrollbar setting, and the width a component is given do not affect it (NS-01). Every component switches at the same terminal width.
- Transcript blocks render with left margin `0` and right margin `1` whatever the scrollbar setting (NS-03). Every block has a 2-column glyph lane; body text starts right after it at the same column in every block (NS-05). At 44 columns with the scrollbar always shown, assistant text wraps at 40 columns.
- Margins are asymmetric. Every place that offsets content horizontally, and every mouse handler for that content, uses the same left and right values, so a click on a rendered cell reaches the cell's content (NS-04).
- The stamp reserves no columns on any line. For a message of one line it follows the text if it fits; for a multi-line message it goes at the end of the last line if it fits, otherwise on a row of its own, never on the first line. For the user message the own-row case uses the bottom background row. While streaming the placement is re-evaluated on each render (NS-06, NS-17).
- Modals and overlays open at the full terminal width with padding `1`. A surface whose minimum width exceeds the terminal (the config guide's 48) follows this rule instead of being clamped. Width options are fixed when the overlay opens; an overlay open while the terminal crosses 60 columns keeps its opening layout until reopened (NS-09, accepted risk W9).
- Editor and docked surfaces use margin `0` (NS-10, slice 2).
- Empty and overflow states follow NS-11.

### Coherence (narrow only; D-open-1)

Frames (NS-08), hints (NS-12), ellipsis (NS-13), state glyphs (NS-14) and marks, tool-row colour (NS-15), Pi selectors by inheritance (NS-16), and labels (D-open-2).

State-glyph scale (NS-14):

| State | Glyph |
|---|---|
| Queued or pending | `○` muted |
| Running | `◐` cyan, or the braille spinner where today's rows animate |
| Waiting for the operator | `?` warning |
| Blocked | `!` warning |
| Done | `✓` success |
| Failed or timed out | `✗` error; the state word tells them apart |
| Cancelled or aborted | `–` muted |
| Interrupted child (Fleet view, extra Run state row) | `⊘`, as today |

### Per surface (narrow)

Each surface's behaviour is NS-17 to NS-34 as stated in the brief's Scenarios and Modals sections. Surfaces out of scope keep their current behaviour and follow the shared rules only when later built or touched ([Out of scope](#out-of-scope)).

### Resize (NS-02)

Density is decided on every render from the live terminal column count. Crossing 60 columns switches density on the next render. Expanded or collapsed blocks, the selection, the scroll position and the focus survive unchanged in both directions. The only exception is NS-09: an open overlay keeps its opening width until reopened.

### Errors

- No content is cut without `…`; an action or instruction that does not fit wraps.
- An unbreakable token wider than the body hard-wraps in bodies and is cut with `…` in heads.
- A surface whose minimum width exceeds the terminal follows the full-width modal rule.

## Delivery structure

Three slices, delivered in order. Each slice's items are listed in [Decisions](#decisions). Wide rendering stays unchanged in every slice except for NS-07.

### Slice 1: width

Items: NS-01 to NS-07, NS-09 (overlays), NS-11, NS-13 for slice-1 surfaces, NS-15 lane part, NS-17, NS-18 rail, NS-20 head, model line and tail, NS-21 `›` affordance, NS-22, NS-23 `↳` in the lane, the status-row spinner in the lane, NS-31 to NS-34 full-width parts, NS-32 `…` cut.

Dependencies: none on ADR 0019, ADR 0031 or ADR 0007. Slice 1 changes neither the operator question panel nor Pi's Markdown rendering.

Acceptance criteria:

1. At 44 terminal columns with the scrollbar always shown, assistant text wraps at 40 columns and user text starts one column right of the lane, with the background reaching the edge and inner padding `1`.
2. At terminal columns 59 the narrow layout applies; at 60 the wide layout applies, byte-identical to today's except durations. The decision depends on terminal columns only: a component given 43 columns in a 44-column terminal and one given 59 in a 60-column terminal both follow the terminal.
3. No wrapped line loses width to the stamp; stamp placements (end of the last line, own row, user-message bottom row) each render correctly and never on the first line of a multi-line message, including while streaming.
4. Each margin site listed in [S-02](#structural-decisions) passes a mouse-offset test: a click on a rendered cell reaches the content at that cell, and clicks on margin cells are not delivered as content clicks.
5. Backstop and budget: the head shows the metric and `›`; the `→` action shows in full on its own warning line, wrapping as needed; the backstop's advisor status shows on its own dim line only when present. At 60 columns and above both render as today.
6. ResultCard, subagent and parent cards keep their 1-column `›` at 44 columns; the Advisor card shows `Advisor 12s ›`, the model on its own dim line, and the `+N lines · tap or ctrl+o` tail.
7. Model profiles end every cut model with `…`. The config guide, settings, model profiles, model picker and Fleet view open at the full width with padding `1` at 44 and at 48–59 columns.
8. Empty docked lists render nothing; the subagents box at its 8-row cap shows `… N more · Alt+A`; the Todo keeps pagination; a modal taller than the screen scrolls with its hints in view; an unbreakable token hard-wraps in bodies and ends with `…` in heads.
9. Every duration in the stream, cards, status row and Fleet view reads `3.2s`, `12s`, `1m 05s` or `1h 05m` at every width.
10. Crossing 60 columns in either direction preserves expanded blocks, selection, scroll position and focus.
11. `npm run check` passes on the implementation head.

### Slice 2: coherence (gated)

Exit criterion that unblocks it (S4; parent, 2026-11-21): the owner reports the output of `tput cols; tput lines` from Herdr on the iPhone and confirms that `◐ ▸ ▎ ◈ – ✗ ✓ ○ ⠋` each render one column wide there. Slice 2 work does not start before that report.

Items: NS-08, NS-10, NS-12, NS-13 for slice-2 surfaces, NS-14, NS-15 colour, NS-16, NS-18 hint, NS-19, NS-20 glyph, NS-21 state word and reason, NS-23 hanging indent, NS-26 to NS-30, NS-31 `▸`, NS-32 two-line rows, NS-33 hints, NS-34 rows and hints, D-open-2 label rules.

Dependencies: ADR 0031 for the operator question layout and footer hint hiding.

Acceptance criteria:

1. Every component renders the same glyph and colour for the same state from the shared table; the copied maps in the subagents box and Todo are gone; the Fleet view keeps `⊘` for an interrupted child; wide rendering keeps today's glyphs, including `□` and `⧖`.
2. Compact tool rows keep `◆` in every state; the colour follows the scale.
3. Hints read `Key action`, joined by ` · `, left-aligned and by priority in the footer, modals, Pi selectors and `SelectList`; Pi selectors change only through the shared menu patch.
4. Footer idle and working orders match NS-26; while the operator question is open on a narrow screen, the footer shows no hints and the panel shows its own; they return when the panel closes. At 60 columns and above the operator question and footer behave as today (ADR 0019).
5. Overlays square, input surfaces rounded, docked widgets unframed; cursor `▸`; settings mark only the selected row.
6. Todo: heading `▾ Todo n/m` with done over total; control row keeps visible over total; no frame or blank rows; a tap or click on the heading collapses it; Alt+Shift+T collapses; capacity and hit rows match the unframed layout; no heading or rows when empty.
7. Subagents box: unframed heading pattern `▾ Subagents …` (label unchanged), no model, no selection background, hint `Alt+A`.
8. Editor margin `0`, placeholder `What should we build?`, caption without provider.
9. Model profiles two-line rows; Fleet view two-line rows and focus-only hints; operator question description below label with cursor `▸`.
10. Labels in sentence case, state words lowercase; `timed out` shows `✗`; abort and stop show `cancelled`, including the Advisor phase word.
11. The owner reviews streaming stamp behaviour on the device before the feature closes (risk mitigation).
12. `npm run check` passes on the implementation head.

### Slice 3: Markdown (ADR 0007)

Items: NS-24.

Dependencies: a new Pi patch under ADR 0007, with a source note naming the Pi version it replicates.

Acceptance criteria:

1. Narrow assistant Markdown renders list indent 2 columns per level and code blocks with a `▎` rail, no fences and no indent; wide Markdown renders as today; tables are unchanged.
2. The patch is idempotent, applied and restored with the existing message patch set, and carries a source note naming the Pi version.
3. `npm run check` passes on the implementation head.

## Structural decisions

Terms follow the `codebase-design` vocabulary: module, interface, implementation, seam, adapter, depth, leverage, locality.

| ID | Decision | Evidence | Reason and necessity | Label |
|---|---|---|---|---|
| S-01 | One narrow-width constant (60) and one narrow predicate that every surface asks, reading the live terminal column count on each call | No module reads terminal columns today; message components only receive their render width, which is 43 in a 44-column terminal (C13). Pi's terminal exposes `columns` alongside `rows`; the Chrome already holds the TUI through its header, footer and editor factories, and the Shell already reads live rows | NS-01 requires one named constant compared with terminal columns; NS-02 requires re-evaluation on every render, so the predicate must not be cached in component state | **Mandatory** (brief NS-01, NS-02; critique W3, W1) |
| S-01a | Place the constant and predicate in the visual-language module, fed by the TUI the Chrome already holds; tests set the column count through the same interface | Visual language is the glossary's shared home for rhythm and frames; it already owns `formatDuration`, `spread` and the spinner | One module gives every caller the same answer (locality) and gives tests one seam. Without a mounted terminal, answering "wide" preserves today's rendering; this default is a recommendation, not a product decision | Recommendation |
| S-02 | One margin helper taking separate left and right values, used by every transcript margin site and its mouse handler | Sites that assume symmetric margins: `Framed` render and mouse; `ThinkingHeader`; tool and bash row render and mouse wrappers; the child-result-card frame; `RuntimeNoticeCard`; the Advisor card, which renders inside a tool row with its own inset `0` and relies on the tool row wrapper's margin; and, through the indent `foldChat` supplies, the chat group label row, the chat row mouse clamp and the keyboard-cursor activation point in `chrome-groups.ts`. Resolution of the brief's note: `foldChat` applies no margin itself; it supplies the indent that those three `chrome-groups.ts` consumers apply, so they, not `foldChat`, are the sites | NS-03 makes margins asymmetric; NS-04 requires one helper and a mouse-offset test per site. A per-site formula would reintroduce the W2 defect | **Mandatory** (brief NS-04; critique W2) |
| S-02a | Deepen the existing margin seam that `edgeFor` occupies into the helper, rather than adding a parallel one | `edgeFor` is already imported by the message, card and notice modules; the indent callback already flows into `patchChat` | Highest useful existing seam; preserves wide behaviour behind the same interface | Recommendation |
| S-03 | The shared editor and overlay margin (`marginFor`) must not change the header | `renderHeader`, the status row, the footer, the editor, operator question, Fleet view and Pi selectors all read `marginFor` | NS-25: the header stays under `header-identity`; changing `marginFor` globally would move the header | **Mandatory** (brief NS-25; critique B3) |
| S-03a | Give narrow surfaces their margin through the narrow predicate at each consumer (editor, docked widgets, overlays, status row), leaving the header's call untouched | Same call sites | Keeps the header byte-identical with the least change | Recommendation |
| S-04 | One state-glyph table in the visual-language module, holding Run state and Task state mappings that share glyphs plus the `⊘` interrupted row, and today's wide glyphs so wide rendering is unchanged; the subagents box and Todo maps are removed; the Fleet view follows through `childGlyph`; compact tool rows take their colour from it | Copied maps in `children-box.ts` and `todo-header.ts`; `children-view.ts` consumes `childGlyph`; `⊘` lives in the Fleet view; compact tool rows colour `◆` locally | NS-14 names the location and replacements; D-open-1 requires wide glyphs (`□`, `⧖`) to stay, so the one table carries both | **Mandatory** (brief NS-14, Shared capabilities; critique W6, W10) |
| S-05 | One duration formatter, used by `formatDuration` and `childElapsed` | `formatDuration` gives `1m5s`; `childElapsed` floors whole seconds and gives `1m 05s`; the status row, thinking header, Fleet view, cards and subagents box call one or the other | NS-07 requires one format at every width. Consequences: `childElapsed` rounds instead of flooring and shows one decimal under 10 s; existing duration expectations (including the `formatDuration` table test in `test/chrome.test.mjs`) update | **Mandatory** (brief NS-07; critique B1) |
| S-05a | `childElapsed` computes elapsed milliseconds and delegates formatting to `formatDuration` | Both already live in modules the callers import | One implementation; deletion test shows the duplicated rules would otherwise reappear in two modules | Recommendation |
| S-06 | `RuntimeNoticeCard` receives the head, the action, and the optional status as separate parts; narrow layout is head with metric and `›`, warning action line, dim status line; wide layout recomposes today's single line | The card takes one prebuilt head string; the backstop appends its advisor status to the head and has no `→`; the card drops its hint when the head is long | NS-22 and the B2 disposition ("`RuntimeNoticeCard` receives these parts separately") | **Mandatory** (brief NS-22; critique B2) |
| S-07 | Hint format, modal frame width and padding, tall-modal scrolling with pinned hints, and the selected-row marker change only in the shared menu module (`hintRows`, `modalFrame`, the hint separator, `swapMarker`, `menuRow`) | Pi selectors and `SelectList` are restyled only through these patched functions | NS-16 puts Pi selectors in scope by inheritance only; any per-selector layout would exceed scope | **Mandatory** (brief NS-16, NS-11; critique W8, W7) |
| S-08 | Below 60 columns the operator question publishes no footer hints through the existing footer-hints seam and renders its hints inside the panel | Today the panel publishes its hints to the footer, which then shows the panel's hints instead of its own | ADR 0031; NS-26, NS-30 | **Mandatory** (ADR 0031; critique W5) |
| S-09 | Overlay width options are computed when the overlay opens from the terminal columns; no reflow mechanism is built | Overlay options are fixed at open in the config guide and model picker | NS-09 accepts the no-reflow risk; building reflow is out of scope | **Mandatory** (brief NS-09; W9 risk accepted) |
| S-10 | The Todo heading row becomes a hit target with the existing collapse action; capacity subtracts no frame rows | The Todo renderer already returns logical-cell hit targets and computes capacity with frame overhead | NS-28 | **Mandatory** (brief NS-28; critique W4) |
| S-11 | The Markdown list indent and code rail are a new patch target in the existing message patch set, with its source note | The message patch set already patches `Markdown.renderToken`; Pi's list indent is hard-coded in `renderList`; the code indent is a theme property | NS-24; ADR 0007 | **Mandatory** (ADR 0007; critique S2) |
| S-11a | Prefer the code-indent theme property over a patch where it suffices, and patch only the list indent and fence rendering | Pi's `MarkdownTheme` exposes `codeBlockIndent` | ADR 0007 prefers public APIs where Pi exposes them | Recommendation |

## Shared-capability invariants

For implementation and ticket slicing. A ticket that touches a capability must keep its invariant; a ticket must not split one capability's invariant across slices in a way that leaves an intermediate state violating it.

| Capability | Invariant |
|---|---|
| Narrow predicate and constant (S-01) | Every surface switches density at the same terminal width; no surface caches density; all UI state survives a switch, except an open overlay's width (NS-09). |
| Margin helper (S-02) | No site assumes symmetric margins; each site has a mouse-offset test; wide margins are unchanged. |
| Glyph lane | Body text starts at the same column in every transcript block. |
| Stamp | No wrapped line loses width to the stamp; never on the first line of a multi-line message. |
| State-glyph table (S-04, slice 2) | One table; same glyph for the same state in every component; wide glyphs unchanged; label "Subagents" unchanged. |
| Duration formatter (S-05, slice 1) | One format across the stream, cards, status row, subagents box and Fleet view at every width. |
| `spread` | Kept where left/right layout stays; never truncates an action; identifiers end with `…`. |
| `RuntimeNoticeCard` (S-06) | The `›` affordance and the `→` action are never dropped narrow; wide output is unchanged. |
| Shared menu module (S-07) | Square corners; hints `Key action` by priority narrow; Pi selectors change only by inheritance. |
| Editor margin | Rounded frame; caption without provider narrow. |
| Compact tool rows | Glyph stays `◆`; colour from the shared scale. |
| Subagents box | Heading pattern `▾ Subagents …`; no heading or rows when empty; 8-row cap with `… N more · Alt+A`. |
| Todo | Same heading pattern; no blank rows; Alt+Shift+T still collapses; heading is the collapse target; no heading or rows when empty; pagination kept. |
| Operator question | ADR 0019 placement, width, rounded input frame and height unchanged; hints show in one place only narrow. |
| Header | Byte-identical to today at every width (S-03). |
| Wide layout | Byte-identical to today at 60 columns and above except durations. |

## Testing decisions

Tests assert observable rendered output and mouse routing at the highest useful existing seams, follow `node --test test/*.test.mjs`, and use the helpers listed in `test/support/README.md`. Rendering tests strip terminal sequences and measure with `visibleWidth`, as existing Chrome tests do. Wide regression tests render each touched surface at 60 and 100 columns and compare with today's output.

- Narrow predicate: tests set the terminal column count through the predicate's interface and render components at a different given width (43 in a 44-column terminal; 59 in a 60-column terminal) to prove only terminal columns decide. Boundary at 59 and 60.
- Transcript (slice 1), through the Chrome and message patches as `test/chrome-messages.test.mjs` does today: assistant wrap width 40 at 44; user message background, padding and text column; each stamp placement, including a streamed message whose placement changes between renders; thinking rail; tool and group rows in the lane; status-row spinner in the lane.
- Mouse offsets (slice 1): one test per S-02 site sending a click to a rendered cell and asserting the content receives the matching local coordinate, and a margin-cell click is not delivered as content; the chat group header and row clamp through `patchChat`.
- Durations (slice 1): table tests for the formatter at `3.2s`, the 10 s boundary, whole seconds, `1m 05s`, `1h 05m`, at narrow and wide widths, and equality of `formatDuration` and `childElapsed` for the same elapsed time; the existing `test/chrome.test.mjs` duration table updates.
- Cards (slice 1): `test/context-backstop-card.test.mjs`, `test/exploration-budget-card.test.mjs`, `test/child-result-card.test.mjs`, `test/advisor-card.test.mjs` render narrow and wide; `›` present, action never cut, advisor status line only when present.
- Overlays (slice 1): the config guide through `driveConfig` and `click` from `test/support/config-guide.mjs`; the model picker with `catalog` and `lines` from `test/support/model-picker.mjs`; model profiles, settings and Fleet view through their existing test files; full width with padding `1` at 44 and 48–59; tall modal scrolling with pinned hints.
- Resize (slice 1): render the same component instance wide, narrow and wide again after expanding a block, moving a selection, scrolling and focusing; assert each state survives. An open overlay keeps its opening layout (accepted risk) and a reopened one lays out again.
- Docked widgets (slices 1 and 2): `renderChildrenBox` and `renderTodoBox` directly, as their tests do today; heading collapse hit target and Alt+Shift+T through the Todo extension; capacity at the existing height boundaries.
- Coherence (slice 2): glyph table consumers; `visibleWidth` of every glyph in the scale equals 1; hint rows and Pi selector inheritance in `test/chrome-menus.test.mjs`; footer orders and the operator question footer hiding through the footer-hints seam in `test/ask-user-panel.test.mjs` and `test/chrome.test.mjs`; editor caption and placeholder in `test/chrome-editor.test.mjs`.
- Markdown (slice 3): narrow and wide renders of lists and code blocks through the message patch; patch apply, re-apply and restore through the existing patch tests.
- Real Pi sessions use `realParent` or `parentSession` from `test/support/workflow-parent.mjs` only where a seam cannot be exercised directly; polling uses `eventually`.
- Manual: the device check gating slice 2; owner visual review of streaming stamp behaviour before the feature closes. These are not automated and are not claimed by this specification.
- Gate: `npm run check` on each implementation head. Mutation testing is unsupported by repository policy and is not a blocker.

## Out of scope

- Touch support for the operator question panel (it has no mouse handler today); a separate behavioural change.
- Markdown tables.
- The header (NS-25).
- Surfaces not laid out yet. They follow the shared rules when built or touched, but this feature does not define them: the Fleet view detail, the model catalog, the slash menu, the config Review screen, the expanded subagent card (`⌄`), and the layout of the collapsed Todo state (its collapse action is in scope under NS-28).
- Pi selectors and `SelectList` beyond inheritance of the shared menu patch.
- Any reflow of overlays open across a resize (NS-09).
- Renaming "Subagents" or changing glossary terminology (routed to `domain-modeling`).

## Prototype decisions

- Artifact: `prototype/narrow-screens/index.html`, with real "before" renders in `renders-before-7fad399.txt`.
- Disposition: reference-only, contract v1, every component approved by the owner on 2026-11-21 with variants narrow margin `0` and floating stamp and the user message in its second version. It is evidence, not an implementation base; renders are a per-cell simulation and some panes are derived from code.
- Superseded points (the contract's note, brief wins): header out of scope (B3); stamp at the end of the last line or its own row, never the first line of a multi-line message (S3); backstop and budget `›` and advisor status line (B2); Pi selectors in scope by inheritance (W8); footer hides hints while the operator question is open (W5); Todo heading collapses and `n/m` is done over total (W4); durations `1m 05s` at every width with the full rule of NS-07 (B1). The contract's wide panes that show coherence changes are superseded by D-open-1.

## Approved deviations

- The operator question below 60 columns supersedes the `❯` cursor and right-hand descriptions of `prototype/operator-question/approved-questions-v2.md`, and shows its own hints inside the panel while the footer hides its hints. Recorded by [ADR 0031](../adr/0031-operator-question-on-narrow-screens.md), owner-approved 2026-11-21, which amends [ADR 0019](../adr/0019-operator-question-docks-at-the-bottom.md) for the look and key hints below the threshold; placement, width, frame and height stay as ADR 0019 decides. At 60 columns and above ADR 0019 and `approved-questions-v2.md` stay the approved look.

## Risks, accepted risks and gaps

- Accepted risk (W9): an overlay open during a resize across 60 columns does not reflow; it keeps the layout it opened with until reopened. Accepted by the owner on 2026-11-21: rare, and reopening fixes it.
- Risk: the stamp can move from the end of the last line to its own row while a message streams. Mitigation: render tests per placement and owner review of streaming.
- Risk: a Pi upgrade can break the patches, now including the Markdown patch (ADR 0007 has no version guard). Mitigation: source notes and re-verification on every upgrade.
- Risk: glyph fallback widths under iOS fonts can misalign the lane. Mitigation: `visibleWidth` tests and the slice 2 device check.
- Gap: the real `tput cols; tput lines` on the iPhone is not measured; it is the slice 2 exit criterion.
- Gap for `domain-modeling` (W6): "Subagents" versus glossary Child session; Run state versus Task state naming per glyph-table row.
- Admissible gap: no Domain Authority Handoff; `GLOSSARY.md` is the root authority.
- Justified complexity: two layouts per component (narrow and wide), from D-open-1.

## Dependencies and native relationships

- Slice order: 1, then 2 (after the device check), then 3. Slice 2 and slice 3 do not depend on each other's behaviour; both depend on slice 1's narrow predicate and margin helper.
- ADR 0007: slice 3 Markdown patch.
- ADR 0019 as amended by ADR 0031: slice 2 operator question and footer.
- `docs/features/header-identity.md`: unchanged authority for the header.
- `docs/specs/bounded-todo.md`: the Todo's paging, filter, compact line, row budget and hit-geometry contract stay in force. Below 60 columns NS-28 supersedes only its frame rows, blank margin rows and `×` collapse target: the heading becomes the collapse target and capacity is recomputed without frame rows, within the same row budget. At 60 columns and above the bounded-todo layout is unchanged.
- Pi peer range `>=1.6.0`; installed 1.6.0 at inspection.

## Source evidence

Inspected on the working tree at `main` commit `7fad399`, the same commit as the "before" renders, so the renders describe the current `extensions/` code. The feature review's evidence gap ("whether `extensions/` changed between `7fad399` and HEAD `42f760d`") is closed: `42f760d` is an ancestor of `7fad399`, and `extensions/` at the inspected head equals `7fad399`. Sources read: `extensions/chrome-messages.ts`, `chrome-groups.ts`, `chrome-menus.ts`, `chrome-editor.ts`, `chrome.ts`, `visual-language.ts`, `child-projection.ts`, `compact-tools.ts`, `children-box.ts`, `children-view.ts`, `todo-header.ts`, `ask-user-panel.ts`, `runtime-notice-card.ts`, `context-backstop-card.ts`, `exploration-budget-card.ts`, `child-result-card.ts`, `advisor-card.ts`, `model-profiles-editor.ts`, `configure-guide.ts`, `model-picker.ts`; Pi `@earendil-works/pi-tui` 1.6.0 terminal and Markdown declarations. No runtime, device or implementation validation is claimed here.

## Feature-critic report

[`docs/features/narrow-screens-review.md`](../features/narrow-screens-review.md): package `narrow-screens/definition-1`, lenses L1–L3, verdict READY WITH WARNINGS (final check 2026-11-21). W9 carries `risk accepted`; W6 terminology is an evidence gap routed to `domain-modeling`; every other finding is corrected and closed. The consolidated specification review is [`narrow-screens-review.md`](narrow-screens-review.md).
