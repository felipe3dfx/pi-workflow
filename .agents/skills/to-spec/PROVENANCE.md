# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/to-spec>

## Author or owner

Matt Pocock

## License or terms

MIT

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

2026-08-26, at commit `885e2ca4d842d139e9aef4e48d366c63cb1b8013`.

## Material used

The activation boundary, synthesis-oriented technical-specification structure,
test-seam guidance, prototype-decision treatment, and publication-oriented
handoff from the upstream `SKILL.md`.

## Modifications

Grupo Ilao replaced conversation-only synthesis and direct tracker publication
with structural readiness validation, the feature-critic gate, an
execution-scoped current package and review handoff, explicit ownership
returns, and orchestrator-owned publication. It added readiness and publication
rules, consumer-authority boundaries, shared-capability invariants, verified
publication of both artifacts before `PUBLISHED`, and the ticket-slicing
handoff contract. The frontmatter was normalized to this repository's required
shape.

In GitHub and Linear, the skill publishes or reuses the specification's parent
ticket with preflight, preview, read-back, and `PUBLISHED` over three artifacts;
hands the parent to `to-tickets`; and loads `codebase-design` by name.

Under issue #165, approvals with no pull-request playbook block and point to `setup-workflow` instead of linking its shipped rules.

## Upstream review

2026-11-01: reviewed [`mattpocock-skills` v1.3.2](https://github.com/mattpocock/skills/tree/d1478fcb140db0b93c0c8df17bcfd311844749d0/skills/engineering/to-spec) at commit `d1478fcb140db0b93c0c8df17bcfd311844749d0`. This is the reviewed reference, not a replacement for the adopted source revisions above.

No upstream skill changes since the source revision. Preserve the local readiness, synthesis, and publication handoff contracts. No runtime material imported; the skill version is unchanged.

## Approval

Grupo Ilao approved internal reuse under the MIT license.
