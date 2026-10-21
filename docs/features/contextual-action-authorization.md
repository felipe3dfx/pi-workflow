# Contextual action authorization

## Status and authority

Draft functional brief; implementation is not authorized.

Decision owner: the user. Confirmed decisions below originate in the
current feature-discovery conversation.

Domain authority: GLOSSARY.md. No generated Domain Authority Handoff
was found; this is a documented evidence gap, not invented authority.
This brief proposes policy changes but does not modify canonical
definitions or current operational rules.

## Problem and outcome

Growing command inventories and role-specific tool restrictions
interrupt legitimate delegated work and require continual maintenance.

Replace those authorization restrictions with contextual evaluation
of the assignment, instructions, proposed action, target, and effects.
Do not add a classifier while retaining the inventories it replaces.

## User-confirmed behavior

- Parent and child sessions can access the same tools. Availability
  does not grant unrestricted permission to use them.
- Assignment instructions define authority. Reasonably necessary
  in-scope steps are authorized without enumerating commands.
- Scope expansion or an undelegated decision requires consultation.
- Destructive or high-impact actions require explicit confirmation;
  authority cannot be inferred solely from the task objective.
- Expanding scope does not replace explicit confirmation of a destructive
  or high-impact action. One response can approve both if it clearly
  identifies the action and its target; two consultations are not required.
- Uncertainty escalates from child to parent, then to the user when
  the parent cannot resolve it.
- Classifier failure or unavailability follows that same path:
  no automatic execution and no terminal rejection merely because
  classification failed.
- Authorization works with or without Jev. Jev remains responsible
  only for routing destination.

## Observable scenarios

An ordinary edit or verification step needed for an assigned correction
may proceed. Unrelated changes require consultation. Publishing a
release or discarding another person's work is not implicitly authorized
by an implementation task. Unknown effects or unclear ownership require
escalation before execution.

Equivalent authority and actions receive equivalent authorization
regardless of parent/child identity or Jev routing state.

## Existing capabilities and policy changes

Reuse existing tools and parent/user communication capabilities.

The approved intent replaces ADR 0013's command-based child restrictions
and ADR 0017's role-specific tool restrictions where they conflict with
this feature. Preserve ADR 0017's destination-only Jev behavior.

Review impacts on ADRs 0015, 0018, 0020 and glossary Contract/Checkpoint
definitions before implementation. Do not silently remove procedural,
signing, confirmation, or other applicable obligations.

Gentle AI provides instructional child-to-parent escalation.
Gentle Shell demonstrates independent contextual classification for
primary sessions, but retains deterministic child guards. Neither
demonstrates the complete replacement proposed here.

## Accepted prototype evidence

Disposition: reference-only, explicitly accepted by the user.

Evidence: .agents/prototypes/action-classification/evidence/

One model classified 16 synthetic cases across four contexts:
64/64 expected results, zero false permits, and consistent labels.
Mean latency was 3.31 seconds per action; p95 was 6.20 seconds.

This supports exploratory feasibility, not general safety or production
readiness. Execution, real escalation and routing were not exercised.
The prototype is evidence, not an implementation base.

## Open adoption decisions and risks

The user considers observed latency high but accepts it as a measurement
baseline, not a final target. Compare model and context alternatives
using both latency and authorization errors.

Acceptable latency and sufficient real-world evidence remain open.
No model, caching strategy, additional inference budget, or production
adoption is approved.

Risks include incorrect permission, unnecessary escalation and repeated
classification delay. Real escalation integration remains unverified.

## Next step

Review this draft and its open decisions with feature-critic.
Resolve material findings and adoption criteria before handing a
completed definition to to-spec.
