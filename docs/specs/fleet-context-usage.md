# Context usage in the Fleet view's child detail

Status: Specification synthesized from an approved READY definition; not implemented.

Specification identity: `fleet-context-usage/specification-1`.
Definition package: `fleet-context-usage/definition-2`.
Review handoff: `fleet-context-usage/feature-review-2`, identified by
`docs/features/fleet-context-usage-review.md` and its source digest below.
Consolidated report: [fleet-context-usage-review.md](fleet-context-usage-review.md).
Brief: [approved definition](../features/fleet-context-usage.md).
Feature-critic verdict: `READY`, with no open findings or accepted warnings.
Prototype and Approved Prototype UI Contract: none; no prototype is required.

## Problem and solution

The operator can inspect a child session in the Fleet view but cannot see
its context occupancy or model context-window capacity. Existing token
expenditure is cumulative and must not be mistaken for occupancy.

Add one row in the selected child's fixed detail header, below model and
cumulative metadata and above the task. Obtain a child-local measurement
with the same semantics as the parent's `getContextUsage()`. Preserve its
latest valid state for ended children and recoverable history.

```text
worker-1                           running · 1m32s
gpt-5 · 180.0k tok · $0.42
ctx [####----] 50% · 100K / 200K
Implement form validation
------------------------------------------------
Prompt
> Review the fields and add validation...
```

ASCII is illustrative. The shipped meter uses the principal header's
spaced eight-cell `▰`/`▱` presentation and theme behavior, not square
brackets or an ASCII fallback. Fleet list and principal header output stay
unchanged, including cumulative token and cost formatting.

Business intent belongs to the developer. Canonical terms remain those of
`GLOSSARY.md`; this specification introduces no new canonical concept.

## User stories

1. As the operator, I can see the selected child's occupancy, percentage
   and capacity while scrolling its transcript.
2. I can distinguish occupancy from cumulative token expenditure and cost.
3. I can recognize unknown, unavailable and retained data without a
   fabricated zero or a stale pre-compaction percentage.
4. I can inspect an ended child's latest valid context state when reopening
   history, without inferring measurements missing from old records.
5. I can use the existing Fleet view at narrow widths and short heights
   without a new layout, navigation mode or overflowing context row.

## Readiness, authority and source identity

The brief and final feature-critic report are available and consistent.
All material functional decisions are accepted and all review findings are
disposed. Three independent lenses reverified definition-2; a duplicate
warning was withdrawn by its originating lens, not accepted as risk.

- Current approved brief SHA256:
  `f6944fdf833ae6cee6a6da7dc025dd45a39454cd25fb2a76d598b6212b0a3dec`.
- Final definition-review SHA256:
  `e14a49762bbb215986ce33f1b343bc60a74fbd8275abaac1939195e22635c598`.
- Critiqued brief SHA256 before editorial READY-state updates:
  `ec1ee5033c8224fb230f404236c3eea854e069e5527366831d424fbbd6b22194`.
  Reversing only the three recorded review-state edits reproduces this
  digest. No functional change followed critique.
- Root authority: `GLOSSARY.md`, selected by `docs/agents/domain.md`.
- Applicable decisions: ADR 0007 (Chrome), ADR 0023 (RPC child processes
  and reload continuity), ADR 0026 (bounded transcript residency).
- Generated Domain Authority Handoff: absent, admissible separately.
- Generated read-only authority review: absent, admissible separately.
  Functional and semantic decisions are closed; neither absence requires
  a glossary, ADR, generated artifact or repository-policy change.

The older Fleet-history brief supplies intent only; its in-process and
reload statements do not supersede ADR 0023.

## Preserved decision register

All decisions below are mandatory observable constraints because the
developer explicitly accepted them. The source is the corresponding
proposal and `Si` acceptance in the definition conversation, preserved in
the brief and review report. No decision is superseded by recency alone.

