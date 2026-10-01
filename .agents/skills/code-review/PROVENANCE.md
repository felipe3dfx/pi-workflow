# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/code-review/SKILL.md>.

## Author or owner

Matt Pocock.

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

2026-10-01, from `mattpocock-skills` at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, 75 commits after version 1.2.3.

## Material used

The review of a diff since a fixed point; separate axes run in parallel isolated contexts and reported side by side without merging or reranking; the Standards and Spec axis briefs; the smell baseline of twelve code smells from Fowler's _Refactoring_, chapter 3, as judgement calls overridden by repository standards; skipping what tooling enforces; and the closing per-axis summary line.

## Modifications

1. Frontmatter rewritten to this catalog's shape with a `Trigger:` description.
2. Placed inside the implementation loop: the fixed point is the ticket's base, or the production base for a parent integration branch reviewed against its specification, and the diff includes uncommitted changes. The report is handed to `review-critique` instead of the user.
3. Added the Valuable Tests axis, which applies the `tdd` skill's valuable-tests rubric and also reports a changed behavior with no test at its agreed seam.
4. Added team standards that ship with the skill, and moved them with the smell baseline, reworded, into `references/standards.md`. Repository standards are read from `docs/agents/coding-standards.md` and override both.
5. Removed spec discovery from commit messages and file searches; the ticket or specification is a required input, and its absence blocks the review.
6. Added stable per-axis finding IDs, the hard or judgement marking, `file:line` evidence, and blocked outcomes for an unresolved fixed point, an unreadable ticket or specification, and missing isolation. Removed harness-specific tool names and command lines.
7. Stated the read-only stance: the skill never fixes, comments, commits, or publishes.

## Approval

Internal reuse under the MIT license is approved through review of the pull request that introduces this record.
