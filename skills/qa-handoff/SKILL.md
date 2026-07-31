---
name: qa-handoff
description: Prepare a QA handoff for one Linear issue from a domain anchor under Developer authority.
---

# QA Handoff

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. For each relevant execution, the implemented runtime authenticates one active, non-guest Linear user exactly once with `linear_get_user` and caches a stable `single-user/v1` authority projection; never repeat that lookup before later actions or mutations. Human Owner/Developer role membership remains an organizational access boundary: this package does not infer role membership from the Linear user response.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Developer.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.

For missing or invalid input, return exactly this one corrective question:

What single Linear issue ID anchors this QA handoff?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Publication

After receiving an allowed invocation with a valid Linear ID:

- The Developer's explicit invocation authorizes only the canonical `qa-handoff/v1` artifact that the runtime binds internally to that issue, its revision, and the exact Linear-facing body in professional neutral Spanish.
- Authenticate one active, non-guest Linear user when the runtime requests it; reuse that cached identity and never call `linear_get_user` again before publication.
- Execute the QA handoff workflow for that same Linear ID. Do not provide a body, digest, authority, revision, or additional fields.
- If the workflow returns a blocker, report the exact blocker and stop.
- If it publishes the comment or retrieves it idempotently, report the verified result.

Never change status, assignee, Cycle, labels, estimate, blockers, relations, or description. Those actions remain manual.
