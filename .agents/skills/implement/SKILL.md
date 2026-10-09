---
name: implement
description: "Trigger: implement one approved child ticket. Build it with TDD at agreed seams, run review and critique in separate contexts, apply accepted findings, and commit locally."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.6"
  provenance: derived
---

# Implement a Child Ticket

## Activation Contract

Implement exactly one approved child ticket in a fresh session and deliver it as a local, signed commit. Compose `tdd`, `code-review`, and `review-critique`; each keeps its own contract. Publication belongs to `create-pr` and manual regression analysis to `qa-impact`.

Read the ticket, its specification, and the domain authority; coding standards are for the review's Standards axis only. Every step reads the ticket fresh from the tracker; a scope note from an orchestrator never substitutes for it.

Approvals follow the pull-request playbook's approval policy and approval preview; with no recorded policy, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`. As a child of `implement-spec`, ask for no approval and perform no external effect: return each draft, proposed effect, and question to that run, which presents them under the policy.

## Decision Gates

- More than one ticket, an unapproved ticket, or an open native blocker on the ticket: **blocked**. When the blocker's pull request or integration is already merged into the parent integration branch, propose closing the blocker and close it under the approval policy.
- A missing ticket, specification, consumer contract, or functioning validation path: **blocked**. Name what is missing.
- A material contradiction with a binding requirement blocks implementation until its authority resolves it. A behavioral change or a deviation from the domain authority or the UI contract needs an explicit decision; a substantive change to an accepted decision record follows `domain-modeling`. A UI deviation needs an approved, complete new version of the UI contract.
- A technical choice stated only as a recommendation is discretionary. Departing from it while preserving approved behavior and contracts is an implementation choice: record the decision and reason in the handoff.
- The developer owns scope, discretionary findings, and accepted risks. Preferences and approved scope expansion never block.

Propose the child branch from the recorded parent integration branch, never the production base, named per the recorded child branch convention; the developer may change it. The ticket's base is the commit the branch starts from. Recover approved prototype code selectively, never as a base or a wholesale cherry-pick.

## Execution Steps

1. **Seams.** Load the `tdd` skill. Before the first test, propose the test seams and each required behavior's coverage line, and agree them, and any line `tdd` completes later, with the developer where the approval policy asks; every ticket requirement traces to a line. A behavior with no valuable test seam records the exception `tdd` defines.
2. **Build.** Drive `tdd` at those seams. Run type checks and focused tests regularly. Recover from failed edits or checks until the candidate functions.
3. **Review.** Open a context other than the implementer's that receives "Load the `code-review` skill" and the agreed coverage lines with their tracing, and reviews with the ticket's base as the fixed point.
4. **Critique.** Load the `review-critique` skill and run it on the review report. Take every `user decision` finding to the developer, and show them the rejected findings, which need no answer.
5. **Fix.** Apply only the accepted findings and the ones the developer accepted, in a fresh context other than the implementer's, then rerun the checks. Run a second review, as in step 3, in a new context, only when a fix changes behavior; its findings return to the critique step, and only accepted findings are applied.
6. **Commit.** Unless a `direct` child of `implement-spec`, first run the full suite until green, fixing red as in step 5; as a `direct` child, it stays pending for `implement-spec`'s merged-tree gate. Commit locally with the repository's existing signing configuration and the fixed commit template from the pull-request playbook. A local commit is not an external effect; pushing is.

Every scope expansion, deviation from binding authority or the prototype contract, accepted risk, or rejected hard finding (one citing a binding standard or requirement) needs an append-only Spanish issue comment stating the decision, reason, and impact, published only once its approval preview is approved, where the approval policy asks. A decision that narrows a binding criterion is published as that deviation comment before step 3, so the Spec axis judges it. That comment and an approved blocker closure are the only external effects this skill performs.

On cancellation, preserve the work without stashing or discarding it and report the last verified point. Resume only after fresh validation.

Re-entering as a child of `implement-spec` with a stop (a merge conflict, a red gate on the merged tree, or a stale branch), rebase the branch onto the current parent head, which becomes the ticket's base, never merging the parent into it, and sign the rebased commits with the repository's existing signing configuration. Resolve the stop on the rebased branch, editing siblings' code where the stop requires it; anything beyond the stop is a scope expansion. Rerun steps 3–6, from step 1 when the resolution changes the agreed seams, and run a red gate's failing checks until green, fixing red as in step 5; the developer's earlier answers stand for identical findings. The handoff re-traces each sibling line the resolution changes.

## Output Contract

A prose handoff with:

- the ticket, the branch, and its base, plus the previous head on re-entry;
- the commit SHAs, the last one being the head;
- a small table tracing each ticket requirement to its seam and cases, each case with RED and GREEN evidence, skipped with its reason, or under its behavior's recorded no-valuable-test-seam exception;
- the checks run, with commands and results; as a `direct` child, the full suite named as pending, never as green or integrated;
- each finding ID with its verdict, the developer's answer where one was needed, and what was applied;
- decisions, deviations, accepted risks, and the approved issue comment;
- blockers or the cancellation point.

Complete only with green checks, every finding at a verdict, and the commit made. Next: `create-pr` publishes the branch, and `qa-impact` runs on the pushed head; as a `direct` child, `implement-spec` integrates it instead.
