# Skill Provenance

## Source

`https://github.com/mattpocock/skills`, skill `skills/productivity/writing-for-agents`, distributed as the `mattpocock-skills` package version 1.2.3.

## Author or owner

Matt Pocock.

## License or terms

MIT

## Notice

MIT License

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

2026-08-24, from `mattpocock-skills` version 1.2.3 at commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`.

## Material used

`SKILL.md` in full: the two loads, the information hierarchy, splitting, leading words, context pointers, and the negation guidance. `SKILL-MECHANICS.md` in full.

## Modifications

1. Frontmatter rewritten to this repository's normative shape. The upstream description carries no `Trigger:` prefix and names no vocabulary, so it was rewritten to front-load both; `metadata.author` records this repository's catalog owner, and Matt Pocock is recorded above as the source author.
2. Added a `Precedence` section: the vocabulary and the levers never yield, while repository policy governs location, frontmatter, licensing, provenance, and the word budget, and decides any specific rule the two disagree on.
3. The upstream body is 1,777 words against this repository's 1,000-word body maximum, which the validator enforces. Instead of claiming the style guide's all-reference exemption, the body keeps the material every branch needs (context pointers, the two loads, the information hierarchy and progressive disclosure) and discloses the rest behind a pointer list that names the branch for each file: `Steps and completion criteria` and `When to split` moved to `references/STEPS-AND-SPLITTING.md`; `Leading words` with its negation guidance moved to `references/LEADING-WORDS.md`; the co-location and sprawl paragraphs with the `Pruning` list moved to `references/PRUNING.md`. The pointer to `SKILL-MECHANICS.md` joined that list, and its sequence-cut cross-reference was repointed to `STEPS-AND-SPLITTING.md`. Each new file opens with a title and a line naming its branch. The body is now 787 words.
4. `SKILL-MECHANICS.md` moved to `references/` per this repository's layout, and the two internal links repointed. A title heading was added because the upstream file opens without one and this repository's Markdown gate requires it.

## Delta completeness

The instructional content is adopted verbatim. Every change above is structural or is repository policy; moved passages keep their upstream wording, and no lever, definition, or recommendation was altered, added, or removed.

## Approval

Adopted on 2026-08-24 by Felipe Gonzalez.
