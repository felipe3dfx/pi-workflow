---
name: to-spec
description: "Trigger: synthesize an approved feature definition into an authoritative technical specification. Validate readiness, preserve decisions, and hand one final package to ticket slicing."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.3"
  provenance: derived
---

# Feature Definition to Technical Specification

## Activation Contract

Use this skill to hand an approved feature definition to an authoritative technical specification. It owns readiness validation and synthesis, not product discovery, a second feature interview, implementation, ticket slicing, or publication. Return missing definitions to their responsible skill rather than silently filling them.

## Readiness Gate

Before drafting, verify that the feature is identified; the current execution-scoped definition package and review handoff are available; the brief and required context exist; prototype status and confirmed disposition are explicit when used; scope, scenarios, dependencies, decisions, assumptions, and out-of-scope behavior are present; shared capabilities, comparison evidence, deviations, and risks are recorded; the Domain Authority Handoff and consumer contracts are available; and a `feature-review` report exists for the current package and review handoff with a verdict that has no blocker or undisposed warning.

If a requirement fails, report each absence or contradiction and return it to `feature`, `prototype`, `feature-review`, or the owning authority. Do not repeat discovery. If the report does not clearly cover the current definition, return it to `feature-review` for renewed review. Preserve the `READY` or `READY WITH WARNINGS` verdict from `feature-review`; a package without either remains `BLOCKED`. Ask only a focused question about a material ambiguity, contradiction, concurrency issue, or missing test seam that prevents synthesis. Never upgrade a blocked review.

## Synthesis

Write one complete English technical specification from the approved definition without changing functional decisions. Include the problem, solution, user stories, implementation decisions, testing decisions, out-of-scope behavior, prototype decisions, approved deviations, accepted risks, dependencies and native relationships, and a reference to the final feature-review report.

Load the `codebase-design` skill and use its vocabulary. For every proposed structural decision, state its evidence, reason, and necessity, and label it mandatory or a recommendation. A technical choice is mandatory only when an applicable authority rule, accepted decision, contract, or dependency indispensable to approved behavior requires it; cite the source and necessity. Preserve approved observable behavior and every applicable binding constraint from standards, accepted decisions, consumer contracts, and necessary dependencies; state the source and reason for each mandatory constraint. Include a recommended structural choice only when its evidenced reason shows the need it serves. Propose the highest useful existing seam when useful, but do not turn a design recommendation into an obligation merely by specifying it. If synthesis exposes a material ambiguity or contradiction among binding authorities or against approved behavior, return it to its owner for resolution and require focused reverification by `feature-review` before resuming. Do not resolve an unresolved contradiction by preference or proceed with it. Record shared-capability invariants that implementation and ticket slicing must preserve. Specify observable behavior and test decisions, not stale file paths or implementation snippets.

## Preparation, Publication and Handoff

`READY` and `READY WITH WARNINGS` are eligible for publication, not publication itself. When the destination tracker is GitHub or Linear, verify tracker read capability before preparing the preview and write capability before the first publication mutation; either failure is `blocked` with no mutation request sent. Prepare an approval preview with destination and title, the current package and review handoff, final spec, final review report, verdict, accepted warnings and deviations, the parent ticket and its disposition, and external effects. Write technical specifications in English and human-facing tracker artifacts and comments in Spanish. Preparing the preview creates no durable artifact or external mutation. Approvals follow the pull-request playbook's approval policy and approval preview; with no recorded policy, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`.

In GitHub and Linear, the specification has one parent ticket. A specification published as an issue is its own parent; no other issue is created. A specification published as a repository file gets a Spanish parent issue that follows the tracker playbook's publication fields, states that it represents the specification at that path, and cites only the path, never a commit. Parent equivalence is by specification location: reuse one open match, even one without tickets; a closed match or more than one candidate is `blocked` with no mutation request. The preview's disposition is reuse of the identified issue, creation of a new one, or the specification issue itself. GitLab, `local-markdown`, and `none` publish no parent.

Once publication following that preview is approved, or at once under `autonomous`, the orchestrator performs the publication mutation. It creates one final technical specification and one final consolidated feature-review report for the current approved feature definition package and review handoff, and the parent ticket in GitHub or Linear. Before creating the specification or report, the orchestrator inspects durable artifacts for the same role, current package, and review handoff; reuses one exact match, creates only a missing artifact, blocks multiple matches or conflicting content, and verifies read-back. Re-inspect parent equivalence before creating it; a result that differs from the preview is a material change that requires a new approval preview. Create a file specification's parent after the specification's read-back. Set `PUBLISHED` only after every artifact is published for the current package and review handoff and each has a verified read-back. A partial, conflicting, duplicate, or unread-back publication is incomplete and remains `BLOCKED`; do not hand it off. Keep drafts and intermediate reports as working state.

Hand `to-tickets` the published spec and review report, the parent ticket's identity in GitHub or Linear, current package and review handoff, verdict, applicable prototype branch, commit, UI contract, and confirmed disposition, decisions, deviations, accepted risks, dependencies and native relationships, and preserved conditions and invariants. If ticket slicing finds a definition defect, return it to this definition block without editing the published specification.
