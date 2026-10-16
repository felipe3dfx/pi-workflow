---
name: feature-critic
description: "Trigger: critique a feature definition after `feature` or on demand. Find the simplest definition that meets the need and keep real risks."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.0"
  provenance: derived
---

# Feature Definition Critic

## Activation Contract

Run after `feature` by default, once the brief is ready and required prototype work is done, before `to-spec`. The developer may invoke it at any other moment, on a draft brief or a single decision; such a run returns findings to `feature` without a verdict, and only a run on the complete definition package issues the verdict `to-spec` consumes. It owns a read-only critique seeking the simplest definition that satisfies the need, not a completeness checklist. It does not restart discovery, add discovery stages, change the definition, decide for the developer, maintain domain authority, or review implementation code.

## Inputs

Require a complete definition package for a verdict. The resolved Domain Authority Handoff and its read-only authority review are each admitted when present; when one is missing, functional and semantic decisions are closed, and the remaining criteria are met, record the evidence gap and continue. A present but malformed, blocked, stale, or conflicting handoff or authority review stays blocking until routed and resolved. Include the brief, applicable prototype and UI contract, shared-capability comparisons, scenarios, states, dependencies, decisions, consumer standards, deviations, risks, and evidence gaps. Capture the critiqued package once, pass that same capture to every lens, and verify every cited artifact is available and consistent with it; an unavailable or inconsistent one is a demonstrated failure. Require every decision to record its resolver, source, status, and any accepted supersession with what it replaced; recency alone does not supersede. A material change invalidates the verdict and requires a new run; an editorial correction preserving meaning does not.

## Lenses

Establish three independent read-only lenses through independent sub-agents or mechanisms on every invocation and consolidate after each returns; without that capability, return `BLOCKED`. Complete all three even after a blocker, and record every gap found in the critiqued package as a finding:

1. **Need and coherence:** test whether the definition satisfies the stated need, and find contradictions between the brief, prototype, contracts, and dependencies, plus missing behavior, states, or errors the need requires.
2. **Scope and proportionality:** challenge speculative requirements, exceptions, edge cases, and guarantees with no traceable need, and propose the simplest definition that still meets the outcome.
3. **Feasibility and transversal coherence:** compare repository evidence, consumer architecture, domain authority, seams, and observable invariants. Inspect each declared shared capability the feature reuses, extends, or replaces, plus any omitted shared capability a scenario or dependency in the definition directly uses, against authoritative sources and a sample of at least two sibling implementations, or all when fewer exist; a claim found only in the critiqued package is not repository evidence. Record `compatible`, `authorized divergence`, `unauthorized divergence`, or `insufficient evidence` per capability. An `unauthorized divergence` is a demonstrated failure and `insufficient evidence` a substantiated risk; a declared absent authority artifact is only a recorded evidence gap.

Consume the authority review when present, otherwise the available canon and evidence. Report conflicts with the glossary, accepted ADRs, code evidence, and consumer contracts without repairing them. An important functional or technical decision that is open or in conflict, or a material semantic conflict, is a blocker: present the options, sources, and constraints to the developer, who decides; owners supply evidence and canon, not the decision.

## Findings

Weigh every recommendation against its need, evidence, impact, and added complexity. Classify every finding by its basis:

- **Demonstrated failure:** evidence shows the definition misses its need, contradicts a contract, or breaks a security requirement. Severity `blocker`.
- **Substantiated risk:** evidence supports a risk the definition leaves open. Severity `warning`. Never discount a security requirement, a binding contract, or a substantiated risk because it is infrequent.
- **Speculative:** no demonstrated need, including any guarantee, exception, or edge case with no traceable need. Severity `informative`. Propose its simplification, stating the complexity removed and the behavior or guarantee kept; never propose a speculative addition as required. A guarantee tracing to a real requirement stays even when it complicates the solution, listed with its source under justified complexity.

When lenses report the same issue, consolidate it into one finding classed by the strongest evidence any lens supplies; a guarantee with no traceable need stays speculative unless a lens supplies evidence of a risk or failure it causes.

Record for each finding its lens, class, evidence, need, impact, complexity added or removed, severity, owner (the skill or person who acts on it), recommendation, and disposition. Always include this section, even when empty:

```markdown
## Decisions, Deviations, Accepted Risks and Justified Complexity

None identified.
```

When populated, include the deviation or alternative decision, reason, impact, evidence, affected artifact or contract, required review, and disposition.

## Disposition and Verdict

Return the findings to `feature`, which owns their disposition. A blocker closes only when corrected; a warning is disposed when corrected or with the developer's explicit `risk accepted`, recorded with who accepted it, the reason, and the source; an informative finding may be `accepted` or `rejected` with a reason. A finding whose evidence or need the developer disputes returns to its lens, which upholds or withdraws it with evidence, recorded `withdrawn`. Corrections outside the brief return to their owner. Dispositions carry over to findings a new run finds unchanged. Without a material change, consolidate the recorded dispositions into the verdict without new lenses; recording a disposition, including `risk accepted`, is not a material change. A recorded correction or accepted deviation returns to its lens for reverification before its finding closes.

Return `READY` only with every finding disposed and no blocker or uncorrected warning; `READY WITH WARNINGS` when every uncorrected warning carries `risk accepted`; otherwise `BLOCKED`. An undisposed finding blocks. Keep the report as local working state; this skill publishes nothing. Once the brief and report are stable and the verdict is `READY` or `READY WITH WARNINGS`, hand both for joint publication under `to-spec` Preparation, Publication and Handoff. The final report consolidates findings, dispositions, adjustments, reverifications, justified complexity, accepted risks, and verdict. Write human-facing reports, tracker comments, and publication metadata in Spanish; technical specifications and evidence may keep English repository terminology.
