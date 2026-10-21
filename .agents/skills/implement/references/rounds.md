# Rounds After the First Handoff

Read this file in full when a ticket re-enters `implement` after its handoff. Every such return is a re-entry. Only a Child Ticket implemented as a child of `implement-spec` re-enters with a stop; every ticket can open a round after the handoff.

## Re-entry with a stop

Re-entering as a child of `implement-spec` with a stop (a merge conflict, red checks on the merged tree, or a stale branch), rebase the branch onto the current parent head, the ticket's new base, never merging the parent into it, signing the rebased commits with the repository's existing configuration. Resolve the stop there, editing siblings' code where the stop requires it; anything beyond the stop is a scope expansion. Rerun steps 3–6, from step 1 when the resolution changes the agreed seams; after the rebase, the next review is full. Run the failing checks until green, fixing red as in step 6; the developer's earlier answers stand for identical findings. The handoff re-traces each sibling line the resolution changes.

## A round after the handoff

A red publication gate in `create-pr`, developer feedback on the change that `create-pr` returns, even during its preview before the first push, and red CI after publication that the developer brings with evidence the change caused it, each open a new round here; for a parent integration branch, the round runs in `implement-spec`'s fix step instead. Red CI the change did not cause goes back to the developer. Never weaken, skip, or delete a test to make a check pass.

The round runs the same loop from the current head, with its own cap of two automatic review invocations:

- Apply the feedback or the failure's fix as in step 6, driving `tdd` at the agreed seams when it changes behavior.
- Run the focused checks, including every check that failed in the publication gate or in CI, until green.
- Checkpoint as in step 3, then review the new head as a corrective review, critique, and fix as in steps 4–6.

A review report the developer brings, from another session or another review run, counts as that round's `code-review` output. It goes through `review-critique` like any other, and a finding identical to one already judged keeps its verdict.

Publish each developer decision as an append-only Spanish comment on the ticket before the next review or push, under SKILL.md's issue-comment rule; a decision that adds behavior or scope beyond the ticket and specification is a Work Contract addition, and the Spec axis judges against the changed contract. Each comment is published after its approval preview where the policy asks or, as a child of `implement-spec`, returned to that run. The handoff carries `create-pr`'s consecutive red-run count unchanged, and the corrected head goes back to `create-pr`, which runs the publication gate before publishing it.
