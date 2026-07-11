---
name: define-product
description: Define a product from a domain anchor under Owner authority.
---

# Define Product

## Invocation guard

Evaluate this invocation guard before inspecting or handling inputs.

The runtime extension admits only idle interactive invocations and blocks all tools while the capability is pending. Human role membership is an organizational access boundary: this package has no Owner/Developer credential and does not authenticate a person as Owner rather than QA or PS. Later workflow modules must enforce role authority before mutations.

For a forbidden runtime caller, the extension returns the PI_WORKFLOW_PUBLIC_ENTRY_FORBIDDEN blocker before the LLM runs.

## Inputs

Authorized organizational role: Owner.

Trim surrounding whitespace from the invocation arguments before checking the domain anchor.

After trimming, any non-empty product idea or problem is exactly one valid domain anchor. Whitespace-only input is missing.

For missing input, return exactly this one corrective question:

What product idea or problem should define the domain scope?

Ask no other question. Stop immediately after the question. Do not invoke tools or perform mutations.

## Pending capability

After receiving an allowed invocation with a valid domain anchor, return exactly:

```text
status: blocked
code: PI_WORKFLOW_CAPABILITY_PENDING
capability: define-product
mutation: none
```

Do not invoke tools or perform mutations while this capability is pending. Runtime code blocks every tool call for the active public-entry turn.
