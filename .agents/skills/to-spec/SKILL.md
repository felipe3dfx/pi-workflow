---
name: to-spec
description: "Trigger: synthesize an approved feature definition into an authoritative technical specification. Validate readiness, preserve decisions, and hand one final package to ticket slicing."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
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

Use `codebase-design` vocabulary. Propose the highest useful existing seam when a recommendation needs one, but consumer architecture and accepted ADRs govern concrete choices. Specify observable behavior and test decisions, not stale file paths or implementation snippets. Record shared-capability invariants that implementation and ticket slicing must preserve. If synthesis exposes a material ambiguity or contradiction, return it to its owner and require focused reverification by `feature-review` before resuming.

## Preparation, Publication and Handoff

`READY` and `READY WITH WARNINGS` are eligible for publication, not publication itself. Prepare a compact preview with destination and title, the current package and review handoff, final spec, final review report, verdict, accepted warnings and deviations, and external effects. Write technical specifications in English and human-facing tracker artifacts and comments in Spanish. Preparing the preview creates no durable artifact or external mutation.

After the user explicitly requests publication following that preview, the orchestrator performs the publication mutation. It creates one final technical specification and one final consolidated feature-review report for the current approved feature definition package and review handoff. Before creating either artifact, the orchestrator inspects durable artifacts for the same role, current package, and review handoff; reuses one exact match, creates only a missing artifact, blocks multiple matches or conflicting content, and verifies read-back. Set `PUBLISHED` only after both artifacts are published for the current package and review handoff and each has a verified read-back. A partial, conflicting, duplicate, or unread-back publication is incomplete and remains `BLOCKED`; do not hand it off. Keep drafts and intermediate reports as working state.

Hand `to-tickets` the published spec and review report, current package and review handoff, verdict, applicable prototype branch, commit, UI contract, and confirmed disposition, decisions, deviations, accepted risks, dependencies and native relationships, and preserved conditions and invariants. If ticket slicing finds a definition defect, return it to this definition block without editing the published specification.
