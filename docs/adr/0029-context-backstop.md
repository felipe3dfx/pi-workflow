# ADR 0029: Context backstop

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

Issue: #380.

Amends: ADR-0028, only its description of the guidance signals: the backstop is a third signal beside the preparation contract and the exploration notice, and it applies only in `opportunistic`. The exploration notice, its text and its card do not change.

When the session offers the child tools and the Delegation mode is `opportunistic`, the harness reads the parent's `ctx.getContextUsage()` on each parent tool result that was not aborted. A reading whose `tokens` is a number at or above min(150,000, floor(15% of the context window)) sends the parent one steering message, displayed in the TUI, with no custom renderer. The threshold is 150,000 tokens when the context window is unknown or not positive. The message states the measured tokens and the threshold, asks the parent to delegate the next bounded multi-step unit to a child session, keeps single small edits and state checks inline, and says that it is runtime context and grants no authority (ADR 0025).

The message is sent once, then not again until a later reading with numeric `tokens` falls below the threshold, which re-arms it; that re-arm is best effort. A reading that is `undefined` or whose `tokens` is `null`, as right after a compaction, changes no state. An aborted tool result is not read: it neither fires nor re-arms the backstop, as the exploration notice ignores aborted calls (ADR 0028). A session already past the threshold when it resumes fires on its first non-aborted tool result.

When the backstop and the exploration notice trigger on the same tool result, only the backstop is sent, and the exploration notice counts as delivered for that request. It does not return in that request.

The backstop is advisory: it never blocks a tool, refuses a launch, or changes a delegation mode prompt. The threshold is a constant in the code, not configuration, and the reading is not throttled.

## Considered Options

- Refusing or admitting `worker` and `verify` launches by context size. Rejected: it decides the route for the parent, which ADR 0027 removed and ADR 0028 rejected.
- The backstop in `orchestrator`. Rejected: that mode already delegates everything (ADR 0015).
- A card of its own. Rejected: a plain steering message carries the same information.
- Sending both notices on the same result. Rejected: they give opposite instructions.
- Re-arming on `session_compact`. Rejected: a numeric reading below the threshold re-arms through one mechanism.
- Advisory backstop with the Gentle Shell threshold (`lib/context-backstop.ts`). Chosen. Parity is limited to the threshold: the message is a steer instead of text appended to the tool result, and there is no 5 s throttle.

## Consequences

Sessions whose parent context never reaches the threshold get no backstop; for them the exploration notice remains the signal. A session of about 125,000 tokens on a 1M window is one of them.

The reading may lag one tool result behind. The cost of `getContextUsage()` on each tool result is not measured in this repository.
