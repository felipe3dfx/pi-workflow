# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement-spec/SKILL.md>. Grupo Ilao pilot evidence: `docs/research/implement-spec-pilot.md` in `grupo-ilao/skills`, which delivered one consumer specification of four tickets through `implement` and per-child pull requests.

## Author or owner

Matt Pocock; pilot evidence owned by Grupo Ilao.

## License or terms

MIT.

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

2026-10-01, from `mattpocock-skills` at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`. Pilot evidence recorded on 2026-10-02.

## Material used

The upstream orchestration at `d81f3a1`: the tickets read as a task graph with a frontier of ready tickets, one implementer per ticket on its own branch started from the integration branch, parallel implementers where the frontier allows, each finished ticket merged into a single integration branch, the frontier recomputed after each merge, and one `code-review` of the integration branch once every ticket is complete. Also `docs/engineering/implement-spec.md` (the base check and the review-loop FAQ) and `.agents/invocation.md` (naming a skill does not load it), both at `d81f3a1`.

## Modifications

1. Frontmatter rewritten to this catalog's shape with a `Trigger:` description; model invocation is allowed.
2. Applies only when the consumer records `direct` child integration; in `pull-request` mode each child goes through `implement` and `create-pr`.
3. Each ticket runs through `implement` rather than `tdd` alone, so seams, review, critique, fix, and the signed local commit stay under that skill's contract.
4. One developer-approved, conditional batch rule replaces per-ticket approvals; every substantive per-ticket decision still stops that ticket, while independent siblings continue, and goes to the developer.
5. Each child merges locally with `--no-ff`, the full gate runs on the merged tree before the signed, template-conforming merge commit, and a conflict or red gate is aborted and reported, never resolved silently.
6. Integration is idempotent by the ticket identifier in the merge commit's `Refs:` footer, and the frontier is recomputed from the parent's history and the tracker.
7. Closing a child ticket on integration is an effect of the approved batch rule; readying or closing the specification and its parent stays manual, replacing the upstream ready-marking and resolution step.
8. After the parent review, `review-critique` judges findings, accepted fixes land as signed commits in a fresh context, publication goes through `create-pr`'s parent publication handoff, and `qa-impact` runs on the pushed head. The upstream exploration subagent, closing-keyword draft pull request, and worktree cleanup are left to the harness or dropped.
9. Each context that executes a composed skill loads it by name, with no link and no harness tool named, instead of upstream's tool-call wording; each child branch starts from the current parent head, and on resume one without that head is recreated only when it has no commits of its own, otherwise the ticket stops for the developer; the parent review re-runs all three axes only after a behavior-changing fix, otherwise the Spec axis alone, for at most two fix rounds, then the developer decides.
10. A stopped ticket re-enters by rebasing its child branch onto the current parent head in a fresh `implement` context, instead of upstream's implementer merging the integration tip into its branch so the merge fast-forwards; this keeps one `--no-ff` merge commit per ticket with a linear child history.
11. A child's handoff integrates with green focused checks; the merged-tree gate is its full suite, replacing upstream's full-suite run inside each implementer, as ADR 0026 records.
12. The parent review's Valuable Tests axis gets each requirement's latest tracing line across the tickets' handoffs, and every re-review runs with the same tables.

## Approval

Internal reuse under the MIT license is approved through review of the pull request that introduces it.
