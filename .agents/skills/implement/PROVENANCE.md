# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement/SKILL.md>. Ticket-reference material from <https://github.com/mattpocock/skills/tree/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/implement/SKILL.md>. Consumer evidence reviewed at immutable `ilaos-website` revision `71529c277cfc4688f0ffdb5b7653e4b18c8dd9f2`: `.agents/skills/review-feedback-triage/SKILL.md`.

## Author or owner

Matt Pocock; consumer evidence owned by Grupo Ilao.

## License or terms

MIT. The consumer's Apache-2.0 artifacts were evidence only; no protected expression from them was incorporated.

## Notice

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Retrieved

2026-08-31, from `mattpocock-skills` version 1.2.3 at commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`; consumer evidence reviewed from the local `ilaos-website` checkout on the same date. 2026-10-01, from `mattpocock-skills` at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, 75 commits after version 1.2.3. 2026-11-01, `skills/engineering/implement/SKILL.md` from `mattpocock-skills` version 1.3.2 at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`.

## Material used

The upstream loop at `d81f3a1`: `tdd` at pre-agreed seams, type checks and single test files run regularly with the full suite once before review, `code-review` once the work is built, and a commit of the work to the current branch. Consumer evidence informed the finding-disposition boundaries. From version 1.3.2: fetching a supplied ticket reference from the issue tracker and stating its title before starting, and asking when the reference is ambiguous.

## Modifications

1. Frontmatter rewritten to this catalog's shape with a `Trigger:` description; model invocation is allowed.
2. Narrowed to exactly one approved ticket in a fresh session, a Child Ticket or a Standalone Ticket, with blocked outcomes for an open native blocker, missing inputs, an insufficient Work Contract, or a binding-requirement contradiction; a Child Ticket's branch is proposed from its parent's integration branch and a Standalone Ticket's from the recorded working base, as `references/work-contract.md` defines.
3. Seams are agreed with the developer before the first test; no-valuable-test-seam exceptions are recorded.
4. The implementer reads the ticket, its specification when one exists, and the domain authority, and builds the ticket's Work Contract before the seams: each element traced to its source, gaps investigated before asking, the contract approved under the approval policy, and any addition published as an approved Spanish issue comment, with regression scenarios kept in `references/behavioral-scenarios.md`; coding standards are left to the review's Standards axis.
5. `code-review` runs in a context other than the implementer's against the ticket's base, followed by `review-critique`; only accepted or developer-accepted findings are applied, in a fresh context, and each fix round ends in a corrective review.
6. The commit uses the repository's existing signing configuration and the fixed commit template, with no AI attribution.
7. Added developer-owned scope and risk, discretionary technical recommendations, selective prototype recovery, the developer-approved append-only Spanish issue comment, cancellation that preserves work, and the prose handoff to `create-pr` and `qa-impact`.
8. Each context that executes `tdd`, `code-review`, `review-critique`, or `diagnose-bug` loads it by name, with no link and no harness tool named, including the second review's context.
9. The handoff reports each case skipped at an agreed seam with its reason; `tdd` owns that a skip is never GREEN.
10. The seams step loads `tdd` and also agrees each required behavior's coverage line and traces every ticket requirement to one; the handoff carries that tracing as a small table, each case tested, skipped, or excepted, and each review receives the coverage lines with their tracing.
11. The full suite leaves the loop: upstream's single run before review is dropped, the build and fixes run focused checks on the touched area plus affected callers and consumers through the quality playbook's Focused Validation path, a consumer with no focused path blocks and is pointed to `setup-workflow`, and the handoff names the full suite pending for `create-pr`, which runs it before every push, as ADR 0027 records.
12. Re-entry runs the failing checks until green, and its handoff re-traces each sibling coverage line the resolution changes; re-entry moves to `references/rounds.md`, read when a ticket comes back after its handoff.
13. After GREEN, one simplification pass runs in the implementer's context; a signed checkpoint commit precedes the first review and follows each fix round; reviews after the first are corrective unless a rebase intervenes; a round makes at most two automatic review invocations, and only `user decision` findings and accepted findings still open reach the developer when it closes; a blocked review axis is an accepted risk, as ADR 0027 records.
14. A red full run or developer feedback returned by `create-pr`, and red CI the change caused after publication, open a new round in `references/rounds.md` that runs the same loop with its own cap, includes the failing checks among its focused checks, never weakens a test, and records each developer decision in an append-only comment before the next review or push.
15. A ticket that reports a defect whose root cause neither it nor its specification establishes loads `diagnose-bug` on the ticket's branch while the Work Contract is built, before step 1, as `references/work-contract.md` defines: the proven root cause and reproduction join the contract traced to the defect diagnosis, not as an addition, every diagnosis step that needs the developer, the first human-in-the-loop run or its rerun, is a question even under `autonomous`, returned to `implement-spec` when implement runs as its child, the developer runs any `git bisect` over a human-in-the-loop loop whole, also under `autonomous`, the loop's files are removed before the step 3 checkpoint commit, step 1 proposes the regression seam, a blocked diagnosis blocks the ticket, and a ticket that states its root cause or reports no defect is unchanged.
16. A review report the developer brings into a round counts as that round's `code-review` output and goes through `review-critique`; a finding identical to one already judged keeps its verdict, as ADR 0029 records.
17. A child of `implement-spec` creates its own signed checkpoints and returns each committed SHA with its evidence; a harness that cannot authorize the checkpoint commit blocks the child, which reports the missing capability and never hands the checkpoint to the parent. The child rules move to `references/child-run.md`.
18. The handoff carries, with each finding's verdict, the critique's evidence or reason for it, so `implement-spec`'s findings register can copy it.
19. The handoff names the publication gate pending instead of the full suite: `create-pr` runs the gate the quality playbook declares before every push, Full Validation or checks chosen by the change's impact, and a red gate of any class opens a new round whose focused checks include the checks that failed, as ADR 0030 records.
20. `create-pr` selects the publication gate by the change's impact for every consumer, with no declaration in the quality playbook, as ADR 0031 records.
21. The handoff carries `create-pr`'s last green pushed head with its class, so the next round's publication gate measures from it, as ADR 0033 records.
22. Under issue #165, approvals with no pull-request playbook block and point to `setup-workflow` instead of linking its shipped rules.

