# Skill Provenance

## Source

`https://github.com/mattpocock/skills`, skill `skills/productivity/grilling/SKILL.md`, release `v1.3.2`. The interview rules that `feature` 1.5 carried in its discovery loop are a second, internal source.

## Author or owner

Matt Pocock for the upstream skill; Grupo Ilao for the `feature` 1.5 interview rules.

## License or terms

MIT

## Notice

MIT License

Copyright (c) 2026 Matt Pocock

Copyright (c) 2026 Grupo Ilao

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

2026-11-01, from release `v1.3.2` at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`; `LICENSE` read at the same commit. The internal rules come from `feature` 1.5 at commit `a0a49d1` of this repository.

## Material used

From upstream `SKILL.md`: the relentless interview toward shared understanding; asking only questions whose prerequisites are settled; a recommended answer for every question, worded so "yes" accepts it; the agent finding facts while the user makes decisions; and ending when nothing scoped is left silently assumed. The upstream `agents/openai.yaml` was not used.

From `feature` 1.5: recovering resolved decisions from existing artifacts before asking, showing each question's sources, grounding the recommendation in available evidence, and keeping unanswered assumptions open.

## Modifications

1. Frontmatter rewritten to this repository's normative shape with a `Trigger:` description; Matt Pocock is recorded above as the source author.
2. Added an activation contract that limits the skill to a scoped decision interview for a caller or the user, leaving discovery, the brief, critique, approvals, acceptance, and glossary and ADR changes with their owners.
3. Upstream asks the whole frontier in numbered rounds; this skill asks one question per turn and shows evidence, sources, and tradeoffs with the recommendation, or asks for missing intent or information when evidence supports no recommendation. The round format block was removed.
4. The named design tree and frontier became ephemeral working reasoning that follows only the branches the scope needs, rather than every branch.
5. Upstream dispatches a sub-agent with a fresh context for each fact; this skill states only that the agent researches discoverable facts before asking, leaving the mechanism to the harness.
6. Added the reuse of decisions that supplied authoritative artifacts resolve, reopened only on new material evidence, a dependent change, or the user's request.
7. Upstream ends when the frontier is empty and waits for the user to confirm shared understanding before acting; this skill also stops when needed input is unavailable, records each unsettled decision as an open blocker, returns exact decisions with reasons, consequences, and sources, and leaves acceptance to the caller instead of a separate confirmation round.

## Approval

Internal reuse under the MIT license is approved through review of the pull request that introduces this record.
