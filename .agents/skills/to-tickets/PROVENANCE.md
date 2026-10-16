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

The reusable Spanish ticket structure is in `assets/ticket-template.md` and is
loaded only while drafting. Detailed publication authorization, mutation,
read-back, and failure-recovery steps are in `references/publication.md` and are
loaded for publication preparation or recovery.

## Modifications

Grupo Ilao replaced tracker-specific commands, labels, local-file tickets, and
conversation-driven exploration with a published-specification readiness gate,
complete coverage inventory, policy-gated reorganization, consumer/harness
ownership boundaries, native relationship proposals, concise Spanish ticket
drafts, and sequential verified publication with recovery.

The adaptation requires an observable final reference to the consumed
Definition Handoff without duplicating it. A material change or reconstruction
stops the prior plan, triggers a complete coverage re-audit and replacement
preview, and invalidates authorization for the replaced plan; unchanged,
still-equivalent confirmations remain valid. Every material operation follows
the consumer repository's recorded approval policy. `autonomous` may continue
only after the full replacement preview and all controls are current, and never
when user intent or risk acceptance is unresolved. A `partial failure` follows
any sent or possibly sent mutation request whose outcome or required read-back
cannot be verified, including a confirmed rejection. It stops at the last
verifiable frontier, reconciles from tracker evidence, re-audits full coverage,
invalidates the old plan, and prepares a complete replacement preview; it
resumes only under policy after controls pass. If reconciliation is unavailable,
it remains a `partial failure`; missing material must be reconstructed and
validated against current authority and tracker evidence before that same full
replacement flow. Preflight and capability failures before a mutation request
are `blocked`. The adaptation treats owner assignment as consumer policy;
routes definition findings to their owner as `restart recommended` for the user
to decide; and classifies implementation dependencies, external configuration,
and capability dependencies. Capability dependencies remain invocation
preconditions rather than tickets, tracker relationships, or durable state. It
reports a user's decision to proceed after a definition finding and its impact
in downstream handoff and completion output without altering the published
specification or original Definition Handoff. Publication verifies and reads
back create, update, move, and relationship mutations; it creates when no
equivalent exists and stops for multiple or conflicting matches.

It requires and verifies the parent in the handoff, hangs new, updated, and
confirmed-moved tickets with read-back in GitHub and Linear, and treats another
unconfirmed parent as a conflicting match.

It gives every in-scope requirement one accountable child with an observable
outcome and shows ownership boundaries and conceptual dependencies apart from
native relationships, which only publication creates. It reuses a prior
confirmation only within its exact scope; a material change invalidates
authorization and only the confirmations it touches. It consumes each
decision's resolver, source or authority, status, and accepted supersession
with what it replaced, keeping them traceable by pointer in existing
artifacts, with tickets citing implemented decisions' sources and verifying
them through acceptance criteria. Coverage, demo, estimate, implementation, and
QA remain separate evidence. A missing generated authority artifact alone does
not block once decisions are closed and readiness otherwise holds, and the gap
is reported; a present but malformed, stale, blocked, or conflicting one still
blocks. Genuine semantic, functional, or technical conflicts escalate to the
developer.

The skill is limited to product-ticket breakdown, its tickets' parent relationship, and handoff. It does not
rediscover or repair the upstream definition, impose owner policy, create
capture IDs or propagated hashes, maintain distributed workflow state, or
supersede the issue #16/group-spec authorities. The frontmatter was normalized
to this repository's required shape.

## Approval

Grupo Ilao approved internal reuse under the MIT license.
