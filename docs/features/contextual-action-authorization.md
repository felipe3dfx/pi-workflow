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

A child of any role assigned to create a commit may create a signed
commit containing only its authorized changes, preserving others' work,
in its assigned and authorized working context, retaining isolation where
agents could interfere with one another. A separate worktree and distinct
branch are not required for every commit. It need not be a worker or use
only the checkpoint tool. An edit-only assignment or the
availability of a commit tool alone does not authorize that commit or
publication; unclear authority or commit context requires escalation.

## Existing capabilities and policy changes

Reuse existing tools and parent/user communication capabilities.

The approved intent replaces ADR 0013's command-based child restrictions
and ADR 0017's role-specific tool restrictions where they conflict with
this feature. Preserve ADR 0017's destination-only Jev behavior.

### Approved child-commit delta

Resolver: the user. Source: the user's “Si” in the current conversation
accepting this exact recommendation:

> Recomiendo eliminar esa exclusividad: cualquier hijo podría crear un commit cuando su tarea lo autorice, conservando la firma obligatoria, el alcance asignado y el cuidado del trabajo ajeno. La disponibilidad de herramientas no autorizaría por sí sola un commit o una publicación.

Status: `approved delta`; renewed feature-critic review required.

Accepted supersession intent: replace ADR 0020's worker-only and
checkpoint-tool-exclusive commit restrictions, and its mandatory separate
checkpoint grant insofar as task authorization replaces that grant as
commit permission. Preserve mandatory signing, assigned scope, protection
of others' work, and applicable confirmation obligations. Tool availability
alone grants neither commit nor publication authority. This records product
intent, not an amendment to ADR 0020 or the glossary's Contract/Checkpoint
definitions; current operational rules remain in force.

### Approved commit-context isolation delta

Resolver: the user. Source: explicit approval in the current conversation
of this exact recommendation:

> no exigirlos [worktree y rama separados] para todo commit: el hijo usaría el contexto de trabajo asignado y autorizado; cuando varios agentes puedan interferir entre sí, se mantendría el aislamiento. Así evitamos convertir un mecanismo útil en otro bloqueo universal.

Status: `approved delta`; the commit-context decision is resolved. Renewed
feature-critic review required.

Accepted supersession intent: alongside the worker-only, checkpoint-tool-
exclusive and separate-grant restrictions replaced above, replace ADR 0020's
isolated-worktree/distinct-branch conditions as universal prerequisites for
task-authorized child commits. The child uses its assigned and authorized
working context; retain isolation where agents could interfere with one
another. Preserve mandatory signing, assigned scope, protection of others'
work, and applicable confirmation obligations. This is not a general
isolation waiver or publication permission. ADR 0020's current checkpoint
rules and canonical definitions remain unchanged until implementation;
this brief records scoped proposed supersession, not runtime authority.

Review impacts on ADRs 0015, 0018, 0020 and glossary Contract/Checkpoint
definitions before implementation. Preserve other procedural, signing,
confirmation, and scope protections except the explicitly replaced
restrictions above. Canonical changes remain separate work.

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
readiness. That classification prototype did not exercise execution,
real escalation or routing. It is evidence, not an implementation base.

Second prototype: reference-only, explicitly accepted by the user in the
current conversation. Existing question/reply mechanisms support escalation
in an isolated integration with simulated decisions. Real parent reception
through the SDK, reasoning, human interaction and authorization of real
actions remain unverified.

Evidence: [escalation integration observations](../../.agents/prototypes/action-escalation/evidence.json).

## Open adoption decisions and risks

The user considers observed latency high but accepts it as a measurement
baseline, not a final target. Compare model and context alternatives
using both latency and authorization errors.

Acceptable latency and sufficient real-world evidence remain open.
No model, caching strategy, additional inference budget, or production
adoption is approved.

Risks include incorrect permission, unnecessary escalation and repeated
classification delay. Existing question/reply and operator-question seams
were exercised in isolation with simulated decisions; real end-to-end
escalation and action authorization remain unverified.

## Next step

Return this changed definition to the parent's renewed three-lens
feature-critic review before to-spec resumes. The existing critic report
remains a prior snapshot: its verdict does not cover the approved delta.
Resolve material definition findings before handing a completed definition
to to-spec. The open adoption choices above are deliberate evaluation
questions, not missing authorization behavior or a mandatory further prototype.

## Accepted residual risk — definition only

Resolver: the user. Source: explicit acceptance in the current conversation.
Status: `risk accepted` for continuing functional definition only.

> Se acepta continuar la definición con la integración real aún sin validar. Esto no autoriza su uso en producción. Antes de adoptarla deberán verificarse el escalamiento completo y la autorización de acciones reales, y acordarse criterios de precisión y latencia a partir de mediciones.

Reason: the remaining real-integration evidence belongs to adoption evaluation,
not a mandatory further prototype for continuing definition. This is not a
permanent risk waiver: full escalation and real action authorization must be
validated before adoption. Numeric accuracy and latency criteria remain open;
no model or caching strategy is chosen. This disposition neither accepts the
final brief nor establishes readiness or production authorization.
