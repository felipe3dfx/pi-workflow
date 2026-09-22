---
name: feature
description: "Trigger: define a product feature from an idea or tracker issue. Run progressive discovery and maintain a user-confirmed functional brief."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Feature Definition

## Activation Contract

Use this skill to turn a free-form idea or tracker issue into a coherent functional definition. It owns product discovery and the feature brief; `domain-modeling`, `to-spec`, and `feature-review` retain their respective authority.

## Inputs and Authority

Read the consumer's recorded contracts, resolved Domain Authority Handoff, applicable accepted ADRs, repository evidence, and local design conventions. If required authority is absent, ambiguous, or contradictory, block the definition, route layout defects to `setup-workflow` and semantic authority gaps to `domain-modeling`, and resume only after resolution. Use canonical domain language without changing its authority. Treat repository evidence as the current implementation, not proof that a proposed behavior is correct. Report contradictions to their owner.

## Discovery Loop

1. Establish the problem, user, desired outcome, and first brief. Ask one material question per round and ground a recommendation in available evidence. Record unanswered assumptions as open.
2. Confirm scope boundaries; scenarios, states, actions, ordering, and errors; decisions, assumptions, and open questions; dependencies; deviations; risks; and evidence gaps.
3. Identify shared capabilities the feature reuses, extends, or replaces. Record comparison implementations and observable invariants for each.
4. Recommend `prototype` when an artifact can resolve a functional question. Propose a brief delta from its findings; apply it only after user acceptance.
5. Recommend `feature-review` when the brief is complete, every material question and assumption has a recorded disposition, prototype findings have a disposition, and contradictions and evidence gaps are resolved or block review. A functional change requires renewed review; an editorial correction preserving meaning does not.

## Feature Brief

Maintain one user-confirmed brief with the problem and user; desired outcome; scope boundaries; scenarios, states, actions, and errors; decisions, assumptions, and open questions; relevant sources; shared-capability comparisons and invariants; prototype findings and disposition; dependencies; deviations; risks; and evidence gaps.

## Output Contract

Report the resolved Domain Authority Handoff, decisions and assumptions with their disposition, open material questions, sources and contradictions, prototype recommendation or delta, shared-capability evidence, deviations, risks, and blockers. Hand `feature-review` the complete definition package; leave technical synthesis to `to-spec`.