23. Scoped prerequisites to their execution phase: discover and report future limitations, but unsupported Scratch Evidence does not block Seams, Build, or Checkpoint when their own prerequisites hold. Its mandatory gate remains at Review; Standards and Spec still report when Valuable Tests blocks, and the ticket stops for the developer's risk decision. Earlier progress or a request to ignore the gate never bypasses it. This developer-selected phase policy preserves focused validation, signed checkpoints, independent review, candidate identity, and scratch isolation; regression scenarios record the boundary.

24. A Review axis blocked on missing evidence asks the developer once to accept the risk and continue to the handoff, or stop; an explicit earlier instruction to publish without more review is that answer, the acceptance holds for the ticket while its cause is unchanged, and it goes through the existing accepted-risk comment and handoff. A one-time notice before step 1 announces the block when Scratch Evidence is unsupported; the rule set moves to `references/missing-evidence.md`. Acceptance never covers a hard finding without a verdict, a missing review report for the head, red focused checks, the publication gate, or a candidate identity that changed during the scratch runs. Signing is no longer required: git applies the repository's configuration, an unsigned head gets one warning per ticket, and a signing failure is surfaced, never bypassed, as ADR 0035 records. The cancellation rule moves to `references/cancellation.md` and prototype recovery to `references/work-contract.md`.

25. The version 1.3.2 ticket-reference step was adapted: the supplied reference is resolved through the consumer's confirmed tracker, and the canonical identifier, title, and repository or project, not the title alone, are shown before the branch is created or the run starts. Showing them is no confirmation or approval gate; a unique ticket continues. An ambiguous reference gets one focused question, never a guess, while a request naming more than one ticket stays blocked; regression scenarios record the three cases. Fresh tracker reads and loading skills by name, with no harness tool named, are unchanged. Applying writing-for-agents' information hierarchy, the unchanged conditional comment-publication rules move to `references/decision-recording.md`, reached by a runtime pointer naming every decision branch and requiring the read before acting or publishing. The universal external-effects boundary stays inline, so ordinary runs and blocker closures read it without taking a decision branch. Other existing wording, including the local-commit effect distinction, stays unchanged; no obligation, authority source, gate, or handoff field was removed.

26. Tracker comments carry only events that change the ticket's promise: a scope change, including a Work Contract addition, a deviation, or an accepted risk. A rejected hard finding is no longer a publishable event; knowingly breaking a binding standard is published as an accepted risk, and rejecting a finding that cites a binding requirement as a deviation. A round publishes only those events instead of every developer decision, and every other decision stays in the commit body. Each comment follows the tracker playbook's comment shape, naming the affected acceptance criterion in the ticket's own wording, as ADR 0036 records.

27. Under issue #222, each context that uses the ticket reads it fresh from the tracker once, and this run passes each delegated context the ticket's identifier instead of its content. A scope note still never substitutes for the ticket.

28. The completion line requires the requirement-tracing table and every finding rejected, applied, or decided by the developer, so `implement` owns the one definition of a complete handoff that `implement-spec` checks. The references point at `references/decision-recording.md` for the issue-comment rule instead of `SKILL.md`, and the round reference drops its restated copy of that rule.

## Approval

Internal reuse under the MIT license was approved by the Issue #17 group specification. The `d81f3a1` material is approved through review of the pull request that introduces it.
