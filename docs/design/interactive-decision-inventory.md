# Interactive decision migration inventory

Status: current implementation ledger for ILA-2474. Linear ILA-2438 remains the product design source.

Active unmigrated closed decisions: 0

Every active closed human choice below is prepared by `extensions/interactive-decisions.ts`, rendered by `extensions/pi-decision-adapter.ts` as either the compatible Pi panel or its numbered fallback, and includes `decision.cancel`. A semantic tool action selects a previously claimed choice; neither prose nor the action payload authorizes an effect.

## Migrated decisions

| Logical operation | Shared semantic actions | Runtime and durable evidence | Fencing and domain preconditions | Status |
| --- | --- | --- | --- | --- |
| Define product route | `define-product.route.confirm`; `decision.cancel` | `extensions/define-product-runtime.ts`; execution manifest reference binds the recommendation digest | Revalidates the route decision lease before starting research | migrated |
| Define product team selection | `define-product.team.select.<teamId>`; `decision.cancel` | `extensions/define-product-runtime.ts`; execution manifest reference binds the immutable team ID | Revalidates the selected team and lease before Spec generation | migrated |
| Define product Spec approval and parent publication | `define-product.spec.publish`; `decision.cancel` | `extensions/define-product-runtime.ts`; `extensions/spec-approval-recovery.ts`; `extensions/define-product-publication-recovery.ts`; `extensions/publication-manifest.ts` | One lease covers approval and the complete parent-publication protocol; authority, artifact, target, and Linear state are checked before mutation | migrated |
| Define product ticket graph approval and publication | `define-product.tickets.publish`; `decision.cancel` | `extensions/define-product-runtime.ts`; `extensions/ticket-approval-recovery.ts`; `extensions/ticket-publication-manifest.ts` | One lease covers every child and blocker call; manifest, graph, parent, authority, capability, permission, and state are rechecked before each mutation | migrated |
| Define product approved revision publication | `define-product.revision.publish`; `decision.cancel` | `extensions/define-product-runtime.ts`; `extensions/approved-revision-store.ts`; `extensions/approved-revision-publication-manifest.ts` | One lease covers every comment and description call; revision, actor, content, and per-issue state are rechecked before mutation | migrated |
| Product review result and publication | `product-review.publish.accepted`; `product-review.publish.changes-required`; `decision.cancel` | `extensions/product-review-mcp-publication.ts`; `extensions/product-review-publication-recovery.ts` | One lease binds the selected immutable artifact; protected issue state, authority, comment marker, and recovery evidence are checked before the sole mutation | migrated |
| QA handoff publication | `qa-handoff.publish`; `decision.cancel` | `extensions/qa-handoff-mcp-publication.ts`; `extensions/qa-handoff-publication-recovery.ts` | One lease binds the exact handoff artifact; issue, assignee, authority, evidence, and comment marker are checked before the sole mutation | migrated |
| Agent asset apply | `sync.apply.execute`; `decision.cancel` | `extensions/agent-asset-sync.ts`; schema-v2 operation evidence in `extensions/agent-asset-operation.ts` | One lease covers all conditional file writes; each write checks fencing, approved predecessor digests, containment, and the cooperative lock | migrated |
| Agent asset resume | `sync.resume.execute`; `decision.cancel` | `extensions/agent-asset-sync.ts`; schema-v2 operation evidence in `extensions/agent-asset-operation.ts` | A separate lease binds the immutable operation ID; every recovery write checks fencing and verified successor evidence | migrated |
| Agent asset rollback | `sync.rollback.execute`; `decision.cancel` | `extensions/agent-asset-sync.ts`; schema-v2 operation evidence in `extensions/agent-asset-operation.ts` | A separate lease binds the immutable operation ID; every compensating write checks fencing and verified predecessor evidence | migrated |
| Companion package and MCP installation | `companions.install`; `decision.cancel` | `extensions/companion-workflow.ts`; `extensions/companion-install-manifest.ts`; failures discriminate package identity from MCP path | One lease covers the joint package and MCP plan; every effect checks fencing and current package or targeted MCP state | migrated |
| Companion partial or drift recovery | `companions.reconcile`; `companions.wait`; `decision.cancel` | `extensions/companion-workflow.ts`; `extensions/companion-install-manifest.ts` | A new recovery lease records the attempt and retries only incomplete effects after current-state verification | migrated |
| Delivery PR diff review | `delivery.review.approve`; `delivery.review.reject`; `decision.cancel` | `extensions/delivery-pull-request-workflow.ts`; its CAS-backed review manifest state | One review lease binds the exact snapshot and draft before Git inspection; repository identity is checked under fencing | migrated |
| Delivery PR publication | `delivery.pr.confirm`; `delivery.pr.reject`; `decision.cancel` | `extensions/delivery-pull-request-workflow.ts`; its CAS-backed publication manifest state | One publication lease covers every Git/GitHub call; repository and existing-PR state are rechecked immediately before gateway-enforced publication | migrated-non-runtime |

