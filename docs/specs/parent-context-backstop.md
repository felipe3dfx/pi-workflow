# Parent context backstop

Status: Specification synthesized from an approved READY definition; not implemented.

Specification identity: `parent-context-backstop/specification-1`.
Definition package: `parent-context-backstop/definition-1`.
Brief: [approved definition](../features/parent-context-backstop.md), SHA256 `2da6067b41b9b6737124a12f21739813e2767fc053bcd181e0227dac721a85fd`.
Feature-critic review: [report](../features/parent-context-backstop-review.md), SHA256 `9a46f320bb4c7499c2264e45a223d212ee3a8a7f3610d2f19c118f2ef73b771f`.
Consolidated report: [parent-context-backstop-review.md](parent-context-backstop-review.md).
Feature-critic verdict: `READY`, with no open findings or accepted warnings.
Prototype and UI contract: none; no prototype is required.

## Problem and solution

In the `opportunistic` delegation mode, the parent decides alone when to delegate. In genuinely long sessions it keeps working inline, and its context, re-read on every turn, keeps growing. The exploration notice (ADR 0028) counts lookups per user message and never sees total context growth.

Add a context backstop: one advisory steer message to the parent, in `opportunistic` only, when its measured context usage reaches min(150,000 tokens, floor(15% of the context window)). It asks the parent to delegate the next bounded multi-step unit to a child session, while single small edits and state checks stay inline. It never blocks a tool or refuses a launch.

Sessions below the threshold are out of scope; for them the exploration notice remains the signal. The 2026-11-13 session that motivated the feature (about 125k tokens on a 1M window) is below the threshold.

## User stories

1. As the operator, when a parent in `opportunistic` has accumulated context past the threshold, I want it told to move the next multi-step unit into a child session, so the re-read parent context stops growing as fast.
2. As the operator, I want small edits and state checks to stay in the parent, so the backstop does not add child latency to trivial work.
3. As the operator, I want at most one instruction about delegation per tool result, so the parent never receives two opposite notices at once.

## Preserved decision register

| ID | Decision | Resolver | Source | Status |
| --- | --- | --- | --- | --- |
| D1 | Improve `opportunistic`; no third mode | Felipe | conversation 2026-11-13 | accepted |
| D2 | Block worker or verify launches without a reason | Felipe | conversation 2026-11-13 | superseded by D3 |
| D3 | Context backstop only, advisory | Felipe | ADR 0027, ADR 0028:23, GLOSSARY Delegation mode | accepted |
| D4 | Threshold min(150k, 15%) | Felipe | gentle-shell `lib/context-backstop.ts:10` parity | accepted |
| D5 | Scope limited to sessions past the threshold | Felipe | feature-critic B1 | accepted |
| D6 | `opportunistic` only, one sentence | Felipe | feature-critic S1 | accepted |
| D7 | Plain steer message, no card | Felipe | feature-critic S2 | accepted |
| D8 | Once per session guaranteed; re-arm best effort | Felipe | feature-critic S3 | accepted |
| D9 | Child-tools gate | Felipe | feature-critic W1 | accepted |
| D10 | Backstop wins on the same tool result; the exploration notice is consumed, not deferred | Felipe | feature-critic W2, N1 | accepted |
| D11 | Re-arm only on a numeric reading below the threshold | Felipe | feature-critic S5 | accepted; supersedes W3's `session_compact` re-arm |
| D12 | Send both notices on the same result | Felipe | feature-critic S4 | rejected |
| D13 | No configuration knob, no throttling | Felipe | brief A3 | accepted |

## Observable behavior

| State | Condition | Effect |
| --- | --- | --- |
| Inactive | Delegation mode is `orchestrator`, or the session does not offer the child tools | No backstop message; the exploration notice behaves as today. |
| Armed | `opportunistic`, child tools offered, not yet notified | Each parent tool result reads `ctx.getContextUsage()`. |
| Fire | A reading has numeric `tokens` at or above the threshold | Send the backstop steer message; become Notified. The exploration notice, if it would fire on the same result, is consumed and not sent. |
| Notified | Notice already sent | No further backstop message. |
| Re-arm | Notified and a reading has numeric `tokens` below the threshold | Become Armed; a later crossing may fire again. |
| Unknown | `getContextUsage()` returns `undefined`, or `tokens` is `null` | No state change. |

