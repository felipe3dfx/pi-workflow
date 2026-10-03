# ADR 0010: Harness owns child result delivery

## Status

Acceptance: approval and merge of the introducing PR.

## Decision

The harness keeps a queue of child results that the parent has not consumed. A result becomes consumed when the parent reads it with `child_result`, when `continue_child` launches a continuation from it, or when the harness delivers it. Consuming is idempotent, and a result that is already consumed never enters the queue again.

The harness delivers pending results at a turn boundary. A busy parent receives them at the end of the current turn, through `turn_end`, or when its run settles. An idle parent receives them as soon as they end. Every result pending at one boundary goes out in one message, so the parent answers once. The message is a steering message that triggers a turn. A consumed result is never sent, so it starts no turn and renders no card.

The parent wakes when its children are done, not with each result. A result whose Run state is completed and whose Verdict is `done`, `pass`, or absent stays pending while any other child of the session is queued, running, or waiting. When no child is working, every pending result goes out in one message. A failed, timed-out, or cancelled result, or a Verdict of `blocked`, `fail`, or `partial`, wakes the parent at the next boundary with everything pending. A child that asks the parent delivers everything pending just before its question.

Ending the parent session drops the pending results. Children live in process memory and do not outlive the parent session, so after a resume `child_result` reports that the child is gone.

Supersedes: none.

## Considered Options

- Keep Pi's `followUp` delivery and filter consumed results when the follow-up is drained.
- Drop a pending result once it is older than a time window.
- Keep a harness queue of unconsumed results and flush it at each turn boundary.

## Consequences

Pi drains `followUp` only when the whole run ends, so a parent that keeps calling tools received a result long after it had read the same result with `child_result`. Filtering at drain time would still hold every result until the run ends. A time window guesses at how long a turn lasts and can drop a result the parent never saw, or replay one it already used.

Pending results live in process memory beside the child records and are not written to the session. Results that end while other children still work are held, so five children that end at different times produce one message and one turn. Results that end across boundaries arrive as separate messages only when one of them wakes the parent. A held result stays readable with `child_result`, which consumes it. A parent that is compacting without a run holds its pending results until the next turn ends or the next run settles.
