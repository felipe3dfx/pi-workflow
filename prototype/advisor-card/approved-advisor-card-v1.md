# Approved prototype: advisor card v1

Feature: `docs/features/advisor.md` in the main checkout `/home/felipe3dfx/Work/pi-workflow` (definition package `advisor/definition-1`; not on this branch, nor are ADR 0030 and the GLOSSARY `Advisor` entry). Labels avoid the glossary's `_Avoid_` terms (executor, reviewer, verifier).

Recommended disposition: reference-only
User-confirmed disposition: reference-only. The user approved this contract on 2026-11-20. It is evidence, not an implementation base.
Approved Prototype UI Contract: v1 (this file).

## Question and success criterion

Question: what does the `advisor` tool result look like and do in the message stream so it reads well, belongs to the child↔parent card family, and is clearly not a child conversation?

Success criterion: deterministic plain and ANSI text snapshots of every state at widths 60, 100 and 140, rendered with the real pi-tui and pi-coding-agent components and the `pi-workflow` theme.

Fidelity: real `ToolExecutionComponent` host, real Markdown, real theme, real family cards and transcript cursor; a temporary card component and injected results (see `MOCKS.md`).

## Verdict

Answered. The card works as a self-rendered tool result in the family's frame. Its header names the author (`Advisor`), and the hollow `◇` glyph and accent color set it apart from the `◆` Subagent and Parent cards. Two findings change the starting direction. First, `Parent → Advisor` is dropped, because the family header names whoever wrote the body. Second, the `◇` glyph needs a one-line `chrome-groups` change, or the transcript cursor loses it.

Evidence: `snapshots.txt` and `snapshots.ansi.txt` hold 31 states × 3 widths. The script asserts five things:

- every line fits its width for widths 8 to 160;
- each card has exactly one header;
- nothing renders before the first update;
- a click and the transcript cursor toggle each expand only the advisor row;
- the cursor changes the advisor line's ANSI.

Chalk is pinned to level 3, so bold is emitted. A piped run and a pty run (`script -qc`, `TERM=dumb NO_COLOR=1`) produce byte-identical ANSI.

## Proposed contract

### Component and host

- C0. The card is hosted through the real resolver chain (`compactToolRenderers`). Because the definition has its own `renderCall`, the resolver returns it unchanged: there is no `View` wrap and no `┃` bar.
- C1. The `advisor` tool renders with `renderShell: "self"`; `renderCall` returns the shared `hidden` component, so the card appears only once a result (partial or final) exists, and its header appears exactly once in every phase.
- C2. The card uses the family frame: `edgeFor(assistantInset)` margin, a header line, and the body indented 2 columns. The expand hint sits at the right of the header via `spread` when it fits.
- C3. Expansion is Pi's per-row tool expansion (`ToolExecutionComponent.expanded`), not a card-owned `opened` map, and `markCard` is not used.
  - `ctrl+o` (`app.tools.expand`) toggles every tool row.
  - A left click on the header row toggles this row through Pi's `MouseRegion` (state 22).
  - The transcript cursor toggle does the same (state 27).
  - In the stream, `chrome-groups` `rows()` lets body clicks on an open tool row pass through, so only a click on the header collapses an open card.
  - `chrome-groups` reads `tool.expanded`, so grouping and gaps follow the card. When open, the card gets blank gaps above and below (state 27).
  - A running row is already clickable, because Pi checks only that a result exists. The click flips `expanded`, and nothing visible changes until the advice arrives (state 28).
- C4. The `execute` contract the card relies on: `onUpdate` fires once before the model call with `details: { model, thinking }`, using the configured `provider/id` and level captured at call time. The final result repeats those `details`. A failure returns `isError: true` with `details.failure` set to `unavailable`, `thinking`, `provider`, `overflow` or `aborted`. A refusal returns `details.failure: "refused"` and is not an error, as CodeGraph's refusal is not. The card also stores `model` and `thinking` from the partial in `context.state`, so a thrown error that loses `details` still shows the model (state 18).

### Header

`<glyph> Advisor[ <state word>]  <elapsed> · <model> (<thinking>)        (<key> to expand|collapse)`

