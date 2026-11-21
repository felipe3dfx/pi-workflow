# Review: Chrome on narrow screens

Package: `narrow-screens/definition-1` (`docs/features/narrow-screens.md`, `prototype/narrow-screens/approved-narrow-screens-v1.md`, `prototype/narrow-screens/index.html`, `prototype/narrow-screens/renders-before-7fad399.txt`). Lenses: need and coherence (L1), scope and proportionality (L2), feasibility and transversal coherence (L3). Each ran as an independent read-only child on 2026-11-21.

Verdict: READY WITH WARNINGS (final check 2026-11-21). W9 carries `risk accepted` by the owner; W6 terminology is an evidence gap routed to `domain-modeling`; every other finding is corrected and closed.

## Findings

Findings reported by more than one lens are consolidated, classed by the strongest evidence.

| ID | Lens | Class | Severity | Finding | Owner | Disposition |
|---|---|---|---|---|---|---|
| S1 | L2 | substantiated risk | warning | One delivery covers about 20 surfaces and 9 modules, with no slice order. | feature | accepted 2026-11-21 by the owner: three slices (see Adjustments) |
| S2 | L2, L3 | speculative / risk | informative | The Markdown patch has no measured failure. Pi already has a `renderToken` patch (`chrome-messages.ts:741-745`). The list indent is hard-coded in Pi's `renderList`. The code indent is a theme property. | feature | accepted 2026-11-21 by the owner: moved to slice 3 |
| S3 | L2, L1 | substantiated risk | warning | The floating stamp jumps between lines while streaming. | feature | accepted 2026-11-21 by the owner: the stamp always goes at the end of the last line, or on its own row |
| S4 | L2, L1 | substantiated risk | warning | Glyph widths under iOS fallback fonts and the real terminal size are unmeasured. | owner | accepted 2026-11-21 by the owner: device check gates slice 2 |
| B1 | L3, L1 | demonstrated failure | blocker | Duration formatting has two formatters. `childElapsed` (`child-projection.ts:10-25`) already gives `1m 05s` at every width. `formatDuration` (`visual-language.ts:76-84`) gives `1m5s` and takes no width input. The invariant "one format" cannot hold under D-open-1. | feature | corrected 2026-11-21 by owner decision: `1m 05s` at every width, an explicit exception to D-open-1; `formatDuration` adopts the `childElapsed` format and takes no width input; pass 2 (parent, 2026-11-21): one shared formatter, `3.2s` under 10 s, then `12s`, `1m 05s`, `1h 05m` |
| B2 | L3 | demonstrated failure | blocker | `RuntimeNoticeCard` takes a prebuilt `head` string (`runtime-notice-card.ts:29-35`). The backstop has no `→` and appends `advisorStatus` (`context-backstop-card.ts:38-39`). The notice card drops its hint (`:70-73`). | feature | corrected 2026-11-21 by owner decision: below 60 columns both cards use a head (metric plus a `›` affordance that is never dropped), a warning `→` action line that wraps, and the advisor status as a dim line of its own, shown only when present; `RuntimeNoticeCard` receives these parts separately (detail for to-spec) |
| B3 | L3 | demonstrated failure | blocker | The header redesign supersedes the accepted `docs/features/header-identity.md` (path kept, `ctx` bar) without a recorded supersession. The brief names `fixed-header.ts`, but the renderer is `chrome.ts` `renderHeader`. `HeaderData` has no repository root. | feature | corrected 2026-11-21 by owner decision: the header leaves this feature; `header-identity` stays authoritative and its existing degradation already fits 44 columns |
| W1 | L1 | substantiated risk | warning | Resize across 60 columns (device rotation) does not define what UI state must survive. | feature | corrected 2026-11-21 by the owner: crossing 60 columns keeps all UI state (expanded or collapsed, selection, scroll position, focus); only rendering changes |
| W2 | L3 | substantiated risk | warning | The margin is applied in at least six mechanisms, each assuming symmetric `outer - edge*2`: `Framed`, `ThinkingHeader`, `wrapRowRender`/`wrapRowMouse`, `foldChat`, `child-result-card` `frame()`, and `runtime-notice-card`. `advisor-card` relies on the row inset. | to-spec | corrected 2026-11-21 by the owner: one margin helper with separate left and right values used by every listed margin site, with a mouse-offset test per site (detail for to-spec) |
| W3 | L3 | substantiated risk | warning | The 60-column measurement point is undefined. The chat renders at `width-1` only with `scrollbar: always`, while header, editor and overlays get the full width. | feature | corrected 2026-11-21 by the owner: the only signal is terminal columns compared with one named constant (60); right margin `1` applies whether or not the scrollbar is shown |
| W4 | L3 | substantiated risk | warning | Todo without a frame loses the `×` collapse target and changes capacity and hit rows (`todo-header.ts:62-66,128-149`). The meaning of `n/m` is undefined. | feature | corrected 2026-11-21 by the owner: tapping or clicking the `▾ Todo` heading collapses it; Alt+Shift+T still works; `n/m` is done over total; capacity recomputed without frame rows |
| W5 | L1 | substantiated risk | warning | Operator question hints appear both inside the panel and in the footer. | owner | corrected 2026-11-21 by the owner: while the panel is open, the footer hides its hints because the panel shows its own |
| W6 | L1, L3 | substantiated risk | warning | The glyph scale mixes Task state and Run state (`GLOSSARY.md`) and has no shared owner. The maps are copied in `children-box.ts:32-40`, `todo-header.ts:27-33` and `children-view.ts`. | domain-modeling, to-spec | corrected 2026-11-21 by the owner: one state-glyph table in `visual-language.ts` with two mappings (Run state, Task state) sharing glyphs; the terminology part is routed to `domain-modeling`, its owner |
| W7 | L1 | substantiated risk | warning | Empty and overflow states are undefined: empty or long docked lists, modals taller than the screen, and unbreakable tokens wider than the body. | feature | corrected 2026-11-21 by the owner: an empty docked list renders no heading and no rows; modals taller than the screen scroll with hints pinned; unbreakable tokens hard-wrap in bodies and are cut with `…` in heads |
| W8 | L3 | substantiated risk | warning | The shared menu patch (`hintGap`, `swapMarker`, `menuRow` in `chrome-menus.ts`) also restyles Pi selectors, which the brief puts out of scope. | feature | corrected 2026-11-21 by the owner: below 60 columns Pi selectors inherit the shared menu patch changes; recorded in scope by inheritance |
| W9 | L3 | substantiated risk | warning | Overlay options are fixed at open (`configure-guide.ts:677-681`, `model-picker.ts:39-44`). At 44 columns the guide is already full width. The real gap is 48-59 columns, and a resize does not reflow it. | feature | risk accepted 2026-11-21 by the owner: below 60 columns overlays open at full width; an overlay open during a resize does not reflow; reason: rare, and reopening fixes it; source: owner disposition 2026-11-21 |
| W10 | L3 | substantiated risk | warning | Compact tool rows use `◆` for every state, varying only colour (`compact-tools.ts:117-121`). Whether the glyph changes is undefined. | feature | corrected 2026-11-21 by the owner: compact tool rows keep `◆`; only the colour follows the state scale |
| I1 | L1 | informative | informative | The contract's operator-question section still says "pending confirmation" for the 70-column stacking. | feature | corrected 2026-11-21: editorial fix applied to the contract |
| I2 | L2 | informative | informative | Per-component redesigns with no measured failure trace only to the owner's prototype approval. | feature | justified complexity: owner-approved, sequenced in slice 2 |
| N1 | final check | substantiated risk | warning | The brief slice map still said the operator question layout needed the ADR 0019 amendment, pending the owner. | feature | corrected 2026-11-21 (editorial): now cites ADR 0031 |
| N2 | final check | substantiated risk | warning | ADR 0019 lacked the "Amended by" pointer other amended ADRs carry. | feature | corrected 2026-11-21: Status-only line added to ADR 0019, pointing to ADR 0031 |
| N3 | final check | informative | informative | The user-message stamp text and the contract body still mentioned the first line, contrary to S3. | feature | corrected 2026-11-21 (editorial) |