- Threshold: `min(150_000, floor(0.15 * contextWindow))`; when the context window is unknown or not positive, `150_000`.
- A resumed session already past the threshold fires on its first tool result, because the state is in memory and starts Armed.
- The reading may lag one tool result behind; accepted.
- Message: `customType` of its own, `display: true`, plain content with no custom renderer, delivered with `{ deliverAs: "steer", triggerTurn: true }`, the exploration notice's options.
- Content states the measured tokens and threshold, asks to delegate the next bounded multi-step unit to a child session, keeps single small edits and state checks inline, and states, like the exploration notice, that it is runtime context and grants no authority (ADR 0025).

## Implementation constraints and structural recommendations

Mandatory:

- Advisory only: never block a tool, refuse a launch, or change a delegation mode prompt. Source: ADR 0027, ADR 0028:23, ADR 0015.
- Gate on `childTools.offered()` and `delegationMode.current() === "opportunistic"`. Source: D6, D9.
- Precedence inside the single `tool_result` handler at `extensions/pi-workflow.ts:316`: evaluate the backstop, still call `explorationBudget.result(...)` so its state is consumed, and send only the backstop when both fire. Source: D10.
- No change to `explorationNotice` text or to `exploration-budget-card.ts`. Source: brief scope.

Recommendation (evidence: the exploration budget module is a deep module tested through `start`, `call`, and `result` in `test/exploration-budget.test.mjs`):

- A new module `extensions/context-backstop.ts` exposing a small interface: a pure `backstopThreshold(contextWindow)` and a stateful `createContextBackstop()` with one method taking a usage reading and returning the facts to notify or `undefined`, plus a pure notice formatter. The handler in `pi-workflow.ts` stays the only place that reads `ctx`, applies the gates and precedence, and sends messages. This keeps the module testable without Pi, like the exploration budget.

## Shared-capability comparisons and invariants

| Capability | Relation | Invariant |
| --- | --- | --- |
| Exploration notice (`extensions/exploration-budget.ts`, `pi-workflow.ts:316-335`) | Compatible; authorized divergences: no card, `opportunistic` condition | Advisory, grants nothing, same delivery options and child-tools gate. |
| Context usage (`ctx.getContextUsage()`, `types.d.ts:267`; `chrome.ts:431`) | Compatible | `tokens` may be `null` after compaction; the reading may be `undefined`. |
| gentle-shell backstop (`lib/context-backstop.ts`) | Parity limited to the threshold; authorized divergences: steer message instead of appending to the tool result, no 5 s throttle | A null reading never counts as reached. |

## Testing decisions

Tests go through the new module's interface and the existing harness for `pi-workflow.ts` notices; no snippet is prescribed.

- Threshold: 272k window gives 40,800; 1M window gives 150,000; unknown or zero window gives 150,000.
- A reading below the threshold sends nothing; the first reading at or above sends exactly one message.
- A second reading above sends nothing; a numeric reading below re-arms; a later crossing sends again.
- `null` tokens and an `undefined` reading change no state in either direction.
- `orchestrator` mode and a session without child tools send nothing.
- When the backstop and the exploration notice fire on the same tool result, only the backstop message is sent, and the exploration notice does not appear on the next tool result of that request.
- The message uses `deliverAs: "steer"`, `triggerTurn: true`, `display: true`, and contains the no-authority sentence.
- `npm run check` passes.

## Dependencies, native relationships and exclusions

- New ADR amending ADR 0028: the backstop is a third guidance signal, applies only in `opportunistic`, is advisory, and does not change the exploration notice. Owner: `domain-modeling`. It ships with the implementation.
- GLOSSARY entry "Context backstop". Owner: `domain-modeling`.
- Excluded: launch admission or refusal, `orchestrator`, a card, configuration knobs, throttling, `session_compact` handling.

## Deviations, risks and handoff conditions

- Accepted evidence gaps: the reading may lag one tool result; the per-result cost of `getContextUsage()` is unmeasured in pi-workflow.
- Risk recorded by D5: sessions shorter than the threshold, including the motivating one, get no backstop.
- Domain Authority Handoff: absent (admissible gap).
- Handoff to `to-tickets`: one ticket can cover the module, the handler change, tests, the ADR, and the glossary entry; slicing is that skill's decision.
