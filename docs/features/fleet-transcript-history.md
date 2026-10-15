# Feature brief: Fleet transcript and history

Status: Functional definition; not yet reviewed.

## Problem and outcome

The operator needs to audit every child session through its transcript,
not a generated summary. Fleet must distinguish ongoing work from history
and retain that history when the same parent session is reopened.

Business intent belongs to the operator. Canonical terminology remains
owned by GLOSSARY.md and applicable ADRs.

## Approved scope

- Show only children belonging to the currently open parent session.
- Open transcripts inside Fleet, with scrolling and live updates.
- Preserve received instructions, messages, tool calls and tool results.
- Follow the main Pi session's collapse/expand behavior to reduce noise
  without replacing retained content with summaries.
- Separate En curso (queued, running, waiting) from Historial (completed,
  failed, cancelled, timed out, and interrupted historical records).
- Preserve codemode Group identity within both sections. A Group with
  working and terminal children may appear in both sections.
- Retain history for the parent session's lifetime, without automatic
  pruning by age or count.
- After reload or reopening, show unfinished executions as interrupted.
  Never automatically restart or resume them.
- Keep children with missing or corrupt transcripts visible when their
  identity is available; show incompleteness and recoverable evidence.
- Capture failure must not abort, cancel or steer the child. The agent
  continues while Fleet clearly reports incomplete history.

## Architecture boundary

Keep the existing in-process Pi SDK execution model and its current
child tools and shared file-mutation coordination. RPC migration is
outside this feature's scope. ADR 0016 remains authoritative.

Use asynchronous persistence and on-demand history access/rendering.
Do not copy the synchronous research spool into production.

Opening history and expanding visible content must not require parsing
or laying out all retained history. Bound resident work by entries and
bytes without silently pruning stored evidence. Large content must remain
accessible through an appropriate bounded presentation.

No storage format, queue capacity, timing target or arbitrary-size
guarantee is selected by this brief.

## Scenarios and errors

1. During execution, the operator follows or scrolls a child's transcript.
   Historical inspection must not lose its position because another
   child emits output.
2. When execution ends, its record moves to Historial while preserving
   its identity, Group and transcript.
3. Reopening the parent restores its historical records for inspection,
   without reconstructing executable child sessions.
4. Interrupted capture preserves available evidence and clearly
   distinguishes incomplete history from a completed capture.
5. Authoritative final messages replace their partial representation;
   they must not duplicate transcript content.
6. Storage or index failure degrades auditing, not agent execution.
   Warning details must distinguish live observations from durable facts.

If storage fails before any child identity can be saved, rediscovery
cannot be guaranteed from that storage alone. Do not invent persisted
identity, error details or complete-history claims.

## Decisions and authority

Resolver: the operator.
Source: explicit approvals in the feature-discovery conversation.
Status: approved through acceptance of this brief.

Durable Fleet visibility supersedes the earlier session-only visibility
boundary in the child-session capabilities feature. It does not
supersede the rule that reload ends working children.

“Interrupted” presents an Interrupted child record, not a new Run state.
A known terminal Run state remains authoritative even when its transcript
is incomplete. Capture health does not determine execution state or Verdict.

Domain authority: GLOSSARY.md and accepted ADRs. No generated Domain
Authority Handoff for this feature was identified. The glossary supplies
the resolved terminology.

## Shared capabilities and evidence

Reuse the child-session core, Fleet overlay, codemode Group identity,
Pi transcript conventions, child tools and shared mutation queue.

Sources:
- docs/features/child-session-capabilities.md
- docs/specs/child-session-capabilities.md
- docs/adr/0014-in-process-children-carry-the-parent-risk.md
- docs/adr/0016-claude-bridge-for-child-sessions.md
- extensions/child-sessions.ts
- extensions/children-view.ts

Gentle-shell is a comparison, not an architecture to copy. Its issue
606 and PR 609 document responsiveness motivations for RPC plus bounded
updates; its finish-only history does not establish interrupted capture.

Prototype disposition: reference-only for all four research directories:
- .agents/prototypes/fleet-history-comparison/
- .agents/prototypes/fleet-bounded-capture/
- .agents/prototypes/fleet-integrated-history/
- .agents/prototypes/fleet-resilient-capture/

Evidence supports bounded history access, incremental capture and
agent-independent capture failure handling. It does not prove full Pi UI
parity, production responsiveness, arbitrary-size bounded memory or
power-loss durability. No prototype is an implementation base or an
Approved Prototype UI Contract.

## Remaining design work and review handoff

Canonical interrupted-history and incomplete-transcript terminology is
resolved in GLOSSARY.md.
Technical synthesis must define asynchronous capture, overload/loss
boundaries, indexing and repair, warning durability, and message slicing.

Validation must cover real concurrent streams, large content, scrolling
and expansion, lifecycle interruptions and storage failures. Distinguish
received, queued and written evidence; do not equate write acknowledgment
with fsync or power-loss durability.

No additional broad transport prototype is required. Proceed to
feature-review after the terminology resolution and confirmation that
no material functional question remains. Production implementation,
commits and publication are not authorized by this brief.
