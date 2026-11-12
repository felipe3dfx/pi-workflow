# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/6acc160e4e0cd062dbbbd7a1b26ae92855edf07e/skills/engineering/tdd/SKILL.md>. Rubric material from <https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/tdd>: `tests.md` and `mocking.md`. Material from version 1.3.2 at <https://github.com/mattpocock/skills/tree/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering>: `tdd/SKILL.md` and `diagnosing-bugs/SKILL.md`. Consumer evidence reviewed at immutable `ilaos-website` revision `71529c277cfc4688f0ffdb5b7653e4b18c8dd9f2`: `.agents/skills/prepare-commit/SKILL.md`.

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

2026-08-31, from `mattpocock-skills` version 1.2.3 at commit `6acc160e4e0cd062dbbbd7a1b26ae92855edf07e`; consumer evidence reviewed from the local `ilaos-website` checkout on the same date. 2026-10-01, `tests.md` and `mocking.md` from `mattpocock-skills` at commit `d81f3a183412e71a5b1e84ca21bc1a35eea03a60`, 75 commits after version 1.2.3. 2026-11-01, `skills/engineering/tdd/SKILL.md` and `skills/engineering/diagnosing-bugs/SKILL.md` from `mattpocock-skills` version 1.3.2 at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`.

## Material used

The upstream public-seam rule, independent expected values, anti-patterns, and vertical RED→GREEN tracer-bullet loop. Consumer evidence informed durable test-quality and final-quality boundaries. From `tests.md` and `mocking.md`: behavior through public interfaces, the implementation-coupled and tautological test patterns, verification through a side channel, and mocking only at system boundaries through narrow, operation-specific interfaces. From version 1.3.2 `tdd/SKILL.md`: a one-line note per proposed seam on what it catches and what it misses. From version 1.3.2 `diagnosing-bugs/SKILL.md`, Phase 5 step 2: when a red is forced by mutating code or a fixture, diffing against a pristine copy to prove the mutation landed before trusting it.

## Modifications

Grupo Ilao removed consumer-specific file and framework instructions; added approved-handoff and authority consumption, no-valuable-seam exceptions, reproducible evidence per behavior, explicit triangulation, and an uncommitted candidate-capture handoff. The frontmatter was normalized to this catalog. The `tests.md` and `mocking.md` material was rewritten in Grupo Ilao's words as `references/valuable-tests.md`, the rubric the review's Valuable Tests axis applies: code examples were removed, the patterns were grouped into three failure modes (tautological, structure-sensitive, and mocks that hide failure), the requirement that a doubled boundary has a test driving its failure path was added, and the deep-module argument for sturdier tests was added. The uncommitted candidate-capture handoff was removed, because the caller now commits locally. The `codebase-design` skill is loaded by name, under the existing seam-shape condition. The seam agreement was extended with a coverage line per required behavior, traced to its requirement and listing pertinent success, state, limit, and rejection cases with their expected-value sources and planned evidence or exception, instead of upstream's agreement on seams alone, and a no-valuable-test-seam exception is recorded with its reason; the output marks each case tested, skipped, or excepted.

From version 1.3.2, the seam note on what it catches and misses joins the existing coverage line as an optional brief note, when useful, rather than a mandatory note per seam, a new document, or a gate, and what a seam misses never waives a required behavior or pertinent case. The pristine-copy check moves from upstream's bug-diagnosis regression step to this skill, which owns writing the test, because the local `diagnose-bug` establishes cause and does not own the fix: it applies only when code or a fixture is deliberately mutated to prove a test can fail, uses a disposable, isolated copy for both the mutation and the test, is no mutation-testing phase, and replaces neither the reproducible assertion RED nor the review's run against the fixed point.

Consumer evidence from a timed full run and a classification of the `ilaos-website` suite at immutable revision `91004c3266a0749dac6d06615a0dd54aba4a0493`, where tests in files using real transaction commits took most of the suite's time, added a fourth failure mode, cost out of proportion, and the rule that each pertinent case sits at the cheapest seam that observes it. The rubric now also says how changes without a seam of their own are tested: migrations and generated artifacts through the behavior they enable, removals through the retired behavior's tests, and templates through the view or flow that serves them; declaration snapshots, query plans, and timings joined the structure-sensitive tells.

## Approval

Internal reuse under the MIT license was approved by the Issue #17 group specification. The `d81f3a1` material is approved through review of the pull request that introduces it.
