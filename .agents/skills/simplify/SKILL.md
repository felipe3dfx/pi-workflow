---
name: simplify
description: "Trigger: inspect a bounded changed diff for clearer, safer code. Return read-only findings on clarity, structure, abstraction, pertinence, and safety."
license: Apache-2.0
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Simplify a Changed Diff

## Activation Contract

Use after a stable candidate exists or when given an explicit bounded diff. This is a read-only review of how changed code expresses existing behavior. It reports clarity, structure, abstraction, pertinence, and safety findings; it never edits code, broadens the diff, runs a whole-repository audit, validates behavior, or declares implementation ready.

## Inputs and Boundaries

Consume the candidate capture or an equivalent immutable changed-path and diff inventory, plus applicable consumer standards and authority. If neither input is provided, or if the provided input is stale or materially changed, return `blocked`; ask the caller to provide or refresh it. Keep pre-existing debt separate from current-change findings. Consumer conventions decide language, frameworks, commands, and architecture rules.

Inspect each changed path and new or modified helper. Prefer direct, legible expressions over abstractions that merely rename a value, constant, attribute, or obvious call. Preserve abstractions only when they carry a durable domain rule, validation, authorization, transformation, composition, required protocol, or meaningful duplication of knowledge that could diverge. Treat a clean simplify pass as neither functional, security, UI, scope, nor test-completeness evidence.

## Review Procedure

1. Check names, control flow, local structure, duplication of knowledge, and cognitive cost against the consumer's standards.
2. For every changed abstraction, compare its call site with the inline alternative. Record the semantics it adds, navigation cost, and whether the net cognitive load justifies it.
3. Check pertinence: distinguish essential work from speculative branches, defensive handling without a reachable path, and unrelated cleanup.
4. Identify safety concerns visible in the diff, but route correctness, security, scope, test seams, and architecture judgments to independent review rather than duplicating that responsibility.
5. Return only evidence-backed findings. Do not silently discard a material concern because a proposed rewrite is inconvenient.

## Output Contract

For every finding, report changed path and location, category, evidence, impact, a behavior-preserving direction, and confidence. State `none` when no evidence-backed findings exist. Mark all findings as suggestions for the implementer; the caller records application, rejection, or escalation in its quality loop. Include reviewed paths, temporary capture scope, excluded debt, and any blocker. No repository or tracker mutation occurs.
