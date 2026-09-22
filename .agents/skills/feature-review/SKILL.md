---
name: feature-review
description: "Trigger: adversarially review a complete feature definition before technical specification. Produce a read-only consolidated report with evidence, dispositions, and a final verdict."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Feature Definition Review

## Activation Contract

Use this skill after `feature` and required prototype work, before `to-spec`. It owns a read-only adversarial review of the complete definition package. It does not restart discovery, change artifacts, decide for the user, maintain domain authority, or review implementation code.

## Review Inputs

Require a complete definition package and a read-only Domain Authority review that is present, fresh, and consistent with the resolved handoff. Include the brief, applicable prototype and UI contract, shared-capability comparisons, scenarios, states, dependencies, decisions, consumer standards, deviations, risks, and evidence gaps. During the run, capture the reviewed package, pass that same capture to every lens, and verify that every cited artifact is available and consistent with it. A missing, stale, or inconsistent authority review blocks the run. A material change invalidates the review and requires a new run; editorial corrections preserving meaning do not.

## Review Lenses

The harness must establish three independent read-only lenses through three independent sub-agents or mechanisms on every invocation and consolidate after each returns. If it cannot obtain that capability, return `BLOCKED`. Complete all three lenses even when one finds a blocker:

1. **Completeness and coherence:** find missing behavior, states, errors, decisions, contradictions, and mismatches between the brief, prototype, contracts, and dependencies.
2. **Simplification and scope:** find unnecessary scope, speculative behavior, accidental complexity, and the simpler definition that preserves the outcome.
3. **Feasibility and transversal coherence:** compare repository evidence, consumer architecture, domain authority, seams, and observable invariants.

Transversal coherence is finite: inspect each declared shared capability that the feature reuses, extends, or replaces, plus an obviously omitted capability directly implicated by the definition. Compare its observable invariants against an explicit sample of sibling implementations and authoritative feature or specification sources. Record one result per capability: `compatible`, `authorized divergence`, `unauthorized divergence`, or `insufficient evidence`.

Consume the read-only Domain Authority review. Report conflicts with its glossary, accepted ADRs, code evidence, and consumer contracts without repairing or reinterpreting them.

## Findings and Verdict

For every finding, record lens, finding, exact evidence, impact, severity (`blocker`, `warning`, or `informative`), responsible skill or decision owner, recommendation, required user disposition, and a separate status. Set the initial status to `pending user disposition`; after correction, acceptance, or reverification, update it to reflect that event and its result. Always include this section, even when empty:

```markdown
## Decisions, Deviations and Accepted Risks

None identified.
```

When populated, include the deviation, alternative decision, reason, impact, evidence, affected artifact or contract, required review, and user disposition. An undisposed warning, risk, divergence, or critical evidence gap is a blocker.

Return `READY` only with no blockers or warnings; return `READY WITH WARNINGS` only with no blockers and the user's explicit, traceable acceptance for every warning; otherwise return `BLOCKED`. Corrections return to their owner. Reverify an accepted deviation before improving a blocked verdict. Keep drafts private. The final report consolidates findings, user dispositions, corrections, reverifications, accepted warnings, and verdict. Write human-facing reports, tracker comments, and publication metadata in Spanish; technical specifications and evidence may retain English repository terminology.
