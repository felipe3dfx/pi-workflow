---
name: qa-handoff
description: Prepare a QA handoff for one Linear issue from a domain anchor under Developer authority.
---

# QA Handoff

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations. Pending capabilities block every tool. Implemented capabilities expose only their workflow-owned tools, and `ask_user_question` is available only while a compatible shared decision is active.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Developer.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.

For missing or invalid input, return exactly this one corrective question:

What single Linear issue ID anchors this QA handoff?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Closed decisions

Every closed human choice is presented by the shared `interactive-decisions` descriptor as either the compatible Pi panel or its numbered fallback. Wait for that descriptor and use only the semantic action recorded by its fresh claim. Never render a separate choice list, require an exact phrase, infer approval from prose, or construct decision IDs, digests, execution IDs, or authority fields. Ambiguous free-form feedback is not approval and must not trigger an effect.

## Publication

After receiving an allowed invocation with a valid Linear ID:

- The Developer's invocation supplies only the issue anchor; it does not authorize publication. Wait for the shared publish or cancel action bound to the canonical `qa-handoff/v1` artifact, issue revision, and exact Linear-facing body in professional neutral Spanish.
- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call `linear_get_user` again before publication.
- Execute the QA handoff workflow for that same Linear ID. Do not provide a body, digest, authority, revision, or additional fields.
- If the workflow returns a blocker, report the exact blocker and stop.
- If it publishes the comment or retrieves it idempotently, report the verified result.

Never change status, assignee, Cycle, labels, estimate, blockers, relations, or description. Those actions remain manual.