## Adjustments

- Slice 1, width: edge `0` and right margin `1`; the glyph lane; the stamp without per-line reserve; backstop and budget actions on their own wrapping line; the ResultCard keeps its expand affordance; model profiles cut with `…`; the config guide width.
- Slice 2, coherence: state glyphs, hint format and footer order, frame styles, Todo and subagents box, editor, Advisor, Fleet view rows. It is gated on a device check of glyph widths and the real `tput cols; tput lines`.
- Pass 2 (parent, 2026-11-21): the authoritative slice map, including W-finding items, and the slice 2 exit criterion are in the brief's Scope.
- Slice 3, Markdown: list indent and the `▎` code rail, under ADR 0007.
- Stamp rule: the end of the last line if it fits, otherwise its own row; for the user message, the bottom background row.

## Reverification

Pass 1 (2026-11-21): the lenses that reported each finding (B1: L3, L1; B2, B3: L3; W1, W5, W7, I1: L1; W2, W3, W4, W8, W10: L3; W6: L1, L3; S1, S3, S4: L2, L1) reverified the corrections in `docs/features/narrow-screens.md`.

Closed:

- S2, W1, W5 (brief), W7, I1, B2, B3, W2, W3, W4, W6 (seam), W10.
- W9: `risk accepted` by the owner; confirmed closed.

