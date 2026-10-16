# Skill Provenance

## Source

<https://github.com/grupo-ilao/ilaos-website/blob/798a8785a036b75afcdaaf0730dce4b0de6bf2eb/.agents/skills/review/SKILL.md>, the `review` skill of the `ilaos-website` repository.

## Author or owner

Grupo Ilao.

## License or terms

MIT. Grupo Ilao owns the source skill, declared Apache-2.0 there, and relicenses this derived material under MIT, the catalog's license.

## Notice

Copyright (c) Grupo Ilao

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Grupo Ilao modified the source material to produce this skill, as recorded under Modifications.

## Retrieved

2026-10-16, from `grupo-ilao/ilaos-website` at commit `798a8785a036b75afcdaaf0730dce4b0de6bf2eb`, source skill version 2.3.

## Material used

The review of a whole pull request along independent axes that must not hide one another; the in-scope correctness and Standards / design quality axes; tracing behavior beyond the diff to callers and sibling paths that share an invariant; grouping confirmed instances of one problem into one finding; the Spanish review comment structure (`Qué cambia`, `Spec / ajuste al problema`, `Standards / calidad de diseño`, `Bloqueantes`, `Advertencias`, `Qué está bien`) with what fails, why, and how to resolve it; the later-round rule of listing resolved findings first and classifying the rest as not resolved, partially resolved, introduced by a fix, genuinely new, or pre-existing and missed by the earlier review; and confirming the drafted review with the user before posting.

## Modifications

1. Frontmatter rewritten to this catalog's shape with a `Trigger:` description.
2. Removed the consumer-specific material: the temporary worktree commands, the tracker key pattern, the delegation table to framework skills, the Django and Python heuristics, the size heuristic, the security pass, and the scope-audit and promotion-readiness dependencies. Sources resolve from the repository's `docs/agents/` playbooks when present, else its root instruction file and documentation, assuming no provider, tracker, language, or branch.
3. Removed the CI axis and the CI section: the skill never runs or validates tests and adds no disclaimer about not running them; tests are read as evidence only.
4. Added the Decisions axis, which presents new or modified decision records and significant departures with their documented justification, benefits, costs, risks, and consequences for human judgment, without inventing motivations or treating a departure as a defect, and the Important decisions section.
5. Added a critique pass over all three axes that keeps, reclassifies, or discards each finding with its reason, rejects hypothetical demands, keeps supported rare risks, recovers prior decisions and critiques when available, and keeps important decisions visible; discarded findings are listed with their reason.
6. Restricted the verdict to `APPROVE` or `REQUEST_CHANGES`, removing `COMMENT`; a blocked review emits no verdict.
7. Separated drafting from publication: the run ends with the draft, the human reviewer may reclassify and edit it, and publication uses the repository's existing review capability under its approval policy and approval preview.
8. Later rounds read the delta since the previously reviewed head and the code it affects, never reopening unchanged code; a pre-existing miss is acknowledged and judged on its own evidence.
9. Standards come from the `code-review` team standards and smell baseline, overridden by the repository's own standards.
10. Added the run-read comment format and a maintainer reference with two worked rounds.
11. Replaced the fixed Spanish review with the language the user asks for, else the one the repository sets, else the pull request's; section headings and later-round tags are defined by meaning and written in that language.
12. Under issue #163, the critique closes with `review-critique`'s Simplification Trade, added to the draft for the human reviewer, and the description names the re-review of an updated pull request as a trigger.

## Approval

Relicensing under MIT and internal reuse are approved through review of the pull request that introduces this record.