| ID | Decision | Resolver and source | Status and accepted supersession |
| --- | --- | --- | --- |
| D1 | Fixed row below model metadata and above task | Developer; initial ASCII proposal acceptance | Accepted; D10 later bounds visibility by header room |
| D2 | Main eight-cell meter and colors, with occupied/capacity counts in detail | Developer; initial proposal acceptance | Accepted; no change to the main header's no-used-count decision |
| D3 | Remove bar first; unknown occupancy is not zero | Developer; initial proposal acceptance | Accepted; extended by D9/D10 |
| D4 | Fleet list and main header unchanged | Developer; initial proposal acceptance | Accepted; no supersession |
| D5 | Retain latest available measurement for ended/reopened children with `last`; old records without measurement show unavailable | Developer; lifecycle proposal acceptance | Accepted; closes initial O1; validity bounded by D12/D14 |
| D6 | Refresh on start, completed response and compaction, not every token | Developer; final edge-case preview acceptance | Accepted; reaffirmed by D11 |
| D7 | Unknown post-compaction occupancy replaces old percentage; failed refresh retains `last` or unavailable | Developer; final edge-case preview acceptance | Accepted; extends D5, refined by D12/D13 |
| D8 | Queued and unknown-capacity children show unavailable | Developer; final edge-case preview acceptance | Accepted; no supersession |
| D9 | Remove bar then counts; preserve percentage and `last` while they fit | Developer; final edge-case preview acceptance | Accepted; extends D3, completed by D10 |
| D10 | Final truncation; existing vertical clipping, no short-height redesign | Developer; separate R3/R6 simplification acceptance | Accepted; bounds D1 and extends D9 |
| D11 | Three triggers, one `last` label, no old-record reconstruction | Developer; same simplification acceptance | Accepted; reaffirms D5–D8 |
| D12 | Successful compaction immediately invalidates prior occupancy; discard pre-compaction replies; failed/aborted compaction alone does not invalidate | Developer; final trust-rule preview acceptance | Accepted; invalidation precedes D7 fallback |
| D13 | Pending/failed queries mark retained valid data `last`; ended unknown occupancy is `ctx ? · capacity · last` | Developer; same trust-rule acceptance | Accepted; extends D5/D7 and composes null with `last` |
| D14 | Incomplete history shows data only with validity evidence, otherwise unavailable | Developer; same trust-rule acceptance | Accepted; bounds D5 by recoverable evidence |

## Observable state and transition contract

These rules are mandatory consequences of D1–D14. The words in the first
column describe internal situations, not new Run states or operator labels.

| Situation | Full-width context row |
| --- | --- |
| No measurement, unknown capacity, queued or never started | `ctx unavailable` |
| Current occupancy and capacity known | `ctx <bar> <percent>% · <used> / <capacity>` |
| Capacity known, occupancy unknown | `ctx ? · <capacity>` |
| Valid numeric reading retained while refresh is pending/failed | Numeric row followed by `· last` |
| Valid unknown-occupancy state retained while refresh is pending/failed | `ctx ? · <capacity> · last` |
| Ended or reopened child with recoverable numeric state | Numeric row followed by `· last` |
| Ended or reopened child with recoverable unknown occupancy | `ctx ? · <capacity> · last` |
| History cannot establish validity | `ctx unavailable` |

A successful measurement with absent/nonpositive capacity means unavailable
(D8), not a failed request preserving a numeric reading. A transport error,
nonresponse, process death or malformed measurement is a failed refresh;
retain only still-valid state and label it `last` (D7/D13). Do not take
capacity from the parent's model, cumulative usage or a current model lookup.

On confirmed successful compaction, invalidate occupancy before processing
any later measurement result. Known capacity may remain as the last
observed capacity with unknown occupancy. This local unknown state takes
precedence over fallback, even when the next query fails. Only a reading
issued after that invalidation can supply a new percentage. Failed or
aborted compaction alone does not clear a valid reading.

If the child ends after invalidation but before another usable reading,
preserve the unknown state and its evidenced capacity as `last`; if no
capacity is evidenced, preserve unavailable. Do not revive a pre-compaction
percentage on terminal transition, reload, late reply or historical reopen.

### Numbers and layout

Mandatory, sourced from D2/D3/D9/D10 and the main header comparison:

