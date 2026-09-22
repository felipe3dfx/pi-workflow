# Skill Provenance

## Source

`https://github.com/mattpocock/skills`, skill `skills/engineering/codebase-design`, distributed as the `mattpocock-skills` package version 1.2.3.

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

`SKILL.md` in full: the glossary, the deep-versus-shallow contrast, the principles, the testability guidance, the relationships, and the rejected framings. `DEEPENING.md` and `DESIGN-IT-TWICE.md` in full.

## Modifications

1. Frontmatter rewritten to this repository's normative seven-line shape. The upstream `description` is 265 characters and the catalog caps it at 250, so the middle enumeration was shortened while the opening and the closing clause were kept.
2. Added the principle **"Prefer the highest useful existing seam"**, with its definition of highest and useful. This is Grupo Ilao material and appears in no upstream file. `references/DEEPENING.md` points at it under seam discipline rather than restating it, so the two documents cannot drift into different rules.
3. Added a `Precedence` section: the vocabulary never yields, a concrete recommendation yields to the consumer's recorded decisions, and a contradiction is surfaced rather than silently overridden. The surfacing wording follows the pattern upstream uses in its `domain-modeling` skill.
4. `DESIGN-IT-TWICE.md` rewritten. Upstream prescribes spawning three or more parallel sub-agents and gives each a prompt. The adaptation states what must be established — several radically different interfaces, each authored in a fresh context that cannot see the others, compared on depth, locality, and seam placement, closing with an opinionated recommendation — and names parallel isolated agents as one way to satisfy it. A shared skill in this catalog may not name one execution mechanism as universal. The sentence pointing at the document from `SKILL.md`'s `Going deeper` is shortened for the same reason: upstream reads "spin up parallel sub-agents to design the interface several radically different ways", the adaptation reads "design the interface several radically different ways".
5. Code examples translated from TypeScript to Python.
6. `DEEPENING.md` dependency category 2 rewritten with Python-ecosystem stand-ins in place of PGLite.
7. `DEEPENING.md` and `DESIGN-IT-TWICE.md` moved to `references/`, with internal links updated.
8. `agents/openai.yaml` not carried over. It is a distribution-channel manifest, and in this catalog no manifest is a source.
9. `Rejected framings` generalised from "the TypeScript `interface` keyword" to "a language's `interface` keyword".
10. Editorial formatting normalised without changing meaning: punctuation follows this repository's prose style, the two ASCII diagrams carry a `text` fence language, and single-asterisk emphasis is written with underscores.

## Delta completeness

The numbered list exhaustively records substantive transformations from the pinned upstream revision. Entry 10 groups meaning-preserving editorial normalization; those differences are intentionally not tracked line by line.

## Approval

Reviewed and approved for internal use by Felipe Gonzalez on 2026-08-24. Upstream is MIT and this catalog is MIT, so the material is redistributed under the same terms with the notice above preserved.
