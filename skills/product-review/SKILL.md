---
name: product-review
description: Review one Linear issue from a domain anchor under Owner authority.
---

# Product Review

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations. Pending capabilities block every tool. Implemented capabilities expose only their workflow-owned tools, and `ask_user_question` is available only while a compatible shared decision is active.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Owner.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.

For missing or invalid input, return exactly this one corrective question:

What single Linear issue ID anchors this product review?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Closed decisions

Every closed human choice is presented by the shared `interactive-decisions` descriptor as either the compatible Pi panel or its numbered fallback. Wait for that descriptor and use only the semantic action recorded by its fresh claim. Never render a separate choice list, require an exact phrase, infer approval from prose, or construct decision IDs, digests, execution IDs, or authority fields. Ambiguous free-form feedback is not approval and must not trigger an effect.

## Evaluation and approval

After receiving an allowed invocation with a valid Linear ID:

- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call `linear_get_user` again after selection or before publication.
- Evaluate scope, user stories and acceptance criteria, evidence, findings, required changes, and parent/sibling impact through the structured `product-review/v1` draft.
- Let the runtime present the shared result descriptor for `Aceptado`, `Cambios requeridos`, and cancellation without exposing digests or workflow metadata.
- After the shared descriptor records a result action, call the workflow tool with `action: "select_result"` and the corresponding structured `result`. The runtime privately binds the issue and digest. The transport fields do not authorize publication by themselves.
- Report the verified result or blocker exactly.
- Communicate conversationally in the language used by the user. This does not change the professional-neutral Spanish contract for content published to Linear.

Never change status, assignee, Cycle, labels, estimate, relations, or description. Done, Stop, reassignment, and parent auto-close remain manual or native Linear actions.