- Display `round(occupied / capacity × 100)`, without a 100% cap.
- Fill `round(displayedPercent / 100 × 8)` cells, clamped to 0–8.
- Color percentage and meter with `warning` from rounded 75%, `error` from
  rounded 95%, otherwise the existing normal context color.
- Use existing compact context-token formatting for both absolute counts.
  Cumulative Fleet metadata keeps its existing separate formatting.
- Unknown occupancy has no meter or percentage; unavailable has no numbers.
- Width fallback: full row, omit meter, omit absolute counts, then existing
  final row truncation. Retain percentage and `last` while they fit.
  Apply final clipping to unknown/unavailable forms too; never overflow.
- Preserve Fleet's already-adjusted width and existing sanitizing. Do not
  apply the shell margins twice.
- Keep the row outside transcript scrolling. Preserve current bottom-clipped
  header behavior when terminal height cannot fit every header row.

## Implementation constraints and structural recommendations

Mandatory describes an approved constraint or indispensable ordering rule,
not a preferred file arrangement. Recommendations identify the smallest
currently evidenced implementation; they are not extra product requirements.
Existing symbols below locate evidence, not a prescribed patch or line map.

### Measurement module and ordering seam

**Mandatory — sources D6/D7/D12/D13 and ADR 0023.** Measurements belong to
the selected child's RPC process. Handle the three triggers independently
of whether Fleet is open. Queries must reach a finite completion/failure
outcome, update the view without another child event, and never change the
child's Run state or Verdict merely because telemetry is unavailable.
Successful-compaction invalidation and stale-reply rejection must follow
stdout receipt order, not a later asynchronous event-delivery order.

Evidence: the existing correlated request module resolves replies directly
while queuing non-response events for asynchronous delivery. Pi's
`get_session_stats` returns the same `getContextUsage()` function as the
parent; successful `compaction_end` is distinguishable from failure/abort.

**Recommendation.** Extend the existing correlated RPC request module with
an independently caught `get_session_stats` refresh. Keep one request in
flight plus a pending-trigger flag, rather than a growing queue or polling
per frame. A trigger during a request requires a later refresh. Track a
child-local context generation synchronously at successful-compaction
receipt; tag requests and reject results from an older generation. This
seam keeps ordering knowledge beside the stream that proves it.

Use the existing injected `Schedule` seam for an explicitly owned finite
measurement deadline, initially using the existing readiness-deadline
duration as a conservative recommendation, not a new user-visible SLA.
Remove timed-out correlations and cancel timers on settlement/disposal;
ignore late replies without unhandled rejection or mutation. Retry on the
next approved trigger, not an autonomous polling/retry loop. A query failure
must not fail a completed child while finishing its final telemetry drain.

Validate RPC and persisted data as `unknown` before using it. Recommend
positive safe-integer capacity and null/nonnegative safe-integer occupancy;
preserve null, allow occupancy above capacity, and calculate the displayed
percentage locally instead of trusting a second reported percentage. Keep
unknown capacity distinct from a malformed measurement or failed query.

### Registry and lifecycle module

**Mandatory — sources D5/D12/D13, ADR 0023.** Publish accepted state changes
to the correct child record, preserve them across reload, and establish
terminal state before sealing historical evidence. Do not let disposal or a
late result restore a value invalidated by successful compaction.

**Recommendation.** Add a narrow context-state callback beside the existing
child event/result callbacks, retaining the tracking implementation inside
the RPC module. Use the registry's existing Port seam, including bind,
held/replayed callbacks, foreground behavior and reload adoption. Notify
selected-child followers through the existing render notification seam;
avoid a complete history relist for every measurement.

Keep only current context state per child, not every sample. Represent
unavailable, known capacity with null occupancy, numeric occupancy and
retained freshness without conflating null with absence. A small typed
snapshot is sufficient; field names and exact union shape are not mandated.
Before terminal disposal/seal, settle the pending telemetry work within its
finite deadline or preserve its fail-safe state. Measurement work must not
outlive cancellation/termination or extend existing process-tree deadlines.

### Audit retention and recovery module

