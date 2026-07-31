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
- Explain the reasons briefly and ask the Owner to confirm the exact recommended route naturally and provide the research question.
- Stop after that recommendation turn. Do not start research in the same turn.

## Confirmation and research

After the Owner explicitly confirms the exact recommended route and provides the research question:

- Execute the workflow-owned define-product research.
- If it returns a blocker, reproduce the blocker code and message exactly, then stop.
- If it completes, report the verified result without private workflow metadata.

## Spec generation

After verified research or exploration completes:

- Call authenticated Linear MCP `linear_list_teams` exactly once with `limit: 50` and `orderBy: "updatedAt"`.
- Retain each returned immutable team ID privately. Present the team names as concise numbered options without internal IDs and ask the Owner to select one. Interpret the natural-language selection and map it only to an option that was presented; never infer or invent an ID. Never require the Owner to type or recall a team name without first showing these options. Derive a concise title from the product task; never ask the Owner to provide one.
- Stop after presenting the options. Never call `to_spec` in the same turn that research or exploration completed.
- Wait for a fresh interactive, non-streaming Owner reply before calling `to_spec`.
- For the first Spec, pass `teamId`, the model-derived `title`, and the semantic Spanish Spec fields. The runtime privately binds definition identity, the composite target, initial revision `spec-r1`, and every verified active research or exploration support artifact.
- Interpret each fresh Owner response yourself. If it approves the ready Spec, call `approve_spec`; if it requests changes, incorporate the feedback, preserve unaffected content, reuse the privately retained team without asking the Owner to repeat or reconfirm it, derive the title from the task, and call `to_spec` again. If the response is ambiguous, ask a follow-up and do not call the workflow tool. Runtime code validates provenance and bindings but never classifies the natural-language wording. The runtime accepts an omitted `teamId` only for a bound revision.
- Never ask for or provide definition IDs, revisions, target objects, support artifact aliases, support artifact references, digests, schemas, or artifact topics.
- Use professional neutral Spanish in the Spec and all Owner-facing wording.
- Present a Spec only when the workflow returns `spec-ready`. Reproduce the returned `spec.body` verbatim and in full before asking for approval; never summarize, paraphrase, or replace it with only the title.
- After natural Owner approval, call `approve_spec` with only its action. If it returns `spec-approved`, immediately call `publish_spec` with only its action in the same turn; do not ask for another human confirmation and do not claim publication before verified success.
- If the workflow returns a blocker, reproduce the blocker code and message exactly, stop immediately, and never draft, imply, or present a fallback or unofficial Spec.

Do not expose agent names, provider or model choices, effort, runtime IDs, artifact topics, private tool names, or retry internals.
