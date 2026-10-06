# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/tdd/SKILL.md>. Rubric material from <https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd>: `tests.md` and `mocking.md`. Consumer evidence reviewed at immutable `ilaos-website` revision `71529c277cfc4688f0ffdb5b7653e4b18c8dd9f2`: `.agents/skills/prepare-commit/SKILL.md`.

## Author or owner

Matt Pocock; consumer evidence owned by Grupo Ilao.

## License or terms

MIT. The consumer's Apache-2.0 artifact was evidence only; no protected expression from it was incorporated.

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

2026-08-31, from `mattpocock-skills` version 1.2.3 at commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`; consumer evidence reviewed from the local `ilaos-website` checkout on the same date. 2026-10-01, `tests.md` and `mocking.md` from `mattpocock-skills` at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, 75 commits after version 1.2.3.

## Material used

The upstream public-seam rule, independent expected values, anti-patterns, and vertical RED→GREEN tracer-bullet loop. Consumer evidence informed durable test-quality and final-quality boundaries. From `tests.md` and `mocking.md`: behavior through public interfaces, the implementation-coupled and tautological test patterns, verification through a side channel, and mocking only at system boundaries through narrow, operation-specific interfaces.

## Modifications

Grupo Ilao removed consumer-specific file and framework instructions; added approved-handoff and authority consumption, no-valuable-seam exceptions, reproducible evidence per behavior, explicit triangulation, and an uncommitted candidate-capture handoff. The frontmatter was normalized to this catalog. The `tests.md` and `mocking.md` material was rewritten in Grupo Ilao's words as `references/valuable-tests.md`, the rubric the review's Valuable Tests axis applies: code examples were removed, the patterns were grouped into three failure modes (tautological, structure-sensitive, and mocks that hide failure), the requirement that a doubled boundary has a test driving its failure path was added, and the deep-module argument for sturdier tests was added. The uncommitted candidate-capture handoff was removed, because the caller now commits locally. The `codebase-design` skill is loaded by name, under the existing seam-shape condition.

## Approval

Internal reuse under the MIT license was approved by the Issue #17 group specification. The `d81f3a1` material is approved through review of the pull request that introduces it.
