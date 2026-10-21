# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement/SKILL.md>. Consumer evidence reviewed at immutable `ilaos-website` revision `71529c277cfc4688f0ffdb5b7653e4b18c8dd9f2`: `.agents/skills/review-feedback-triage/SKILL.md`.

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

2026-08-31, from `mattpocock-skills` version 1.2.3 at commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`; consumer evidence reviewed from the local `ilaos-website` checkout on the same date. 2026-10-01, from `mattpocock-skills` at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, 75 commits after version 1.2.3.

## Material used

The upstream loop at `d81f3a1`: `tdd` at pre-agreed seams, type checks and single test files run regularly with the full suite once before review, `code-review` once the work is built, and a commit of the work to the current branch. Consumer evidence informed the finding-disposition boundaries.

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

## Approval

Internal reuse under the MIT license was approved by the Issue #17 group specification. The `d81f3a1` material is approved through review of the pull request that introduces it.
