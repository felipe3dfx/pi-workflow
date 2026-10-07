---
name: feature-review
description: "Trigger: adversarially review a complete feature definition before technical specification. Produce a read-only consolidated report with evidence, dispositions, and a final verdict."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.2"
  provenance: derived
---

# Feature Definition Review

## Activation Contract

Use this skill after `feature` and required prototype work, before `to-spec`. It owns a read-only adversarial review of the complete definition package. It does not restart discovery, change artifacts, decide for the user, maintain domain authority, or review implementation code.

## Review Inputs

Require a complete definition package. The resolved Domain Authority Handoff and its read-only authority review are each admitted when present, and a missing one is admissible on its own when functional and semantic decisions are closed and the remaining criteria are satisfied; record the evidence gap and continue, because absence alone does not block the run. A present but malformed, blocked, stale, or conflicting handoff or authority review stays blocking until routed and resolved. Include the brief, applicable prototype and UI contract, shared-capability comparisons, scenarios, states, dependencies, decisions, consumer standards, deviations, risks, and evidence gaps. During the run, capture the reviewed package, pass that same capture to every lens, and verify that every cited artifact is available and consistent with it. Require every decision to record its resolver, source, status, and any accepted supersession with what it replaced; recency alone does not supersede. An important decision open at entry, a stale or inconsistent authority review, or an unresolved semantic conflict blocks the run. A material change invalidates the review and requires a new run; editorial corrections preserving meaning do not.

## Review Lenses

The harness must establish three independent read-only lenses through three independent sub-agents or mechanisms on every invocation and consolidate after each returns. If it cannot obtain that capability, return `BLOCKED`. Complete all three lenses even when one finds a blocker:

1. **Completeness and coherence:** find missing behavior, states, errors, decisions, contradictions, and mismatches between the brief, prototype, contracts, and dependencies.
2. **Simplification and scope:** find unnecessary scope, speculative behavior, accidental complexity, and the simpler definition that preserves the outcome.
3. **Feasibility and transversal coherence:** compare repository evidence, consumer architecture, domain authority, seams, and observable invariants.

Transversal coherence is finite: inspect each declared shared capability that the feature reuses, extends, or replaces, plus an obviously omitted capability directly implicated by the definition. Compare its observable invariants against an explicit sample of sibling implementations and authoritative feature or specification sources. Record one result per capability: `compatible`, `authorized divergence`, `unauthorized divergence`, or `insufficient evidence`.

Consume the read-only Domain Authority review when present; when it is absent, record the declared gap and still use the canon and evidence available. Report conflicts with its glossary, accepted ADRs, code evidence, and consumer contracts without repairing or reinterpreting them. A lens that detects an important functional or technical decision that is open or in conflict, or a material semantic conflict affecting the result, reports `BLOCKED`; this review presents the decisions or open choices, their sources, and applicable constraints to the developer, who decides, and returns the correction to `feature` outside this read-only review, rerunning only if the definition materially changes. Domain and module owners supply evidence, constraints, and applicable canon without taking that decision.

## Findings and Verdict

For every finding, record lens, finding, exact evidence, impact, severity (`blocker`, `warning`, or `informative`), responsible skill or decision owner, recommendation, required user disposition, and a separate status. Set the initial status to `pending user disposition`; after correction, acceptance, or reverification, update it to reflect that event and its result. Always include this section, even when empty:

```markdown
## Decisions, Deviations and Accepted Risks

None identified.
```

When populated, include the deviation, alternative decision, reason, impact, evidence, affected artifact or contract, required review, and user disposition. An undisposed warning, risk, divergence, or critical evidence gap is a blocker, except that a declared absence of a generated authority artifact is not, by itself, a critical evidence gap or a verdict blocker when functional and semantic decisions are closed and the remaining criteria are satisfied; a substantive conflict, an important open decision, or any other unmet criterion stays blocking. Present each finding that needs a user disposition as the pull-request playbook's approval preview, or as [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects) define it when that playbook has none. Accepting a warning or risk is always asked, whatever the approval policy.

Return `READY` only with no blockers or warnings; return `READY WITH WARNINGS` only with no blockers and the user's explicit, traceable acceptance for every warning; otherwise return `BLOCKED`. Corrections return to their owner. Reverify an accepted deviation before improving a blocked verdict. Keep this report as local working state: this read-only skill publishes nothing, and the orchestrator publishes. Stabilize the brief and this report together through local iterations; once both are stable and the verdict is `READY` or `READY WITH WARNINGS`, hand the brief and this report for joint publication, applying the preview, the consumer policy's approval requirements for publication effects, and verified read-back controls in `to-spec` Preparation, Publication and Handoff, which name the brief and report roles, the current package and handoff, exact-match reuse, conflict blocking, and read-back for each. Product-intent changes and acceptance of warnings or risks always require explicit user disposition, regardless of policy. Ticketization remains a later, separate phase. The final report consolidates findings, user dispositions, corrections, reverifications, accepted warnings, and verdict. Write human-facing reports, tracker comments, and publication metadata in Spanish; technical specifications and evidence may retain English repository terminology.
