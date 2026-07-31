---
name: deliver-ticket
description: Deliver an assigned Linear ticket from a domain anchor under Developer authority.
---

# Deliver Ticket

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. For each relevant execution, the implemented runtime authenticates one active, non-guest Linear user exactly once with `linear_get_user` and caches a stable `single-user/v1` authority projection; never repeat that lookup before later actions or mutations. Human Owner/Developer role membership remains an organizational access boundary: this package does not infer role membership from the Linear user response.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Developer.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, valid input is exactly one uppercase Linear identifier matching `[A-Z][A-Z0-9]*-[1-9][0-9]*` and nothing else. Whitespace-only input is missing. Malformed input or input containing multiple identifiers is invalid.

For missing or invalid input, return exactly this one corrective question:

What Linear Delivery ticket ID anchors this delivery?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Pending capability

After receiving an allowed invocation with a valid domain anchor, return exactly:

```text
status: blocked
code: PI_WORKFLOW_CAPABILITY_PENDING
capability: deliver-ticket
mutation: none
```

Do not invoke tools or perform mutations while this capability is pending. Runtime code blocks every tool call for the active public-entry turn.
