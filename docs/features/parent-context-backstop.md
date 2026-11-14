# Parent Context Backstop

## Problem and User

In the `opportunistic` delegation mode, the parent decides alone when to delegate. In genuinely long sessions it keeps working inline and accumulates context that is re-read on every turn. The only harness signal today is the exploration notice (ADR 0028), which counts lookups per user message and resets on each one: it never sees total context growth. User: the operator running pi-workflow sessions.

This feature targets sessions whose parent context reaches min(150,000 tokens, 15% of the context window). Shorter sessions are out of scope; for them the exploration notice remains the signal. The 2026-11-13 session that motivated this brief (about 125k tokens on a 1M window) is below the threshold and therefore out of scope.

## Desired Outcome

When the parent's context in `opportunistic` grows past the threshold, the harness tells it to delegate the next bounded multi-step unit to a child session, while single small edits and state checks stay inline.

## Scope

- In: one advisory notice to the parent in the `opportunistic` delegation mode when its context usage reaches the threshold.
- Out: the `orchestrator` delegation mode; refusing or admitting `worker` or `verify` launches (rejected by ADR 0028; deferred until evidence of over-delegation); changing the exploration notice text; changing any delegation mode prompt; a custom card; operator knobs; throttling the measurement.

## Behavior

- Applies only when the session offers the child tools, the exploration notice's gate, and the delegation mode is `opportunistic`.
- Threshold: min(150,000 tokens, floor(15% of the context window)). With an unknown context window, the threshold is 150,000 tokens. Source: gentle-shell `lib/context-backstop.ts:10`.
- Measured with the parent's `ctx.getContextUsage()` on each parent tool result, without throttling. The reading may lag one tool result behind; this is accepted.
- A `null` token count or an absent reading changes no state: it neither triggers the notice nor re-arms it.
- Guaranteed: the notice fires once per session when a reading reaches the threshold. A resumed session already past the threshold fires on its first tool result.
- Best effort: the notice re-arms on a numeric reading below the threshold, such as the first one after compaction, and may then fire again on a later crossing.
- Delivery: a plain steer message with the same delivery options as the exploration notice and no custom renderer.
- When the backstop and the exploration notice trigger on the same tool result, only the backstop is sent, and the exploration notice counts as delivered for that request.
- One sentence: delegate the next bounded multi-step unit to a child session; single small edits and state checks stay inline.
- Like every harness message, it grants no authority (ADR 0025) and never blocks a tool or refuses a launch.

## Decisions

| Decision | Resolver | Source | Status |
| --- | --- | --- | --- |
| Improve `opportunistic`, no third mode | Felipe | conversation 2026-11-13 | accepted |
| Block launches without a reason | Felipe | conversation 2026-11-13 | superseded by the next row |
| Context backstop only, advisory | Felipe | ADR 0027, ADR 0028:23, GLOSSARY Delegation mode | accepted |
| Threshold min(150k, 15%) | Felipe | gentle-shell parity | accepted |
| Scope limited to sessions past the threshold; the motivating session is out of scope | Felipe | feature-critic B1, option 1 | accepted |
| `opportunistic` only, one sentence (S1) | Felipe | feature-critic scope lens | accepted; replaces A1 |
| Plain steer message, no card (S2) | Felipe | feature-critic scope lens | accepted; replaces A2 |
| Once per session guaranteed, re-arm best effort (S3) | Felipe | feature-critic scope lens | accepted |
| Child-tools gate (W1), backstop precedence (W2), measurement states (W4), ADR and glossary (W7) | Felipe | feature-critic findings | accepted |
| Re-arm on `session_compact` (W3) | Felipe | feature-critic findings | superseded by S5 |
| A suppressed exploration notice is consumed, not deferred (N1) | Felipe | feature-critic reverification | accepted |
| Re-arm only on a numeric reading below the threshold (S5) | Felipe | feature-critic scope lens | accepted |
| Send both notices on the same result (S4) | Felipe | feature-critic scope lens | rejected: contradicts W2, two opposite instructions |

## Assumptions

- A3: No configuration knob; gentle-shell's environment variables are not ported. Status: accepted.
- A1 (applies in `orchestrator`) and A2 (compact card) are superseded by S1 and S2.

## Shared Capabilities

- Exploration notice (`extensions/exploration-budget.ts`, `extensions/pi-workflow.ts:316-335`): same child-tools gate and delivery options. Invariant: advisory, grants nothing. Authorized divergences: no card, and the `opportunistic` mode condition.
- Context usage (`ctx.getContextUsage()`, `types.d.ts:267`; used at `extensions/chrome.ts:431`): tokens may be `null` right after compaction.
- gentle-shell backstop: parity limited to the threshold. Authorized divergences: steer message instead of appending to the tool result, and no 5 s throttle.

## Dependencies

- A new ADR amending ADR 0028 to add the backstop as a third guidance signal that applies only in `opportunistic`, so it does not read as a change to the exploration notice, and a GLOSSARY entry "Context backstop", owned by `domain-modeling`. The spec includes both.

## Risks and Evidence Gaps

- The measurement may lag one tool result; no repository test confirms its timing.
- `getContextUsage()` cost per tool result is unmeasured in pi-workflow; gentle-shell throttles it.
- Domain Authority Handoff: absent (admissible gap).
