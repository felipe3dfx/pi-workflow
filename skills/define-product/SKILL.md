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

## Route recommendation

After receiving an allowed invocation with a valid domain anchor:

- Assess the idea explicitly on two axes: clarity (`clear` or `unclear`) and breadth (`narrow` or `broad`).
- Recommend `wayfinder` when clarity is `unclear` or breadth is `broad`; otherwise recommend `grilling`.
- Explain the reasons briefly and ask the Owner to confirm the exact recommended route, provide the research question, and return the one-time confirmation token from that recommendation response.
- Stop after that recommendation turn. Do not start research in the same turn.

## Confirmation and result

After the Owner explicitly confirms the exact recommended route, provides the research question, and returns the one-time confirmation token from the active recommendation response:

- Execute the workflow-owned define-product implementation.
- If it returns a blocker, report the blocker exactly and stop.
- If it completes, return the verified artifact reference and the next recommended step.

Do not expose agent names, provider or model choices, effort, runtime IDs, artifact topics, private tool names, or retry internals.
