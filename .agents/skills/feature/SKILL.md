---
name: feature
description: "Trigger: define a product feature from an idea or tracker issue. Run progressive discovery and maintain a user-confirmed functional brief."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "2.0"
  provenance: derived
---

# Feature Definition

## Activation Contract

Use this skill to turn a free-form idea or tracker issue into a coherent functional definition. It owns product discovery and the feature brief; `grilling` conducts its decision interviews, and `domain-modeling`, `to-spec`, and `feature-critic` retain their respective authority.

## Inputs and Authority

Read the consumer's recorded contracts, the resolved Domain Authority Handoff when present, applicable accepted ADRs, repository evidence, and local design conventions. Consult lexical authority read-only as evidence; the brief never creates or changes canon, and business intent stays distinct from canonical terminology. Recover each resolved decision from existing brief, specification, review, and handoff artifacts, keeping its resolver, source, status, and any accepted supersession with what it replaced; recency alone never supersedes.

A missing generated authority artifact is the only admissible absence: when functional and semantic decisions are closed, record the evidence gap and continue, because no code, repository, skill, glossary, or ADR edit is a planning prerequisite. A present but malformed, blocked, stale, or conflicting authority artifact, and any layout defect, stays blocking until routed and resolved. If applicable authority is ambiguous or materially contradicts approved intent, or an important decision remains open, take the conflicting decisions, sources, and constraints to the developer through the interview in the Discovery Loop. The developer decides every important functional and technical choice; domain and module owners supply evidence, constraints, and applicable canon without taking that decision; resume only after the developer resolves the conflict or open decision. Route layout defects to `setup-workflow` and semantic gaps to `domain-modeling`. Treat repository evidence as the current implementation, not proof that a proposed behavior is correct. Report contradictions to their owner.

## Discovery Loop

1. Establish the problem, user, desired outcome, and first brief from the request, existing artifacts, and discoverable facts. Record unanswered assumptions as open.
2. When the problem, user, or outcome cannot be recovered, an important choice is open, a material conflict remains, or the developer asks to stress-test the definition, Load the `grilling` skill, scoped to those decisions and supplied with the brief and the authoritative artifacts above. Propose its returned decisions as a brief delta and keep its open blockers open in the brief; that delta's acceptance closes the interview. A minor gap or a settled definition proceeds without it.
3. Confirm scope boundaries; scenarios, states, actions, ordering, and errors; decisions, assumptions, and open questions with resolver, source, status, and accepted supersession; dependencies; deviations; risks; and evidence gaps.
4. Identify shared capabilities the feature reuses, extends, or replaces. Record comparison implementations and observable invariants for each.
5. Recommend `prototype` when an artifact can resolve a functional question. Propose a brief delta from its findings; apply it only after user acceptance.
6. Recommend `feature-critic` when the brief is complete, every material question and assumption has a recorded disposition, prototype findings have a disposition, and every substantive conflict, important open decision, and other evidence gap is resolved or blocks review; a declared absence of a generated authority artifact alone does not block review when functional and semantic decisions are closed and all other criteria are met. The developer may also invoke it earlier on a draft or a single decision; that critique adds no discovery stage.
7. Take the critic's findings back into this loop. Present the simplifications the scope and proportionality lens proposes together, as one question of their own, separate from the other dispositions; each answer is that finding's disposition. Ask the developer for each disposition under the class rules in `feature-critic`, presenting each as the pull-request playbook's approval preview, blocking and pointing to `setup-workflow` when that playbook is absent; product-intent changes and risk acceptance are always asked, whatever the approval policy. Record each disposition, apply only accepted adjustments as brief deltas, preserve the developer's decisions, and return the recorded dispositions and any changed definition to `feature-critic` once step 6 holds.

## Feature Brief

Maintain one user-confirmed brief with the problem and user; desired outcome; scope boundaries; scenarios, states, actions, and errors; decisions, assumptions, and open questions with resolver, source, status, and accepted supersession; business intent, owner, and source kept distinct from canonical terminology; relevant sources; shared-capability comparisons and invariants; prototype findings and disposition; dependencies; deviations; risks; and evidence gaps. Show each brief change for acceptance as the pull-request playbook's approval preview; with no pull-request playbook, block and point to `setup-workflow`. The brief is product intent, so its acceptance is always asked, whatever the approval policy.

## Output Contract

Report the resolved Domain Authority Handoff when present, otherwise report the documented admissible gap; report decisions and assumptions with their disposition, open material questions, sources and contradictions, prototype recommendation or delta, shared-capability evidence, deviations, risks, and blockers. Hand `feature-critic` the complete definition package; leave technical synthesis to `to-spec`.