**Mandatory — sources D5/D12/D14 and ADR 0026.** Recover occupancy and
capacity together only with evidence tying them to the latest recoverable
context state. An invalidation cannot disappear in a lossy transcript queue
and leave an older numeric reading apparently valid. Missing, malformed,
torn or unverifiable data yields unavailable, never a backward search for
an older convenient value. Preserve bounded reads and transcript residency;
no historical migration or reconstruction is required.

**Recommendation.** Keep the latest context state as non-transcript metadata
in the live audit record and include an optional, validated snapshot in the
existing closing summary. Update it independently of lossy observation
admission. Existing readers ignore additional close fields; old records
lack the snapshot and remain readable as unavailable.

For this recommendation, require verified child/parent identity and the
existing final-complete-line/committed-ordinal close checks before trusting
the snapshot. The close snapshot must incorporate every accepted context
invalidation before sealing. Its unknown-occupancy state is itself meaningful
evidence and must not be replaced with an older measurement.

A final verified close may attest to context state even when ordinary
transcript capture is incomplete, but only if the implementation proves
that context/invalidation state bypasses that loss. Transcript `complete`
alone is neither proof nor disproof of context validity. If independent
validity cannot be proved, use unavailable. A later invalidation must void a
sealed snapshot through the existing late-evidence mechanism; a late reading
must not silently rewrite the seal. Interrupted/unsealed records without
independent validity evidence use unavailable. This is the approved D14
fallback, not a new crash-durability guarantee.

Avoid new transcript observation kinds or a separate persistence system:
the existing bounded closing-summary seam already serves the retained
snapshot. If implementation evidence defeats this recommendation, return
the contradiction for resolution rather than weakening D12/D14.

### Meter and Fleet rendering modules

**Mandatory — sources D1–D4/D9/D10.** Render the row through the existing
Fleet detail-header seam, preserving selection, navigation, cumulative
metadata and the main header's observable output. Maintain one set of
observable numeric/glyph/color rules and the approved Fleet-only absence
and width behavior.

**Recommendation.** Share the small pure meter calculation/presentation
implementation used by the main header and compose the Fleet row around
it. Keep unrelated header layout private. The existing header renderer is
the highest useful seam for parent parity tests; the Fleet overlay renderer
is the highest useful seam for context placement and width tests. No new
framework, general progress-bar abstraction or dependency is needed.

## Shared-capability comparisons and invariants

| Capability | Comparison evidence | Invariant for implementation and slicing |
| --- | --- | --- |
| Meter and compact counts | Main header context calculation and render tests; Fleet cumulative `count`/`spent` | Same meter rules; no changes to cumulative usage or main output |
| Frame width and visibility | Main header/footer ladders; Fleet header clipping and margins | Fleet-specific ladder is authorized; no double margins or overflow |
| Child-local measurement | Parent `getContextUsage`, Pi stats RPC, existing child correlated requests | Same semantics, different process; never use parent occupancy |
| Query lifecycle | Request/fail/ready timer handling; existing coalesced entries refresh | Finite completion, no stale-generation result, immediate view notification |
| Registry and reload | Existing Port hold/bind/adopt and terminal shutdown | State survives reload without loss/duplication; no late resurrection |
| Audit and history | Closing summary, bounded tail recovery, live/historical projection | Validity survives ordinary observation loss or fails closed; no transcript expansion |
| Domain authority | GLOSSARY; ADR 0007/0023/0026 | No canonical change; older in-process brief does not override RPC execution |

Current evidence locations include the child RPC/handle/registry/audit and
Fleet rendering modules, the Chrome renderer, Pi 1.4.0 session/RPC source,
and corresponding repository tests. Their symbols may move without changing
the observable contract.

## Testing decisions

Tests are mandatory evidence for the approved behavior, not proof already
obtained. Develop vertically at the highest useful existing seams. Read
`test/support/README.md` before extending a helper. Prefer scripted RPC,
registry/audit fixtures and injected schedulers over real-time sleeps.

1. **RPC acquisition:** start, completed assistant response, successful
   compaction; no token-delta or viewport polling. Valid numeric, null,
   absent capacity and malformed responses; transport error, silence,
   process death, timeout cleanup and late response after timeout.
