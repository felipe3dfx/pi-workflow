# Parent Fix Loop

Read this file in full before the first critique of the parent review, and whenever `create-pr` or red CI returns the parent.

## Round

1. **Critique.** Each critique runs in a fresh context receiving "Load the `review-critique` skill"; the first judges the step 6 report, each later one the latest re-review, and each receives the children's findings register.
2. **Fix.** Apply the accepted findings in a fresh context as signed, template-conforming commits on the parent, then run the focused checks the fix's impact calls for, never the full suite; `create-pr` runs the publication gate before it publishes.
3. **Re-review.** Re-review the new head as in step 6, with the children's table lines and findings register, as a corrective review: hand `code-review` the last reviewed head and its findings with their state. After a rebase of the parent, the review is full.

A round makes at most two automatic review invocations, counting the step 6 review: the second's accepted findings stay open. The developer is not asked about ordinary findings between invocations; approvals, scope expansions, and accepted risks still stop the parent immediately. When the round closes, only the `user decision` findings and the accepted findings still open go to the developer, with the rejected findings shown, needing no answer. A further fix the developer approves gets a fresh review of its own head.

Publish each developer decision on a finding, fix or not, and each accepted risk as an append-only Spanish comment on the parent ticket before any re-review or push.

## A round after the handoff

A red publication gate in `create-pr`, developer feedback on the change that `create-pr` returns, even during its preview before the first push, and red CI after publication that the developer brings with evidence the change caused it, each open a new round here, with its own cap. Red CI the change did not cause goes back to the developer; never weaken, skip, or delete a test to make a check pass.

Apply the feedback or the failure's fix as in **Fix** above, with focused checks that include every check that failed in the publication gate or in CI, then re-review and critique as above. The corrected head goes back to step 8 with `create-pr`'s consecutive red-run count unchanged, and step 9 runs again on the new pushed head. Every developer decision in this round, not only one on a finding, is published as above before the next re-review or push.
