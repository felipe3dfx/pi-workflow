---
name: implement
description: "Trigger: implement one approved ticket from the tracker. Build it with TDD at agreed seams, run review and critique in separate contexts, apply accepted findings, and commit locally."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "4.2"
  provenance: derived
---

# Implement a Ticket

## Activation Contract

Implement exactly one approved ticket in a fresh session and deliver it as local, signed commits. Compose `tdd`, `code-review`, `review-critique`, and `diagnose-bug`; each keeps its own contract.

Read the ticket, its specification when one exists, and the domain authority; coding standards serve only the review's Standards axis. Every step reads the ticket fresh from the tracker, never an orchestrator's scope note.

Approvals follow the pull-request playbook's approval policy and approval preview; with no recorded policy, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`. As a child of `implement-spec`, read [child runs](references/child-run.md) first.

## Decision Gates

- More than one ticket, an unapproved ticket, or an open native blocker on it: **blocked**. When the blocker's work is merged into the ticket's base branch, close it under the approval policy.
- A missing ticket, consumer contract, or focused validation path, or an insufficient Work Contract: **blocked**. Name what is missing; for the focused path, point to `setup-workflow`.
- A material contradiction with a binding requirement blocks implementation until its authority resolves it. A behavioral change or a deviation from the domain authority or the UI contract needs an explicit decision; a substantive change to an accepted decision record follows `domain-modeling`. A UI deviation needs an approved, complete new version of the UI contract.
- A technical choice stated only as a recommendation is discretionary: departing from it while preserving approved behavior and contracts needs only the decision and reason recorded in the handoff.
- The developer owns scope, discretionary findings, and accepted risks. Preferences and approved scope expansion never block.

The ticket's base is the commit the branch starts from. Recover approved prototype code selectively, never as a base or a wholesale cherry-pick.

## Execution Steps

Before step 1, propose and create the branch, then build and approve the Work Contract per [the Work Contract rules](references/work-contract.md).

1. **Seams.** Load the `tdd` skill. Before the first test, propose and agree with the developer, where the approval policy asks, the test seams, each required behavior's coverage line, and any line `tdd` completes later; every ticket requirement traces to a line. A behavior with no valuable test seam records the exception `tdd` defines.
2. **Build.** Drive `tdd` at those seams. Run type checks and focused checks regularly through the quality playbook's Focused Validation path, on the touched area plus affected callers and consumers. Modify files through the file-editing capability, which fails on a target mismatch; the shell rewrites files only through project formatters and codemods. Recover from failed edits or checks until the candidate functions. After GREEN, make one simplification pass in this context, keeping the simplest sufficient seams, and close it with green focused checks.
3. **Checkpoint.** Before the first review and after each fix, commit locally with the repository's existing signing configuration and the fixed commit template from the pull-request playbook. Never run the full suite; `create-pr` runs the publication gate. A local commit is not an external effect; pushing is.
4. **Review.** Open a context other than the implementer's that receives "Load the `code-review` skill", the checkpoint head, and the agreed coverage lines with their tracing, and reviews with the ticket's base as the fixed point. The first review and the first after a rebase are full; every other is corrective, receiving the last reviewed head and the prior findings with their state. A blocked axis is an accepted risk: stop the ticket for the developer.
5. **Critique.** Load the `review-critique` skill and run it on the review report. Never ask the developer about ordinary findings between reviews; approvals, scope expansions, and accepted risks still stop immediately.
6. **Fix.** Apply only the accepted findings, in a fresh context other than the implementer's, rerun focused checks, checkpoint, and review again. A round makes at most two automatic review invocations; the second's accepted findings stay open. When it closes, take to the developer only the `user decision` and still-open accepted findings; show the rejected ones, which need no answer. A further fix the developer approves gets a fresh review of its own head.

Every Work Contract addition, scope expansion, deviation from binding authority or the prototype contract, accepted risk, or rejected hard finding (one citing a binding standard or requirement) needs an append-only Spanish issue comment stating decision, reason, and impact, published only once its approval preview is approved, where the policy asks. A decision that narrows a binding criterion is published as that deviation comment before step 4, so the Spec axis judges it. Those comments and an approved blocker closure are the skill's only external effects.

On cancellation, preserve the work without stashing or discarding it and report the last verified point. Resume only after fresh validation.

When the ticket re-enters after its handoff (a stop, a red publication gate, feedback, or red CI), read [rounds](references/rounds.md) first.

## Output Contract

A prose handoff with:

- the ticket, branch, and base, plus the previous head and `create-pr`'s red-run count on re-entry;
- the commit SHAs, the last being the head, and each reviewed head with its review report, the last equal to the head;
- a small table tracing each ticket requirement to its seam and cases, each case with RED and GREEN evidence, skipped with its reason, or under its behavior's recorded no-valuable-test-seam exception;
- the focused checks, with commands and results, and the publication gate pending, never green or integrated;
- each finding ID with its verdict and the critique's evidence or reason for it, the developer's answer where needed, and what was applied;
- the Work Contract with its sources and approval;
- decisions, deviations, accepted risks, and the approved issue comments;
- blockers or the cancellation point.

Complete only with green focused checks, every finding at a verdict, and the head's review report. Next: `create-pr` publishes the branch, and `qa-impact` runs on the pushed head; as a `direct` child, `implement-spec` integrates it instead.
