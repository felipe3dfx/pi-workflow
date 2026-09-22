# Skill Provenance

## Source

<https://github.com/mattpocock/skills/tree/885e2ca4d842d139e9aef4e48d366c63cb1b8013/skills/engineering/to-tickets>

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

The ticket-slicing boundary, independently demonstrable vertical-slice rule,
dependency ordering, user review before publication, and tracker relationship
concepts from the upstream `SKILL.md`. Issue #16 and
`docs/specs/issue-16-group-spec.md` are derived implementation authorities for
this adaptation; they are not additional upstream sources.

## Modifications

Grupo Ilao replaced tracker-specific commands, labels, local-file tickets, and
conversation-driven exploration with a published-specification readiness gate,
complete coverage inventory, user-approved reorganization, consumer/harness
ownership boundaries, native relationship proposals, concise Spanish ticket
drafts, and sequential verified publication with recovery.

The adaptation requires an observable final reference to the consumed
Definition Handoff without duplicating it; binds explicit publication
authorization to the final preview's complete handoff reference; and treats a
material handoff change as an authorization invalidation that stops publication,
re-audits coverage, produces a substitute preview, and requires new explicit
authorization. It treats owner assignment as consumer policy; routes definition
findings to their owner as `restart recommended` for the user to decide; and
classifies implementation dependencies, external configuration, and capability
dependencies. Capability dependencies remain
invocation preconditions rather than tickets, tracker relationships, or durable
state. Publication binds a user-approved final preview to its listed effects. As a substantive transformation, it defines the publication-failure boundary at the mutation request: `blocked` means publication cannot proceed and no mutation request was sent, so preflight, handoff, and capability failures can block without tracker evidence. `partial failure` begins once a mutation request was sent or may have been sent, including when it is later confirmed rejected or its result or required read-back cannot be verified. Every `partial failure` stops at the last verifiable frontier, reconciles when tracker evidence becomes available, invalidates authorization, produces a complete substitute preview from the reconciled state, and requires new explicit authorization before resuming; if reconciliation is unavailable, it remains a `partial failure` and does not resume. It explicitly records a user's decision to proceed after a
definition finding and that decision's impact in the handoff and completion
output. Publication verifies and reads back create, update, move, and
relationship mutations; it creates when no equivalent exists and stops for
multiple or conflicting matches.

The skill is limited to product-ticket breakdown and handoff. It does not
rediscover or repair the upstream definition, impose owner policy, create
capture IDs or propagated hashes, maintain distributed workflow state, or
supersede the issue #16/group-spec authorities. The frontmatter was normalized
to this repository's required shape.

## Approval

Grupo Ilao approved internal reuse under the MIT license.
