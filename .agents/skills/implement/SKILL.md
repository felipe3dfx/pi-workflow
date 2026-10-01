---
name: implement
description: "Trigger: implement one approved child ticket. Build it with TDD at agreed seams, run review and critique in separate contexts, apply accepted findings, and commit locally."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.0"
  provenance: derived
---

# Implement a Child Ticket

## Activation Contract

Implement exactly one approved child ticket in a fresh session and deliver it as a local, signed commit. Compose `tdd`, `code-review`, and `review-critique`; each keeps its own contract. Publication belongs to `create-pr` and manual regression analysis to `qa-impact`.

Read the ticket, its specification, and the domain authority; coding standards are for the review's Standards axis only.

## Decision Gates

- More than one ticket, an unapproved ticket, or an open native blocker on the ticket: **blocked**.
- A missing ticket, specification, consumer contract, or functioning validation path: **blocked**. Name what is missing.
- A material contradiction with a binding requirement blocks implementation until its authority resolves it. A behavioral change or a deviation from the domain authority or the UI contract needs an explicit decision; a substantive change to an accepted decision record follows `domain-modeling`. A UI deviation needs an approved, complete new version of the UI contract.
- A technical choice stated only as a recommendation is discretionary. Departing from it while preserving approved behavior and contracts is an implementation choice: record the decision and the reason in the handoff.
- The developer owns scope, discretionary findings, and accepted risks. Preferences and approved scope expansion never block.

Propose the child branch from the recorded parent integration branch, never the production base, named as the recorded child branch convention requires; the developer may change it. The ticket's base is the commit the branch starts from. Recover approved prototype code selectively, never as a base or a wholesale cherry-pick.

## Execution Steps

1. **Seams.** Agree the test seams with the developer before the first test. A behavior with no valuable test seam records the exception `tdd` defines.
2. **Build.** Drive `tdd` at those seams. Run type checks and focused tests regularly, and the full suite before review. Recover from failed edits or checks until the candidate functions.
3. **Review.** Run `code-review` in a context other than the implementer's, with the ticket's base as the fixed point.
4. **Critique.** Run `review-critique` on the review report. Take every `user decision` finding to the developer.
5. **Fix.** Apply only the accepted findings and the ones the developer accepted, in a fresh context that is not the implementer's, then rerun the checks. Run a second review only when a fix changes behavior; its findings return to the critique step, and only accepted findings are applied.
6. **Commit.** Commit locally with the repository's existing signing configuration and the fixed commit template from the pull-request playbook. A local commit is not an external effect; pushing is.

Every scope expansion, deviation from binding authority or the prototype contract, accepted risk, or rejected hard finding (one citing a binding standard or requirement) needs an append-only Spanish issue comment stating the decision, the reason, and the impact, published only after the developer approves its exact text. That comment is the only external effect this skill performs.

On cancellation, preserve the work without stashing or discarding it and report the last verified point. Resume only after fresh validation.

## Output Contract

A prose handoff with:

- the ticket, the branch, and its base;
- the commit SHAs, the last one being the head;
- each seam with its RED and GREEN evidence, or its recorded no-valuable-test-seam exception;
- the checks run, with commands and results;
- each finding ID with its verdict, the developer's answer where one was needed, and what was applied;
- decisions, deviations, accepted risks, and the approved issue comment;
- blockers or the cancellation point.

Complete only with green checks, every finding at a verdict, and the commit made. Next: `create-pr` publishes the branch, and `qa-impact` runs on the pushed head.