- H1. Label `Advisor`, bold muted, in the same style as `Subagent` and `Parent`. There is no `Parent →` prefix and no id, because one global advisor needs no id.
- H2. Glyph `◇`. Its color carries state, as `tone()` does in the family: running cyan (the `cyan` var, as compact tools use for a running row), done accent (lavender), failed error, stopped dim, refused dim.
- H3. State words: `consulting…` (cyan) while running, none when done, `failed` (error), `stopped` (dim), `refused` (warning).
- H4. Meta (dim) puts elapsed first, then the model. Elapsed comes from Pi's `durationMs` and uses `childElapsed` format (`42s`, `1m 15s`, `1h 02m`). It is absent while running, because no timer ticks in the stream. Pi's working indicator already shows live time.
- H5. The model always shows, collapsed too. Here the card departs from `ResultCard`, which shows the model only when open, because the advisor has no role or id to identify it. The model uses `childModelLine`, which drops the first provider segment and adds ` (thinking)`.
- H6. Truncation priority at narrow widths: glyph, label and state word come first, then elapsed, then the model, then the hint. The model id is shortened with a middle `…`, at a minimum of 10 columns, and keeps ` (thinking)` (states 15 and 16 at width 60). The hint drops from the header when it does not fit. The header is then truncated to the width as a last resort.
- H7. The model, thinking level and advice pass through `terminalSafeLine`/`terminalSafeBlock` (state 17).

### States

| # | State | Header | Body | Hint |
| --- | --- | --- | --- | --- |
| S0 | Call issued, no update yet | nothing (state 00) | none | none |
| S1 | Running (partial) | `◇ Advisor consulting…  <model> (<thinking>)` | none | none |
| S2 | Running, partial without details | `◇ Advisor consulting…` | none | none |
| S3 | Done, collapsed | `◇ Advisor  <elapsed> · <model>` | first 3 rendered Markdown lines, then dim `… N more lines`, where N counts rendered lines at that width | `(ctrl+o to expand)` on the header. When it does not fit there, it goes at the end of the `… N more lines` row |
| S4 | Done, expanded | same | full Markdown: headings, lists, inline code, fenced code | `(ctrl+o to collapse)` when it fits |
| S5 | Done, short (≤ 4 rendered lines) | same | whole advice | none, collapsed or expanded, since nothing is hidden (05, 05b) |
| S6 | Done, empty | same | dim `The advisor returned no advice.` | none, collapsed or expanded (06, 06b) |
| S7 | Failed | `◇ Advisor failed  <elapsed> · <model>` | the reason, wrapped, in error color, always visible (as a failed `ResultCard` shows its reason collapsed) | none |
| S8 | Stopped (operator Esc) | `◇ Advisor stopped …` dim | dim `Advisor consultation stopped by the operator.` | none |
| S9 | Refused (race only) | `◇ Advisor refused …` | dim refusal text | none |
| S10 | Fallback (advisor capability unseated) | plain `Text`, glyph removed (`paintCard` behavior) | collapsed: the first 3 raw lines and `… N more lines`; expanded: the raw advice | none |

Path mapping:

- Loading: S0 and S1–S2.
- Empty: S6.
- Error: S7 and S8.
- Disabled: S9, plus S10 for past cards.
- Happy path: S3–S5.
- Invalid: missing details (19), hostile input (17), thrown error without details (18).
- Navigation: expand and collapse through the key, a click, or the cursor (C3).
- Not applicable: filters, forms, and modals. The card has no inputs; choosing the model belongs to `/workflow:advisor`.

Failure texts (S7, S9), worded after `child-launcher.ts` `profilePair` and brief scenario 5:

- `The advisor model <provider/id> is not available in Pi. Choose another with /workflow:advisor.`
- `The advisor model <provider/id> does not support thinking <level>. Choose another level with /workflow:advisor.`
- Provider or auth: the provider's message, verbatim through `terminalSafeBlock`.
- `The parent context (<n> tokens) exceeds the advisor model's window (<m> tokens). Choose a larger advisor model with /workflow:advisor.`
- `Advisor consultation stopped by the operator.`
- `Advisor is disabled. Enable it in /workflow:config.` / `No advisor model is set. Choose one with /workflow:advisor.`

### Seating

- P1. The card paints rich only while the advisor capability is seated in the message stream (`seated("advisor", "message-stream")`), not `child-session`. Three reasons. The advisor has no dependency on child-session, since D7 was withdrawn by D2b. The brief gives the capability its own message-stream place, like CodeGraph. And an operator may unseat subagents while keeping the advisor. Results outlive unseating, so old cards fall back to plain text (S10) when the advisor is unseated, which is the family's `paintCard` behavior.

### Family and distinction (states 23 to 27)

