# Workflow config guide

Status: SPECIFIED (#248).

Package: `workflow-config-guide/definition-1`, the approved brief `docs/features/workflow-config-guide.md`.
Review handoff: `workflow-config-guide/feature-review-1`, `docs/features/workflow-config-guide-review.md`, verdict `READY`.
Consolidated report: `docs/specs/workflow-config-guide-review.md`.
Prototype: branch `prototype/configure-ux`, commit `c2c2963`, Approved Prototype UI Contract v4 (`prototype/configure-ux/approved-config-guide-v4.md`), disposition `reference-only`.

## Problem

The `/workflow:config` guide renders every row as a Pi `SettingsList` item, `Label   value`. The operator cannot tell a toggle from a multi-value choice: Delegation mode looks and cycles like an on/off row. One flat list mixes harness capabilities, Jev routing, Delegation mode, and companion expectations without headings. Every capability shares the description "Seat this harness capability". Apply is a row whose value is `review` and opens a hidden submenu whose plan lines look selectable; the final item is `Confirm apply` with value `now`. Nothing marks pending changes, companion state is only visible inside the plan, and the catalog descriptions are never shown.

## Solution

Replace the guide's `SettingsList` with a purpose-built overlay list that keeps every current capability and the same outcome set. The list has three titled sections, a distinct affordance for each control type, a pending-change marker and count, the state and description of each companion, contextual key hints, and an explicit `Review and apply` action that opens a read-only review inside the same overlay. Nothing about what is stored, seated, installed, or aligned changes.

## User stories

1. As the operator, I want each row to look like the control it is, so that I know whether it flips or offers values.
2. As the operator, I want capabilities, routing and delegation, and companions in separate titled sections, so that I know what I am changing.
3. As the operator, I want a description of the focused row, so that I understand each capability, mode, and companion without the documentation.
4. As the operator, I want changed rows marked and counted, so that I know what will change before I apply.
5. As the operator, I want to see how many companions will be installed even when I changed nothing, so that applying never reads as a no-op.
6. As the operator, I want each companion's state in its row, so that I know what is installed, missing, kept, or unreadable.
7. As the operator, I want a visible `Review and apply` action and a summary before confirming, so that I know exactly when and what is applied.
8. As the operator, I want Esc to warn me before discarding pending changes, so that I do not lose them by accident.
9. As the operator, I want the mouse to keep working as today, so that the redesign removes no capability.
10. As the operator, I want a warning when I choose `orchestrator` while Child session is off, so that I know it has no effect yet, without being refused.

## Implementation decisions

Every functional decision below was resolved by the developer during the definition session of 2026-10-14 (status: accepted). Source: the brief, contract v4, and the feature-review report. Structural and testing decisions were added during synthesis without functional change; each is labeled mandatory or a recommendation and cites its source and reason.

### Entry and outcome (unchanged)

- Mandatory: the command entry, its refusals, and the outcome set do not change. `/workflow:config` with arguments, without a TUI, with an unreadable or invalid selection, or with a companion catalog load error reports the error and does not open the guide (`extensions/seating.ts`, `read`; `extensions/pi-workflow.ts`, `workflow:config` handler). On confirmation the handler saves the selection, sets Jev routing and Delegation mode when they changed, seats the selection, and runs setup for the expected companions, as today. Source: brief scope; ADR 0009; review F6.
- Mandatory: closing the guide without confirming writes nothing, applies nothing, and reports no error. Source: ADR 0009.
- Mandatory: the Selection format, `readSelection`, `planApply`, and `describePlan` semantics are unchanged. The install and kept sets shown in the guide are the ones `planApply` computes. Source: brief scope.

### Structure

- One overlay list, not a wizard. Sections in order: `Capabilities` (the six harness capabilities in `capabilities` order), `Routing and delegation` (Jev routing, then Delegation mode), `Companions` (current catalog order). A rule and the `Review and apply` action close the list. Source: ADR 0009; contract v4.
- On open, the draft equals the opened values (with an absent selection file: every capability on and every catalog companion expected), there are no pending changes, and the focus is on the first row, `Child session`. Source: brief, scenario 1; contract v4 evidence, snapshot 1.
- The review is a second screen inside the same overlay, titled `Workflow config › Review`. It is a summary, not a step: it adds no choice. Source: contract v4; review, transversal coherence.

### Rows and controls

- Toggle rows (capabilities, Jev routing, companions) show `[x]` or `[ ]` before the label. Space or Enter flips them.
- The choice row (Delegation mode) shows `‹ value ›` at the right. ← and → move through `opportunistic` and `orchestrator`; Space or Enter advance.
- The action row shows the summary and ends with `›`. Enter opens the review.
- The focused row is marked `▸` and painted with the selected background, as other Chrome menus do.
- A row whose value differs from the opened value ends with `•`. Returning a row to its opened value removes the marker.
- Labels: `Child session`, `Todo`, `Operator questions`, `Model profiles`, `CodeGraph`, `Compact rendering`, `Jev routing`, `Delegation mode`, and each companion's package name.

### Descriptions

- The focused row's description appears below the list. Each capability, Jev routing, and Delegation mode has its own copy; the prototype's copy in `prototype/configure-ux/mocks.ts` is the reference. Delegation mode lists both values, and `orchestrator` reads "the parent is told to delegate all work to child sessions and keep to conversing, planning, asking, and directing children" (Delegation mode specification). Source: review F11.
- The `Review and apply` action's description is "Opens a summary of every change. Nothing is applied until you confirm there." Source: contract v4 (every row has its own description); snapshot 7.
- A companion's description is its catalog `description` followed by "Off stops expecting it; it is never uninstalled." Mandatory: the handler passes the catalog descriptions it already loads (`companionPackages()`) into the guide; today the guide receives only package names. Source: review F7.
- Choosing `orchestrator` while the draft has Child session off adds a warning below the description: "No effect while Child session is off: the parent has no child tools to delegate with." The choice is allowed. Source: Delegation mode specification (no refusal); contract v4.

### Companion state

Each companion row shows, at the right, a state derived from the resolved companion state and the draft expectation:

| Resolved state | Expected | Shown |
|---|---|---|
| installed | on | `installed` |
| installed | off | `installed · kept` |
| missing | on | `will install` |
| missing | off | `not installed` |
| error | either | `unreadable` |

### Summary

- Summary text: `no changes`, `1 change`, or `N changes`, counting rows that differ from the opened values; followed by ` · M to install` when the install set is not empty.
- The action row always shows the summary. The title is `Workflow config · <summary>` when there are changes or installs, otherwise `Workflow config`. When the full title does not fit the frame, the title is the summary alone. Source: review F8, F10.

### Review

- `Changes`: each changed row as `label   from → to`, or "No changes to your selection."
- `Packages`, shown when not empty: `+ Install <package>` for the install set; `! <package> is unreadable (not reinstalled; see /workflow:doctor)` for each companion in error that is still expected; `= Keep <package> installed (not uninstalled)` for the kept set. An unreadable companion that is not expected is not listed. Source: review F3; GLOSSARY, Degraded harness.
- `Always on apply`: "Align MCP servers (mcp.json)", "Apply default Pi settings", "Nothing is uninstalled".
- `▸ Apply now` closes the review. Enter applies.
- When the review does not fit, its body scrolls with ↑/↓ and the wheel and shows a `↑`/`↓ more` indicator; `Apply now` and the hints stay visible. Source: review F4.

### Keys and hints

- ↑/↓ move the focus and wrap. Tab moves the focus to `Review and apply`. PageUp/PageDown scroll an overflowing focused description without moving focus; changing focus resets its scroll position. Source: Owner-approved addition for #248.
- Hints follow the focused control: `Space toggle` on a toggle, `←/→/Space change` on the choice, `Enter review` on the action; always `↑/↓ move` and `Tab go to apply`; `Esc close` without pending changes, `Esc discard changes` with them. An overflowing description adds `PgUp/PgDn description` and a directional `↑`/`↓ more` indicator; neither appears when the description fits. The review shows `Enter apply` and `Esc back to edit`, plus `↑/↓ scroll` when it scrolls. Source: review F9.
- Esc in the review returns to the list with the draft intact and the focus on `Review and apply`. Source: review F4.
- Esc in the list without pending changes closes. With pending changes, the first Esc shows "Discard N changes? Esc again discards and closes; any other key keeps editing."; a second Esc closes without writing; any other key dismisses the warning and keeps editing.

### Mouse

- The wheel moves the focus in the list and scrolls the review.
- A left click on a toggle flips it; on the choice advances it; on `Review and apply` opens the review; on `Apply now` applies.
- A left click on the frame's `[×]` behaves exactly like Esc, including the discard warning and the return from the review. Source: review F1.

### Width and height

- The list keeps the focused row visible when it does not fit the terminal; the description, any warning, and the hints stay below it. At 12 rows × 48 columns, the frame remains bounded and the full focused description is accessible with PageUp/PageDown while the focused row, orchestrator warning, and hints remain visible. Normal-height output is unchanged.
- Every line fits the overlay width; truncation never overflows.

### Structure of the code

- Mandatory: `guideSelection` remains the module the handler calls and keeps returning the confirmed selection, Jev routing, and Delegation mode, or nothing when closed. Its input grows only with the companion descriptions. Reason: the handler applies the outcome set (ADR 0009: one module applies; the guide does not).
- Mandatory: reuse `modalFrame`, `modalMetrics`, `sectionRule`, `selectedRow`, and `hintRows` from `extensions/chrome-menus.ts`; do not change the global `SettingsList` patches (`renderMainList` and the selector wrappers). Source: brief, shared capabilities (chrome-menus reused, `SettingsList` replaced for this guide only); ADR 0009, Shell owns visual language. Reason: the frame, close span, and hints are the visual language other menus share, and every other menu depends on the `SettingsList` patches.
- Recommendation: build the guide as one component inside `extensions/configure-guide.ts`, receiving the theme and keybindings from `ctx.ui.custom`, with its row model private. `prototype/configure-ux/guide.ts` shows one workable shape; it is evidence, not a base to copy.
- Recommendation: derive companion states and the install and kept sets from `planApply` rather than recomputing them in the guide.

### Shared-capability invariants

- `chrome-menus` frame, close span, section rule, selected row, and hint layout are reused unchanged; `model-profiles-editor` keeps working.
- Pi `SettingsList` and its Chrome patches are unchanged for every other menu. Replacing it in this guide is an authorized divergence.
- `[x]`/`[ ]` keep the meaning they have in the operator question panel: a mark that is on or off.
- The command's refusals, the Selection, Jev routing and Delegation mode documents, seating, setup, MCP alignment, and default settings are unchanged.

## Testing decisions

- Mandatory seam: the `/workflow:config` command handler with a fake `ctx.ui.custom`, as `test/workflow-settings.test.mjs` and `test/delegation-mode.test.mjs` do today. The factory must receive a test theme and keybindings; tests drive the panel through `handleInput`, `handleMouse`, and `render`, and observe the rendered lines and the files on disk. Prior art for a theme in tests: `test/model-profiles-editor.test.mjs`. Reason: it is the highest existing seam; it exercises the guide together with the outcome set the handler applies (ADR 0009: tests of apply call the module, not the guide, so the guide's own behavior is observed through the command), and the tests being rewritten already use it.
- Cases: the opened state (defaults with an absent file, no pending changes, focus on `Child session`); the three sections and every label in order; toggle and choice affordances; Space, Enter, ←, → per control type; the `•` marker appearing and disappearing; summary and title with changes, with installs only, and with neither; the title falling back to the summary at a narrow width; the five companion states; companion descriptions read from the real catalog (`assets/companions.json`); the action's description; the orchestrator warning with Child session off and its absence with Child session on; Tab; the review sections, including an unreadable companion expected and not expected; review scrolling at a short height with `Apply now` and hints visible; PageUp/PageDown reaching all focused description copy at 12 × 48 with the orchestrator warning, focused row, hints, and bounded frame; description scroll resetting on focus changes while arrows and wheel still navigate focus; no description scroll hint or indicator when the description fits; Esc from the review keeping the draft and focusing the action; Esc without changes closing; Esc twice with changes closing without writing; another key after the first Esc keeping the draft; mouse wheel, row click, action click, `Apply now` click, and `[×]` with and without pending changes; applying with no changes still running setup; every rendered line within the width.
- The existing tests that look for `Apply` and `Confirm apply` rows are rewritten to the new interaction. Assertions about what is written, seated, and set after confirmation keep their meaning. Source: review F5.
- Unchanged and passing: the command's refusal tests, `readSelection` and `planApply` tests, and the status and doctor tests.

## Out of scope

- A wizard or steps beyond the single review screen.
- A guide screen for a companion catalog load error (review F6).
- Reading a selection that lacks the expectation for a new companion (issue #247); it remains refused as today.
- Changes to Jev routing, Delegation mode semantics, seating, setup, or MCP and settings alignment.
- Other Chrome menus and the global `SettingsList` patches.

## Further notes

- Accepted risk (F5): the guide's interaction tests must be rewritten; the coverage above is the required replacement.
- Native relationship: #247 changes when the guide can open for an older selection; it is independent and can land before or after this specification.
- UI copy stays in English, as in the rest of the harness UI.
- Evidence gap: no Domain Authority Handoff; `GLOSSARY.md` (Configure, Selection, Seating, Companion expectation, Degraded harness) is the root authority, and the change introduces no new domain term.
- ADR 0009 stands: one overlay list, plan before confirmation, no write on close. ADR 0012 stands: `/workflow:config` is the entrypoint.
