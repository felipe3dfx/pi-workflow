# Feature brief: workflow config guide UX

Status: user-confirmed on 2026-10-14. Local working state for feature-review.

## Problem and user

The operator (the person running Pi with this harness) cannot tell, in `/workflow:config`, which rows are toggles and which are multi-value choices, what the menu steps are, or how and when the selection is applied. Source: user request, 2026-10-14.

Evidence of the current guide (`extensions/configure-guide.ts`):

- Every row is a `SettingsList` item rendered `Label   value`; Delegation mode (two values) looks and cycles like an on/off row.
- One flat list mixes 6 capabilities, Jev routing, Delegation mode, and N companion packages with no section headers.
- All capabilities share the description "Seat this harness capability".
- `Apply` is a row whose value is `review`; it opens a hidden submenu whose plan lines look selectable; the final item is `Confirm apply` with value `now`.
- No pending-change marker or count; the hint says `Esc to cancel`.
- Companion state (missing/installed/error) is only visible in the plan; catalog descriptions (`assets/companions.json`) are never shown.

## Desired outcome

The same configuration capability with controls recognizable at a glance, visible pending changes, and an explicit application path.

## Scope

In scope: presentation and interaction of the `/workflow:config` guide only.

Out of scope: the Selection format and validation (`extensions/configure.ts` `readSelection`), the apply plan (`planApply`), the outcome set on confirm (save selection, set Jev routing, set Delegation mode, seat, `workflow.setup`), command arguments, the TUI requirement, refused-selection behavior, other commands.

## Accepted direction

The Approved Prototype UI Contract v3 (`prototype/configure-ux/approved-config-guide-v3.md`, superseding v2 and v1, disposition reference-only) defines the target interaction. Evidence: `prototype/configure-ux/snapshots.txt`, `guide.ts`, `mocks.ts`, `extension.ts`.

## Scenarios, states, actions, errors

1. Open with absent selection file: defaults (all capabilities on, all companions expected), no pending changes, focus on first row.
2. Toggle a capability, Jev routing, or a companion with Space/Enter: row shows `•`, count updates in title and action.
3. Change Delegation mode with ←/→ (Space/Enter advance): same pending marker.
4. Choose `orchestrator` while Child session is off: informational warning, choice allowed.
5. Companion status per row: installed, will install (missing and expected), not installed (missing, not expected), installed · kept (installed, not expected), unreadable (error).
6. Tab moves focus to `Review and apply`; Enter opens review.
7. Review (Esc returns focus to `Review and apply`; body scrolls on short terminals with `Apply now` and hints pinned): Changes (from → to, or "No changes to your selection."), Packages (+ install, ! unreadable with pointer to /workflow:doctor, only while still expected, = kept installed), Always on apply (align MCP servers, apply default Pi settings, nothing is uninstalled). Enter applies the existing outcome set; Esc returns to editing with the draft intact.
8. Esc with no pending changes closes; with pending changes the first Esc asks to discard and the second closes without writing; any other key keeps editing.
9. Applying with no selection changes is allowed (still aligns MCP and default settings), as today.
10. Companion catalog cannot be loaded: unchanged from today; `/workflow:config` reports the load error and does not open the guide (`extensions/seating.ts:29`, `extensions/pi-workflow.ts:288-291`).
11. Mouse: wheel moves focus or scrolls the review; click flips a toggle, advances a choice, opens the review, or applies; `[×]` behaves like Esc.
12. Unreadable/invalid selection, no TUI, or arguments: unchanged from today (error, guide not opened).

## Decisions

| Decision | Resolver | Source | Status |
|---|---|---|---|
| One overlay list with sections, not a wizard | user | conversation 2026-10-14; ADR 0009 | accepted |
| Toggle `[x]`/`[ ]`, choice `‹ value ›`, action `›` affordances | user | prototype contract v1 | accepted |
| Pending marker `•` and change count | user | prototype contract v1 | accepted |
| Inline companion status and catalog description | user | prototype contract v1 | accepted |
| Tab jumps to Review and apply | user | prototype contract v1 | accepted |
| Double Esc to discard pending changes | user | prototype contract v1 | accepted |
| Informational warning for orchestrator with Child session off, no refusal | user | prototype contract v1; docs/specs/delegation-mode.md:102 | accepted |
| Unreadable companion listed in review | user | prototype contract v1 | accepted |
| Disposition reference-only | user | prototype contract v1 | accepted |
| Mouse parity; `[×]` behaves like Esc (F1) | user | feature-review 2026-10-14; contract v2 | accepted |
| Catalog load error shown; review says MCP/settings not aligned (F2) | user | feature-review 2026-10-14; contract v2 | superseded by F6 |
| Revert F2: keep today's catalog-error refusal; no catalog-error screen (F6) | user | second feature-review 2026-10-14; seating.ts:29; contract v3 | accepted |
| `! unreadable` only while expected (F3) | user | feature-review 2026-10-14; GLOSSARY degraded harness; contract v2 | accepted |
| Review scrolls with pinned Apply now and hints; Esc focuses Review and apply (F4) | user | feature-review 2026-10-14; contract v2 | accepted |
| Accept test-migration risk; spec defines coverage (F5) | user | feature-review 2026-10-14 | accepted risk |
| Spec must pass companion catalog descriptions into the guide and test them against the real catalog (F7) | user | second feature-review 2026-10-14; pi-workflow.ts:293-300 | accepted constraint for to-spec |

## Assumptions

- UI copy stays in English like the rest of the harness UI. Status: assumed from repository convention; not asked.

## Shared capabilities

- `extensions/chrome-menus.ts` (`modalFrame`, `sectionRule`, `selectedRow`, `hintRows`, `menuRow`): reused; sibling `extensions/model-profiles-editor.ts` uses the same frame and hints.
- Pi `SettingsList` (patched by chrome-menus `renderMainList`): replaced for this guide.
- Operator question panel (`extensions/ask-user-panel.ts`) uses `[x]`/`[ ]` for marks and `(●)`/`(○)` for single choice.

## Dependencies

ADR 0009 (guided configure), ADR 0012 (command entrypoint), Delegation mode spec and ADR 0015, GLOSSARY terms Configure, Selection, Seating, Companion expectation.

## Risks

- Tests that drive the guide as a `SettingsList` (`test/workflow-settings.test.mjs`, `test/delegation-mode.test.mjs`, `test/configure.test.mjs`) must be rewritten.
- Accepted (F5): the spec must define guide coverage for control-specific keys, Tab, pending count, statuses, review, both Esc paths, mouse, cancel without writes, and apply with no changes.

## Evidence gaps

No generated Domain Authority Handoff exists for this feature (admissible absence).