`migrated-non-runtime` means the reusable contract is migrated but is not composed into a public capability. It does not make `deliver-ticket` implemented.

## Pending capability

| Capability | Public status | Contract |
| --- | --- | --- |
| `deliver-ticket` | pending | `extensions/pi-workflow.ts` and `extensions/public-entry-guard.ts` admit only the interactive anchor and block every tool. `skills/deliver-ticket/SKILL.md` returns `PI_WORKFLOW_CAPABILITY_PENDING`. The Delivery PR module cannot be reached through this public entry. |

## Intentional compatibility-only symbols

These names remain for persisted data, direct injected test seams, transport, or lifecycle routing. They are not active public authorization routes.

| Symbol or shape | Why it remains |
| --- | --- |
| `awaitingConfirmation`, `awaitingSpecApproval`, `awaitingPublication`, `awaitingTicketApproval`, `awaitingTicketPublication`, `awaitingApprovedRevisionApproval`, and `approvalConfirmation` in `extensions/define-product-runtime.ts` | Private phase routing and restart restoration. Shared claims and execution leases authorize effects in the default composition. |
| `action` values such as `publish_spec`, `publish_tickets`, `publish_handoff`, `select_result`, and `cancel_decision` | Narrow model-to-runtime transport after a private shared claim. They carry no authority and fail without the matching decision state. |
| `authorizeInvocation` in `extensions/qa-handoff-workflow.ts` and direct gateway workflows | Explicit injected compatibility/test seams. The packaged QA runtime uses `extensions/qa-handoff-mcp-publication.ts` with shared decisions. |
| `decision: "stop" | "proceed"` in `extensions/review-router.ts` | Deterministic review-plan output, not a human prompt or authorization decision. |
| Legacy artifact normalization and historical actor fields | Read-only compatibility for already persisted canonical artifacts; current stores do not write legacy shapes. |
| Manual companion installation instructions | Failure recovery guidance only. The active automatic installation path still requires shared authority and performs no mutation without it. |

## Contract gate

The migration remains complete only while all of the following are true:

1. This ledger reports zero active unmigrated closed decisions.
2. Implemented skills delegate closed-choice presentation to the shared descriptor and never require an exact phrase.
3. `public-entry-guard` permits `ask_user_question` only for a compatible active decision.
4. Every logical operation uses one execution lease for all internal effects.
5. Durable execution evidence includes `decisionId`, `operationDigest`, `executionId`, and `generation` before the first effect.
6. Every mutation boundary rechecks the lease plus its domain-specific predecessor or read-back evidence.
7. The packed acceptance report contains the `interactive-decisions` scenario and preserves `deliver-ticket` as an intentional refusal.
8. Compatibility construction without shared authority fails closed and cannot convert arbitrary prose into route, Spec, ticket, or revision authorization.
