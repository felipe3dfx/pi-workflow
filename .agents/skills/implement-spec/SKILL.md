---
name: implement-spec
description: "Trigger: implement a whole approved specification on its parent integration branch. Run implement per ticket across the frontier, merge each child locally under one approved batch rule, then review and publish the parent."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.4"
  provenance: derived
---

# Implement a Specification

## Activation Contract

Deliver every child ticket of one approved specification onto its parent integration branch, then publish the parent once. Compose `implement`, `code-review`, `review-critique`, `create-pr`, and `qa-impact`; each keeps its own contract. It owns only the task graph, batch rule, local integration, and closing sequence.

Read the specification, its child tickets and their blockers, and the consumer workflow and pull-request playbooks. Every step reads its ticket fresh from the tracker; a scope note from this run never substitutes for it.

## Decision Gates

- The recorded child integration mode is not `direct`: **does not apply**. Each child goes through `implement`, then `create-pr`.
- A missing specification, child ticket, parent integration branch, consumer contract, or functioning validation path: **blocked**. Name what is missing.
- No batch rule, or one not approved where the policy asks: **blocked**.
- A per-ticket decision stops that ticket and goes to the developer one by one: always for scope expansions, accepted risks, and `user decision` findings that need intent; as the approval policy asks for test seams, findings with a grounded recommendation, and comments publishing any of them.
- A merge conflict, a red gate on the merged tree, or a stale child branch at step 3 stops that ticket for the developer; never resolve the stop silently. The developer picks: re-entry, in a fresh context as in step 3 that also receives the stop and the last handoff, returning a new handoff under the same rule; reimplementation on a branch recreated at step 3; or leaving the ticket stopped.
- The rule covers the approved scope: a material change to the specification or a ticket after approval stops the affected tickets until the developer updates the rule; the others continue.

## Execution Steps

1. **Graph.** Build the task graph. The frontier is every open, approved ticket not yet integrated on the parent whose blockers are closed. Recompute it from the parent's history and the tracker: a ticket whose `Refs:` merge commit is on the parent is integrated and never merged again.
2. **Batch rule.** Present one plan: the frontier, the graph's order, and the rule. A ticket integrates only when its `implement` handoff is complete (commit made, green focused checks, every finding at a terminal verdict) and the merged tree passes the full validation gate; integration closes it; one already integrated but still open closes on approval, and the frontier is recomputed. Approval covers the rule, never a diff.
3. **Implement.** For each frontier ticket, create its child branch from the current parent head and implement it in a fresh context receiving "Load the `implement` skill as a child of `implement-spec`". On resume, a child branch without the parent head is recreated when it has no commits of its own, otherwise stale. Siblings may run in parallel.
4. **Integrate.** When a handoff meets the rule, merge the child branch into the parent with `git merge --no-ff --no-commit` and run the full gate on the merged tree. Only when green, commit the merge signed with the repository's existing signing configuration, following the commit template with the ticket's identifier in `Refs:`, then close the ticket and confirm the tracker shows it closed. On a conflict or red gate, abort the merge so the parent stays at its last integrated head.
5. **Advance.** After each integration, recompute the frontier and start its new tickets at step 3, until it holds only stopped tickets; the run ends incomplete unless every ticket is integrated and closed.
6. **Review the parent.** In a fresh context receiving "Load the `code-review` skill", review the parent branch against the specification with the production base as the fixed point. Its Spec axis establishes coverage; Valuable Tests gets, per requirement, its latest tracing line across the handoffs.
7. **Critique and fix.** Each critique runs in a fresh context receiving "Load the `review-critique` skill"; the first judges the step 6 report. Apply accepted findings in a fresh context as signed, template-conforming commits on the parent, and rerun the full gate. Publish each developer decision on a finding, fix or not, as an append-only Spanish comment on the parent ticket before any re-review. When a fix lands, re-review the new head as in step 6, with its tables: all three axes when a fix changed behavior, otherwise only the Spec axis. Its findings return here for at most two fix rounds; after the second, a third critique judges the last review, and every open finding goes to the developer as a `user decision`. A further fix needs a new review of its head; publication waits for a report with no unresolved missing requirement.
8. **Publish.** Load the `create-pr` skill and hand it a parent publication handoff: the parent ticket, branch, production base, head SHA, commits since that base, and the head's coverage report.
9. **Regression.** Load the `qa-impact` skill, run it on the pushed head, and publish its draft on the parent ticket per its output contract.

Merges and closures the batch rule authorises need no further approval. Approvals follow the pull-request playbook's approval policy and approval preview; with no recorded policy, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`. Readying or closing the specification or its parent stays manual. Never wait for a human merge. On cancellation, abort an uncommitted merge, preserve every branch and committed merge, and report the last integrated ticket.

## Output Contract

A prose report with:

- the specification, parent branch, production base, and batch rule;
- each ticket with its child branch, `implement` handoff head, merge commit SHA, post-merge gate result, and tracker state;
- each stopped ticket and what stops it;
- the parent review's head, each finding's verdict, and what was applied;
- the `create-pr` result and `qa-impact` status and comment on the pushed head;
- blockers or the cancellation point.

Complete only when every ticket is integrated and closed, the parent review's findings are at a verdict, and `create-pr` and the published `qa-impact` comment name the same head.