Corrected 2026-11-21 (pass 2), awaiting final check (parent, 2026-11-21):

- S1: the brief Scope carries a slice map assigning every in-scope item to slice 1, 2 or 3; slice 1 has no ADR 0019 or ADR 0007 dependency.
- S3: the stamp goes at the end of the last line if it fits, otherwise on its own row, in every brief section (Scenarios, Decisions, Risks).
- S4: slice 2 unblocks when the owner reports `tput cols; tput lines` from Herdr on the iPhone and confirms `◐ ▸ ▎ ◈ – ✗ ✓ ○ ⠋` each render one column wide.
- W8: Pi selectors and `SelectList` are in scope by inheritance in the brief and in the contract's Superseded points note.
- B1: one formatter for all durations (`3.2s` under 10 s, then `12s`, `1m 05s`, `1h 05m`); `childElapsed` and `formatDuration` share it; existing duration tests update (note for to-spec).
- Contract inconsistencies: the brief's authority clause now says the brief wins for corrections and owner decisions dated after the prototype approval; the contract carries a "Superseded points" note (header B3, stamp S3, backstop and budget B2, Pi selectors W8, footer W5, Todo W4, durations B1) pointing to the brief, without a new contract version.

Residual clarifications applied in pass 2 (parent, 2026-11-21), within closed findings:

- W7: long docked lists keep today's 8-row cap; the subagents tail reads `… N more · Alt+A`; the Todo keeps its pagination.
- W6: the shared table replaces the maps in `children-box.ts` and `todo-header.ts`; `children-view.ts` already consumes `childGlyph`; `⊘` interrupted stays as an extra Run state row. The terminology part stays with `domain-modeling`.
- W4: the Todo control row keeps visible over total; only the heading counter is done over total.
- W2: `chrome-groups.ts:387` added to the margin sites; to-spec checks whether `foldChat` applies a margin.

## Decisions, Deviations, Accepted Risks and Justified Complexity

- Deviation: supersedes the cursor and description layout of `prototype/operator-question/approved-questions-v2.md` below 60 columns. Resolved by ADR 0031 (`docs/adr/0031-operator-question-on-narrow-screens.md`, owner-approved 2026-11-21) amends ADR 0019 for this below 60 columns.
- Accepted risk (W9): an overlay open during a resize across 60 columns does not reflow. Accepted by the owner on 2026-11-21: rare, and reopening fixes it.
- Gap: the term "Subagents" conflicts with the glossary term "Child session". Routed to `domain-modeling`.
- Justified complexity: two layouts per component (below 60 columns, and 60 or more), from D-open-1.
- Evidence gap: the renders were taken on `7fad399`; whether `extensions/` changed between that commit and HEAD `42f760d` was not verified.
