# Skill Provenance

## Source

<https://github.com/grupo-ilao/skills/issues/15>

## Author or owner

Grupo Ilao

## License or terms

MIT

## Notice

MIT License

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

2026-08-26, issue #15 as retrieved from the Grupo Ilao skills repository;
2026-10-16, issues #140 and #163.

## Material used

The `feature` ownership boundary, progressive discovery loop, required feature
brief fields, shared-capability comparison and invariant requirements,
prototype handoff, definition-cycle invalidation rule, and review handoff from
issue #15.

## Modifications

Grupo Ilao transformed the issue's workflow specification into a direct,
agent-agnostic skill contract. The material was organized as activation,
authority, discovery, brief, and output sections; it defers prototype,
adversarial review, technical synthesis, domain authority, and ADR lifecycle
to their designated owners rather than duplicating their responsibilities.
Under issue #140, the handoff targets `feature-critic`, which the developer
may also invoke earlier, and the loop takes its findings back, asking the
developer for each disposition, recording it, and applying only accepted
adjustments as brief deltas. Under issue #163, the simplification that
`feature-critic`'s scope and proportionality lens proposes is presented to the
developer as a question of its own, separate from the other dispositions.

Under issue #165, approvals with no pull-request playbook block and point to `setup-workflow` instead of linking its shipped rules.

Version 2.0 moves the discovery loop's interview rules (one question per
round, sources shown, evidence-grounded recommendation, decisions recovered
before asking) into the new `grilling` skill. `feature` now loads `grilling`
only when the problem, user, or outcome cannot be recovered, an important
choice is open, a material conflict remains, or the developer asks for a
stress test, and proposes its returned decisions as a brief delta whose
acceptance closes the interview. Product discovery, authority and approval
contracts, brief deltas, and prototype ownership are unchanged. The major version marks the new required install dependency:
consumers that install `feature` must also install `grilling`. The issue #15
material above remains the unchanged internal original source; no Matt Pocock
material was copied into `feature`, and the upstream `grilling` material is
recorded in that skill's own provenance.

1. Version 2.1 moves the critic disposition class rules verbatim from
   `feature-critic` into step 7 of the discovery loop: a blocker closes only
   when corrected, a warning when corrected or with the developer's explicit
   `risk accepted` recorded with who, why, and source, an informative finding
   when `accepted` or `rejected` with a reason, and a disputed finding returns
   to its lens and is recorded `withdrawn` when withdrawn. The rules are
   unchanged in meaning; ownership of their application moves to `feature`,
   which already owns disposition. The generic "generated authority artifact"
   becomes the Domain Authority Handoff, since no skill produces the read-only
   authority review, so the only authority artifact `feature` admits is the Domain Authority Handoff; its absence stays the one
   admissible gap.

## Approval

Internal reuse under the MIT license was approved through Grupo Ilao skills
issue #15.
