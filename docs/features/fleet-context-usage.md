# Feature brief: Context usage in the Fleet view's child detail

Status: Functional definition approved; independent feature critique READY.
Definition package: `fleet-context-usage/definition-2`.

## Problem and outcome

The operator needs to see the selected child session's context occupancy
and model context-window capacity without leaving its Fleet detail.
Cumulative token expenditure is not context occupancy.

Business intent owner: the developer, through this feature-discovery
conversation. Canonical terminology comes from GLOSSARY.md.

## Approved scope and layout

Add one fixed row below the model/cumulative-usage metadata and above the
task in the Fleet detail header. It stays visible while the transcript
scrolls. Keep the Fleet list and the main Chrome header unchanged.

```text
worker-1                           running · 1m32s
gpt-5 · 180.0k tok · $0.42
ctx [####----] 50% · 100K / 200K
Implement form validation
------------------------------------------------
Prompt
> Review the fields and add validation...

Thread
Reading files...
```

The example uses ASCII only for the proposal. The shipped presentation
reuses the main meter's eight filled/empty cells and theme colors.

- Show the selected child's occupancy, not the parent's.
- Show percentage and occupied/capacity counts.
- Preserve cumulative expenditure and cost as separate metadata.
- Use the main header's calculation: round occupied/capacity × 100 to
  obtain the displayed percentage; apply warning from 75% and error from
  95% to that rounded value. Round percentage/100 × 8 for filled cells,
  bounded to 0–8; the displayed percentage itself is not capped at 100%.
- When width is limited, remove the meter before percentage and counts:
  `ctx 50% · 100K / 200K`.
- With known capacity but no occupancy measurement, show
  `ctx ? · 200K`, without a meter or a fabricated zero.
- Retain the latest valid measurement after the child ends and when
  reopening its history, labeled `last`:
  `ctx [####----] 50% · 100K / 200K · last`.
  Known capacity with unknown occupancy is also retained as
  `ctx ? · 200K · last`, never replaced with an earlier percentage.
- Old records without a measurement show `ctx unavailable`; never
  reconstruct occupancy from cumulative token expenditure.
- Refresh when the child starts, completes an assistant response, or
  compacts its context. Do not animate occupancy token by token.
- A confirmed successful compaction immediately invalidates the prior
  occupancy, without waiting for a measurement request to succeed. Show
  `ctx ? · 200K` when capacity is known, otherwise `ctx unavailable`, until
  a post-compaction measurement supplies the current state. Discard late
  readings from before that compaction; they cannot restore the old value.
  Failed or aborted compaction alone does not invalidate the measurement.
- During a pending or failed refresh, any retained valid reading is labeled
  `last`; with no valid reading, show `ctx unavailable`. This rule never
  overrides successful-compaction invalidation. A successful post-compaction
  reading with null occupancy remains unknown, not zero.
- In incomplete history, show a retained reading only when available
  evidence identifies it as valid for the latest recoverable context;
  otherwise show `ctx unavailable`. `last` means a retained valid reading,
  not a claim that missing or damaged evidence was recovered. Do not
  reconstruct occupancy or capacity from cumulative usage or a current
  model lookup.
- Queued children and children with unknown capacity show `ctx unavailable`.
- If removing the bar is insufficient, remove the absolute counts next,
  preserving percentage and `last` while they fit, then truncate the row.
  Never overflow. This same final clipping applies to unknown/unavailable
  forms; no additional width variants are required.
- Keep the existing header clipping at extreme terminal heights, rather
  than redesigning the layout. Fixed visibility during transcript scrolling
  applies when there is room for the header; it is not a guarantee that
  every header row fits at every terminal height.

```text
ctx [####----] 50% · 100K / 200K · last
ctx 50% · 100K / 200K · last
ctx 50% · last
```

## Decisions and open questions

| ID | Decision | Resolver and source | Status | Supersession |
| --- | --- | --- | --- | --- |
| D1 | Fixed row below model metadata and above task | Developer: explicit acceptance of the ASCII proposal in this conversation | Accepted | None |
| D2 | Reuse main eight-cell meter and colors; add occupied/capacity counts in detail | Developer: same acceptance | Accepted | None; the main header's no-absolute-count decision stays scoped to that header |
| D3 | Compact presentation removes bar first; unknown occupancy is not zero | Developer: same acceptance | Accepted | None |
| D4 | Leave list and main header unchanged | Developer: same acceptance | Accepted | None |
| D5 | Retain the last available measurement for ended children and reopened history, labeled `last`; old records without a measurement show `ctx unavailable` | Developer: explicit `Si` accepting the lifecycle proposal in this conversation | Accepted | Closes O1 |
| D6 | Refresh on start, completed response and compaction, not token by token | Developer: explicit `Si` accepting the final edge-case preview and critique handoff | Accepted | None |
| D7 | Post-compaction unknown occupancy replaces the previous percentage; failed refresh retains latest available reading labeled `last`, or unavailable if none | Developer: same final-preview acceptance | Accepted | Extends D5 to failed live refreshes; does not override compaction invalidation |
| D8 | Queued children and unknown capacity show `ctx unavailable` | Developer: same final-preview acceptance | Accepted | None |
| D9 | Remove bar, then counts as width shrinks; preserve percentage and `last` while they fit, without overflow | Developer: same final-preview acceptance | Accepted | Extends D3 below its compact-count layout |
| D10 | After removing bar and counts, truncate; preserve existing vertical header clipping at extreme heights instead of a special layout | Developer: explicit `Si` accepting the separate R3/R6 simplification preview | Accepted | Extends D9 with final clipping; bounds D1 visibility by available header space |
| D11 | Keep three refresh triggers, one `last` label and no reconstruction of old records | Developer: same simplification-preview acceptance | Accepted | Reaffirms D5–D8, without adding triggers or migration |
| D12 | Successful compaction immediately invalidates prior occupancy, and late pre-compaction readings cannot restore it; failed/aborted compaction alone does not invalidate | Developer: explicit `Si` accepting the final trust-rule preview and rerun of critique | Accepted | Refines D7: invalidation has priority over retained-read fallback, not conditional on a successful refresh |
| D13 | Pending/failed queries label retained valid readings `last`; ended unknown occupancy is retained as `ctx ? · capacity · last` | Developer: same trust-rule acceptance | Accepted | Extends D5/D7 to pending reads and explicitly composes unknown occupancy with `last` |
| D14 | Incomplete history displays a retained reading only with evidence of validity, otherwise unavailable | Developer: same trust-rule acceptance | Accepted | Bounds D5 retention by recoverable evidence, without reconstructing missing data |

