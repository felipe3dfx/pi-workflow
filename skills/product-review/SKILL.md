---
name: product-review
description: Review one Linear issue from a domain anchor under Owner authority.
---

# Product Review

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. Human role membership is an organizational access boundary: this package has no Owner/Developer credential and does not authenticate a person as Owner rather than QA or PS. Later workflow modules must enforce role authority before mutations.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Owner.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.

For missing or invalid input, return exactly this one corrective question:

What single Linear issue ID anchors this product review?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Evaluation and approval

After receiving an allowed invocation with a valid Linear ID:

- Evaluate scope, user stories and acceptance criteria, evidence, findings, required changes, and parent/sibling impact through the structured `product-review/v1` draft.
- Present the agent recommendation and the exact digests for `Aceptado` and `Cambios requeridos`.
- Ask the Owner to explicitly choose one result and confirm the corresponding issue and digest. Do not publish before that approval.
- After explicit selection, call the tool with only `issueId`, `result`, and `digest`. Do not provide body, authority, revision, or additional fields.
- Report the verified result or blocker exactly.
- Communicate conversationally in the language used by the user. This does not change the professional-neutral Spanish contract for content published to Linear.

Never change status, assignee, Cycle, labels, estimate, relations, or description. Done, Stop, reassignment, and parent auto-close remain manual or native Linear actions.