2. **Ordering:** an earlier compaction event queued for delivery and a
   later reply received in the same stdout chunk; a request issued before
   compaction that answers afterward; failed/aborted compaction. Assert the
   old percentage cannot return, including during finalization.
3. **Coalescing and termination:** repeated triggers with one in-flight
   request; eventual refresh for a later trigger; no unbounded queue,
   timer/correlation leak, failure of the child's result, or extra process
   lifetime beyond existing cancellation guarantees.
4. **Registry and reload:** the correct selected child's state, followers
   notified without a subsequent message, callback hold/replay across
   detach/adopt, independent sibling values and no duplicate transitions.
5. **Persistence:** numeric and null state seal/reopen; compaction followed
   by failure and terminal close; ordinary capture loss with independently
   trustworthy snapshot; old/no-snapshot records, identity mismatch,
   malformed/torn/unsealed/late-invalidated close and drain expiry.
   When validity cannot be established, assert unavailable rather than a
   pre-compaction value. Preserve bounded tail and transcript residency.
6. **Fleet output:** correct row order and fixed position while scrolling;
   real eight-cell glyphs and percentages at 0, rounded threshold boundaries,
   75, 95 and above 100; all unknown/unavailable/last combinations; remove
   bar then counts then clip, including widths down to one column; existing
   short-height clipping. Preserve list, navigation and metadata output.
7. **Parent parity:** existing main-header tests remain unchanged in their
   expected output; compare the shared numeric/glyph/color behavior without
   forcing Fleet's intentionally different count/absence layout on it.
8. **Installed Pi:** extend the existing isolated real-binary child seam to
   verify `get_session_stats` occupancy semantics and compaction behavior,
   not just mocks. Record unsupported or opt-in prerequisites honestly;
   source inspection is not a substitute for the run. Observe stats latency
   and ordering without inventing a new product SLA.

Existing useful seams include scripted fake Pi commands, injected `Schedule`,
`fakeChildren`, audited registry/view fixtures, audit file-fault helpers and
manual schedulers, `renderHeader`, and the existing real-Pi child tests.
Extend helpers only as needed and update their support documentation.

The repository acceptance command remains `npm run check`, including type,
lint, dependency-use, tests and packed-distribution validation. No external
review receipt or hook is required. Mutation testing is unsupported by the
consumer contract and is not a delivery prerequisite.

## Dependencies, native relationships and exclusions

The implementation reuses current Pi RPC support, registry/reload, audit
storage, Fleet view, theme and injected timers. No package addition, new
channel, provider integration, model catalog or glossary/ADR change is
required by this specification. There is no prerequisite product ticket or
blocking relationship to invent: the required capabilities already exist.

A file-specification parent in `felipe3dfx/pi-workflow` identifies this
specification by `docs/specs/fleet-context-usage.md` only. Publication state
and parent identity are recorded by the publication handoff, not inferred
from this document's status. Implementation children and native blocking
relationships belong to `to-tickets`; this specification slices no tickets
and closes no parent.

Out of scope: Fleet list indicators, principal-header changes, token-by-token
animation, additional model-change triggers, distinct `last` variants,
new terminal-height layouts, old-history migration/reconstruction,
general telemetry infrastructure, new lifecycle states, automatic restart,
and changes to child execution, permissions or process-tree guarantees.

## Deviations, risks and handoff conditions

Authorized differences from the main header: Fleet shows occupied/capacity
counts, shows unavailable instead of omitting unknown capacity, and uses its
own approved width ladder. They do not alter the shared meter semantics.
No additional deviation or accepted residual risk is declared.

Unverified implementation evidence remains: actual stats cost/ordering,
installed-binary equivalence, changes of routed capacity without an event,
and recovery under capture failure. These remain validation obligations,
not an upgrade of source-level evidence into runtime guarantees.

Hand `to-tickets` this specification, the consolidated report and the joint
brief/definition-review publication under the same package and handoff,
with the verified parent identity. Preserve D1–D14, the mandatory constraints,
source-linked recommendation status and test seams above. A material
functional defect returns to `feature`/`feature-critic`; do not edit a
published definition or silently relax validity during slicing.
