---
name: product-review
description: Review one Linear issue from a domain anchor under Owner authority.
---

# Product Review

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. For each relevant execution, the implemented runtime authenticates one active, non-guest Linear user exactly once with `linear_get_user` and caches a stable `single-user/v1` authority projection; never repeat that lookup before later actions or mutations. Human Owner/Developer role membership remains an organizational access boundary: this package does not infer role membership from the Linear user response.

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

- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call `linear_get_user` again after selection or before publication.
- Evaluate scope, user stories and acceptance criteria, evidence, findings, required changes, and parent/sibling impact through the structured `product-review/v1` draft.
- Present the agent recommendation and the two available results, `Aceptado` and `Cambios requeridos`, without exposing digests or workflow metadata.
- Ask the Owner to decide naturally. Interpret the Owner's response yourself; runtime code must not classify natural-language phrases. If the response is ambiguous, ask a follow-up and do not call tools.
- After the Agent interprets an explicit selection, call the workflow tool with exactly `action: "select_result"` and the selected structured `result`. The runtime privately binds the issue and digest.
- Report the verified result or blocker exactly.
- Communicate conversationally in the language used by the user. This does not change the professional-neutral Spanish contract for content published to Linear.

Never change status, assignee, Cycle, labels, estimate, relations, or description. Done, Stop, reassignment, and parent auto-close remain manual or native Linear actions.
