---
name: implement
description: "Trigger: implement one approved ticket from the tracker. Build it with TDD at agreed seams, run review and critique in separate contexts, apply accepted findings, and commit locally."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "4.9"
  provenance: derived
---

# Implement a Ticket

## Activation Contract

Implement exactly one approved ticket in a fresh session and deliver it as local commits. Compose `tdd`, `code-review`, `review-critique`, and `diagnose-bug`; each keeps its own contract.

Read the ticket, its specification when one exists, and the domain authority; coding standards serve only the review's Standards axis. Each context that uses the ticket reads it fresh from the tracker once; this run passes each delegated context the ticket's identifier, never its content or a scope note.

Approvals follow the pull-request playbook's approval policy and approval preview; with no recorded policy, use `every-step`, telling the user once to run `setup-workflow update`; with no pull-request playbook, block and point to `setup-workflow`. As a child of `implement-spec`, read [child runs](references/child-run.md) first.

## Decision Gates

- More than one ticket, an unapproved ticket, or an open native blocker on it: **blocked**. When the blocker's work is merged into the ticket's base branch, close it under the approval policy.
- A missing ticket, consumer contract, or focused validation path, or an insufficient Work Contract: **blocked**. Name what is missing; for the focused path, point to `setup-workflow`.
- A material contradiction with a binding requirement blocks implementation until its authority resolves it. A behavioral change or a deviation from the domain authority or the UI contract needs an explicit decision; a substantive change to an accepted decision record follows `domain-modeling`. A UI deviation needs an approved, complete new version of the UI contract.
- A technical choice stated only as a recommendation is discretionary: departing from it while preserving approved behavior and contracts needs only the decision and reason recorded in the handoff.
- The developer owns scope, discretionary findings, and accepted risks. Preferences and approved scope expansion never block.

The ticket's base is the commit the branch starts from.

## Execution Steps

Before step 1, resolve the ticket reference through the confirmed tracker and show its canonical ID, title, and repository or project; ask one focused question only if it is ambiguous. Then create the proposed branch and approve the Work Contract per [its rules](references/work-contract.md).

Scope prerequisites by phase and report discovered future limitations. Read [missing evidence](references/missing-evidence.md) before step 1 when the quality playbook records no `supported` Scratch Evidence state, and at Review whenever Valuable Tests blocks on missing evidence.

1. **Seams.** Load the `tdd` skill. Before testing, propose and agree with the developer, where policy asks, seams, each required behavior's coverage line, and lines `tdd` completes later; trace every ticket requirement to a line. Without a valuable seam, record `tdd`'s exception.
2. **Build.** Drive `tdd` at agreed seams. Regularly run type and focused checks through the quality playbook's Focused Validation path on touched areas and affected callers and consumers. Edit through the file-editing capability, failing on target mismatch; shell rewrites use only project formatters and codemods. Recover failed edits or checks until the candidate functions. After GREEN, simplify once in this context, keeping the simplest sufficient seams; close with green focused checks.
3. **Checkpoint.** Before first review and after each fix, commit locally with the pull-request playbook's fixed commit template. Surface a signing failure as is, never bypassing it; warn once per ticket on an unsigned head to configure signing. Never run the full suite; `create-pr` runs the publication gate. A local commit is not an external effect; pushing is.
4. **Review.** Give a context other than the implementer's "Load the `code-review` skill", the checkpoint head, and agreed coverage lines with tracing; review against the ticket's fixed base. First and post-rebase reviews are full; others are corrective, receiving the last reviewed head and prior findings with state. Apply the scratch evidence gate here; Standards and Spec still report if Valuable Tests blocks. A blocked axis stops the ticket for the developer, except missing evidence the developer accepts, which continues through steps 5–6 to the handoff.
5. **Critique.** Load the `review-critique` skill and run it on the review report. Never ask the developer about ordinary findings between reviews; approvals, scope expansions, and accepted risks not already answered still stop immediately.
6. **Fix.** Apply only the accepted findings, in a fresh context other than the implementer's, rerun focused checks, checkpoint, and review again. A round makes at most two automatic review invocations; the second's accepted findings stay open. When it closes, take to the developer only the `user decision` and still-open accepted findings; show the rejected ones, which need no answer. A further fix the developer approves gets a fresh review of its own head.

For a Work Contract addition, scope expansion, deviation from binding authority or the prototype contract, or accepted risk, read [decision recording](references/decision-recording.md) before acting or publishing. Decision comments and an approved blocker closure are this skill's only external effects.

On cancellation, read [cancellation](references/cancellation.md) first.

When the ticket re-enters after its handoff (a stop, a red publication gate, feedback, or red CI), read [rounds](references/rounds.md) first.

## Output Contract

A prose handoff with:

- the ticket, branch, and base, plus the previous head and `create-pr`'s red-run count and last green pushed head on re-entry;
- the commit SHAs, the last being the head, and each reviewed head with its review report, the last equal to the head;
- a small table tracing each ticket requirement to its seam and cases, each case with RED and GREEN evidence, skipped with its reason, or under its behavior's recorded no-valuable-test-seam exception;
- the focused checks, with commands and results, and the publication gate pending, never green or integrated;
- each finding ID with its verdict and the critique's evidence or reason for it, the developer's answer where needed, and what was applied;
- the Work Contract with its sources and approval;
- decisions, deviations, accepted risks, and the approved issue comments;
- blockers or the cancellation point.

Complete only with green focused checks, every finding at a verdict, and the head's review report. Next: `create-pr` publishes the branch, and `qa-impact` runs on the pushed head; as a `direct` child, `implement-spec` integrates it instead.