- F1. Same family: same margin, indent, bold-muted label, glyph-then-label header, dim meta, Markdown body, error treatment, and expand key wording.
- F2. Distinct from a child conversation: the label is `Advisor`, not `Subagent <role> <id>` or `Parent → <id>`; there is no id, no Verdict, no question number, and no `alt+a open in subagents view`; the glyph is hollow `◇` in accent, not solid `◆` in `toolTitle` olive; and the body is previewed when collapsed.
- F3. Required change: `chrome-groups.ts` `pointAt` matches `/[◆◈]/`, so the transcript cursor and hover `▸` never mark a `◇` head (state 25 shows none; state 26 shows `▸` with `◆`). Either widen the pattern to `/[◆◇◈]/` or adopt the solid `◆` variant in accent. Recommended: widen the pattern. That is one regex, and the hollow glyph is the cheapest identity cue that does not depend on color.
- F4. Read from code, not observed: `toolKind("advisor")` resolves to `tool`, which `folding` leaves out. A collapsed advisor card is therefore never folded into a `◈ Read N files` group, and it breaks a group as a Subagent result card does.

### Invalid paths

- Missing `details` gives no meta (state 19). A hostile model id or advice is neutralised (state 17). A partial carrying no details still renders (state 2). No line exceeds its width from 8 to 160 columns.

## Confirmed and contradicted brief decisions

- Confirmed: A4, that the answer renders as an ordinary tool result in the message stream, as a self-rendered tool card. D5 and scenario 9: every failure reason has a readable, non-blocking card. Scenario 5's refusal wording is reused for the race refusal. D8: the overflow card names `choose a larger advisor model`.
- Contradicted (starting direction, not the brief): the header `◇ Parent → Advisor · <model> · <thinking>` is replaced by `◇ Advisor …` (H1). A live elapsed while running is not proposed (H4). The `withdrawn` state is reachable only as a race, because by scenarios 6 and 7 a withdrawn or model-less tool is not offered (S9). The card depends on the advisor capability, not child-session (P1).

## Discovered behavior and questions

- Q1. Collapsed preview (S3) departs from the family, where a collapsed `ResultCard` is a single row. Keep a 3-line preview, or show the header row only?
- Q2. Should empty advice be a done card (S6) or an error the parent sees as a failure?
- Q3. Is the abort reported by `execute` (with `details.failure: "aborted"`)? Or does Pi's own `Operation aborted` arrive first without details? In that case the card shows `failed` with the model kept from `context.state`.
- Q4. Should the done glyph use accent? `accent` is lavender, which is also the theme's `syntaxKeyword` and cursor `▸` color.
- Q5. Should the model always show (H5) or only when open (family)?
- Q6. Should `advisor` be a `harnessMessage`, like `reply_child`? Harness messages are exempt from action authorization (`pi-workflow.ts` `messages`). The advisor sends the parent's context to a provider, so that is an authorization decision, not a UI one.
- D-a. Pi's Markdown re-wraps a long fenced code line at width 60 and breaks the code block's indentation (state 04). That is Pi's renderer, outside the card.
- D-b. `terminalSafeLine` removes the ESC byte but leaves `[31m` visible (state 17). That is existing harness behavior.

## User answers (2026-11-20)

- Q1: keep the 3-line collapsed preview.
- Q2: empty advice is an error: "The advisor returned no advice."
- Q3: `execute` reports the abort with its own wording and `details.failure: "aborted"`, as in state 12.
- Q4: the done glyph uses `accent`, as proposed.
- Q5: the model always shows (H5).
- Q6: open; it is an authorization decision for the specification.
- F3: the `chrome-groups.ts` `pointAt` change is in scope so the cursor recognizes `◇`.

## Unresolved contradictions

Resolved by the user answers above, except Q6.


## Risks and deviations

- R1. The `◇` identity needs the `pointAt` change (F3). Without it, keyboard navigation looks broken on advisor cards.
- R2. C4 makes `execute` responsible for an immediate partial update. Without it, nothing shows until the advice returns, because `renderCall` is hidden (state 00 renders zero lines).
- R3. Global `ctrl+o` expands every tool row, so long advice expands with them. That is consistent with tools, but it is noisy.
- Deviation: `knip` flags the prototype files as unused, so `npm run check` fails while `prototype/advisor-card/` exists. Root config was not edited.

## Proposed brief delta

- Scenario 8 gains: "While the advisor runs, a card `◇ Advisor consulting… <model> (<thinking>)` shows in the message stream. The finished card previews the first lines of the advice and expands with Pi's tool expand key or a click."
- Scenario 9 gains: "Each failure shows as a failed (or, for an operator abort, stopped) advisor card with the reason under the header."
- A4 becomes a decision: "The advisor result is a self-rendered tool card that depends on the advisor capability's message-stream seat; unseated, past cards fall back to plain text."
- Shared capabilities gains: "`extensions/chrome-groups.ts` (`pointAt`): the cursor marker recognizes the advisor glyph."
- Out stays unchanged.