No material functional questions or unanswered assumptions remain in the
approved definition. The developer disposed the critique findings through
explicit scope and trust-rule deltas. Three independent lenses reverified
those corrections; the consolidated report records READY. The RPC query and audit summary are feasibility candidates,
not selected implementation requirements. Transport, storage format,
scheduling, race handling, and runtime validation belong to technical
synthesis and implementation; they are not new product choices.

## Shared capabilities and invariants

- `extensions/chrome.ts`: context meter, compact token formatting, color
  thresholds, rounding and bounded cell count are the comparison behavior.
  Percentages may exceed 100%; the meter itself has at most eight cells.
- `extensions/children-view.ts`: `header` is outside transcript scrolling;
  `spent` sums cumulative expenditure and is not an occupancy source.
- `extensions/child-handle.ts`: the current child interface exposes entries
  but no context-usage measurement.
- `extensions/rpc-child.ts`: each child runs in its own RPC process; any
  measurement must belong to that child rather than the parent's context.
- Preserve selected-child identity and existing transcript navigation.

## Authority and evidence

- GLOSSARY.md: Fleet view, Child session, Run state, Chrome.
- docs/features/header-identity.md: approved main meter behavior.
- docs/adr/0007-patch-pi-tui-internals-for-chrome.md: Chrome ownership.
- docs/adr/0023-children-run-as-rpc-processes.md: current execution model.
- docs/adr/0026-fleet-transcript-residency-per-item.md: bounded transcript
  residency; the context row does not change transcript retention.
- docs/features/fleet-transcript-history.md: history intent only; its older
  in-process/reload statements do not override ADR 0023.

No feature-specific generated Domain Authority Handoff or authority review
was identified. These are admissible generated-artifact gaps, not requests
to change canon.
No canonical terminology change or layout-policy repair is proposed.

## Dependencies, risks and evidence gaps

Read-only inspection of Pi 1.4.0 package source establishes a viable
measurement path: RPC `get_session_stats` returns `contextUsage` from the
same `getContextUsage()` function used by the parent header. The existing
RPC request mechanism and audit evidence/closing summaries are candidate
acquisition and persistence seams, not a selected technical design.

Source references: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js`
(`getSessionStats`, `getContextUsage`) and `dist/modes/rpc/rpc-mode.js`
(`get_session_stats`); `extensions/child-audit.ts` (`Evidence`, `execution`,
`seal`, `tailOf`, `Listed`). The package source and installed binary have
version 1.4.0; binary equivalence and runtime behavior were not tested.
Stats latency, update races, persistence reader compatibility, and model
changes without explicit events remain implementation validation needs.
The specification must account for query completion, failure or lack of
response and propagate changed readings to the view without waiting for an
unrelated child event. Pending/failed states must obey D12/D13, including
when the child dies. Historical recovery must obey D14 under capture loss
or an unsealed record. These are consequences of approved behavior, not
new visual states or selected timeout/storage mechanisms.

After compaction, Pi may report known capacity with null occupancy until
a valid assistant response. This differs from a failed measurement request.
A queued child has no process and therefore no measured occupancy.
Cumulative token totals must never substitute for occupancy. Avoid implying
that an unavailable measurement is zero or that an old measurement
describes a later context. Historical retention is approved, but its
implementation must not fabricate unavailable historical measurements.

No prototype findings exist for this feature. No UX prototype is currently
recommended: the accepted ASCII proposal resolves placement. A focused
technical probe may be appropriate if measurement discovery leaves a
functional uncertainty.

## Review readiness and boundaries

The developer accepted the initial ASCII layout, lifecycle proposal, final
edge-case delta, scope simplifications, and trust-rule corrections. The
first critique used three independent read-only lenses: need and coherence,
scope and proportionality, and feasibility and transversal coherence.
Findings and dispositions are in `docs/features/fleet-context-usage-review.md`.
All three lenses reverified definition-2 on the same frozen capture and
closed the corrected findings. A duplicate warning was withdrawn by its
lens, while existing synthesis obligations remain recorded in the report.
The result is READY, without accepted residual warnings. The report records
the reviewed hashes; only editorial review-state updates followed that
capture. No functional behavior changed after reverification.

No prototype or Approved Prototype UI Contract exists for this feature;
none is required by the current source-level evidence. No deviations or
accepted risks are claimed. Runtime validation needs are recorded above,
not presented as completed tests or accepted risks. Technical synthesis
belongs to `to-spec`. This brief does not authorize production implementation,
commits, pushes, tracker changes, or publication.
