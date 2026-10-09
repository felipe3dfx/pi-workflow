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
2. Narrowed to exactly one approved child ticket in a fresh session, with blocked outcomes for an open native blocker, missing inputs, or a binding-requirement contradiction, and a branch proposed from the recorded parent integration branch.
3. Seams are agreed with the developer before the first test; no-valuable-test-seam exceptions are recorded.
4. The implementer reads the ticket, specification, and domain authority; coding standards are left to the review's Standards axis.
5. `code-review` runs in a context other than the implementer's against the ticket's base, followed by `review-critique`; only accepted or developer-accepted findings are applied, in a fresh context, and a second review runs only when a fix changes behavior.
6. The commit uses the repository's existing signing configuration and the fixed commit template, with no AI attribution.
7. Added developer-owned scope and risk, discretionary technical recommendations, selective prototype recovery, the developer-approved append-only Spanish issue comment, cancellation that preserves work, and the prose handoff to `create-pr` and `qa-impact`.
8. Each context that executes `tdd`, `code-review`, or `review-critique` loads it by name, with no link and no harness tool named, including the second review's context.
9. The handoff reports each case skipped at an agreed seam with its reason; `tdd` owns that a skip is never GREEN.
10. The seams step loads `tdd` and also agrees each required behavior's coverage line and traces every ticket requirement to one; the handoff carries that tracing as a small table, each case tested, skipped, or excepted, and each review receives the coverage lines with their tracing.
11. The full suite moves from upstream's single run before review to the commit step, run until green with red fixed as in the fix step, including its second review when a fix changes behavior, unless the child integration mode is `direct`; there the handoff names it pending, and `implement-spec` runs it on the merged tree, as ADR 0026 records.
12. Re-entry runs a red gate's failing checks until green, and its handoff re-traces each sibling coverage line the resolution changes.

## Approval

Internal reuse under the MIT license was approved by the Issue #17 group specification. The `d81f3a1` material is approved through review of the pull request that introduces it.
