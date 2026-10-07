---
name: feature
description: "Trigger: define a product feature from an idea or tracker issue. Run progressive discovery and maintain a user-confirmed functional brief."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.2"
  provenance: derived
---

# Feature Definition

## Activation Contract

Use this skill to turn a free-form idea or tracker issue into a coherent functional definition. It owns product discovery and the feature brief; `domain-modeling`, `to-spec`, and `feature-review` retain their respective authority.

## Inputs and Authority

Read the consumer's recorded contracts, the resolved Domain Authority Handoff when present, applicable accepted ADRs, repository evidence, and local design conventions. Consult lexical authority read-only as evidence; the brief never creates or changes canon, and business intent stays distinct from canonical terminology. Recover a resolved decision from existing brief, specification, review, and handoff artifacts before asking again, keeping its resolver, source, status, and any accepted supersession with what it replaced; recency alone never supersedes.

A missing generated authority artifact is the only admissible absence: when functional and semantic decisions are closed, record the evidence gap and continue, because no code, repository, skill, glossary, or ADR edit is a planning prerequisite. A present but malformed, blocked, stale, or conflicting authority artifact, and any layout defect, stays blocking until routed and resolved. If applicable authority is ambiguous or materially contradicts approved intent, or an important decision remains open, present the conflicting decisions, sources, and constraints to the developer, who decides every important functional and technical choice; domain and module owners supply evidence, constraints, and applicable canon without taking that decision; resume only after the developer resolves the conflict or open decision. Route layout defects to `setup-workflow` and semantic gaps to `domain-modeling`. Treat repository evidence as the current implementation, not proof that a proposed behavior is correct. Report contradictions to their owner.

## Discovery Loop

1. Establish the problem, user, desired outcome, and first brief. Recover closed decisions from existing artifacts before asking; ask at most one question per round, only about a missing problem, user, outcome, or information, or an important open choice or material conflict, showing its sources. Ground a recommendation in available evidence and record unanswered assumptions as open.
2. Confirm scope boundaries; scenarios, states, actions, ordering, and errors; decisions, assumptions, and open questions with resolver, source, status, and accepted supersession; dependencies; deviations; risks; and evidence gaps.
3. Identify shared capabilities the feature reuses, extends, or replaces. Record comparison implementations and observable invariants for each.
4. Recommend `prototype` when an artifact can resolve a functional question. Propose a brief delta from its findings; apply it only after user acceptance.
5. Recommend `feature-review` when the brief is complete, every material question and assumption has a recorded disposition, prototype findings have a disposition, and every substantive conflict, important open decision, and other evidence gap is resolved or blocks review; a declared absence of a generated authority artifact alone does not block review when functional and semantic decisions are closed and all other criteria are met. A functional change requires renewed review; an editorial correction preserving meaning does not.

## Feature Brief

Maintain one user-confirmed brief with the problem and user; desired outcome; scope boundaries; scenarios, states, actions, and errors; decisions, assumptions, and open questions with resolver, source, status, and accepted supersession; business intent, owner, and source kept distinct from canonical terminology; relevant sources; shared-capability comparisons and invariants; prototype findings and disposition; dependencies; deviations; risks; and evidence gaps. Show each brief change for acceptance as the pull-request playbook's approval preview, or as [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects) define it when that playbook has none. The brief is product intent, so its acceptance is always asked, whatever the approval policy.

## Output Contract

Report the resolved Domain Authority Handoff when present, otherwise report the documented admissible gap; report decisions and assumptions with their disposition, open material questions, sources and contradictions, prototype recommendation or delta, shared-capability evidence, deviations, risks, and blockers. Hand `feature-review` the complete definition package; leave technical synthesis to `to-spec`.
