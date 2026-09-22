---
name: to-tickets
description: "Trigger: turn a published technical specification into approved, independently verifiable product tickets. Audit coverage, propose relationships, and prepare safe publication."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: derived
---

# Technical Specification to Tickets

## Activation Contract

Use this skill after `to-spec` publishes the current technical specification and consolidated `feature-review` report. It owns the product-oriented ticket breakdown and handoff. It does not rediscover the feature, repeat review, synthesize technical specifications, implement, perform QA impact analysis, or publish pull requests.

## Definition Handoff

Consume the complete published **Definition Handoff**: specification and review report, current package and review handoff, verdict, applicable prototype branch and commit, disposition and UI contract, decisions, deviations, accepted risks, dependencies, native relationships, conditions, and invariants. Verify that the specification and report cover the current package and review handoff, the verdict is `READY` or `READY WITH WARNINGS`, every warning and risk has a disposition, and applicable prototype evidence is consistent. Preserve this handoff without reinterpretation or edits. Return suspected definition defects to their owner with evidence; the user decides whether to restart. The final output cites that handoff reference without duplicating it or creating capture IDs, propagated hashes, or durable state.

Before any mutation request is sent, a missing or inconsistent handoff, unavailable required tracker operation, or required external write capability that cannot be verified is `blocked`: publication cannot proceed and no mutation request was sent. Preflight, handoff, and capability failures can therefore block without tracker evidence. At invocation, ask the harness only for tracker reads and relationship support needed for the audit. After final-preview approval, require write capability and external-action approval before `publish`. Consumer policy supplies metadata, estimates, assignment, and language otherwise. Human-facing tickets are Spanish.

## Inventory and Approval

Use `draft-only` by default; it causes no durable tracker or repository mutation. In either mode, show a suggested inventory before drafting. Map every requirement, scenario, state, dependency, decision, accepted deviation, warning, risk, and invariant exactly once. Classify each as `new subtask`, `existing task to update`, `existing task to move`, `duplicate/absorbed`, `dependency/base`, `external configuration`, or `out of scope`.

Inspect existing tickets, present equivalence evidence, and obtain the user's confirmation before reuse, update, move, or absorption. Classify every dependency as an `implementation dependency`, `external configuration`, or `capability dependency`; a capability dependency is an invocation precondition, not a ticket, relationship, or durable state. Show proposed tickets in dependency order with coverage and relationship proposals. The user approves or reorganizes the inventory; re-audit after every material change. An omission, duplicate, or interpretation concern produces evidence and `restart recommended`, not an automatic block.

## Ticket Drafting

After inventory approval, draft and review tickets one at a time; approve each before drafting the next. Each ticket is an independently implementable vertical slice of product value, practical for one session, not a file, layer, or administrative task. Include a concise, verifiable demo contract: precondition, action, and observable evidence. Fill the mandatory `Alcance` section with one sentence describing what the ticket covers. Split only when every resulting ticket remains independently demonstrable.

Use this uniform, proportional format without duplicating the technical specification:

```md
## Título

<Comportamiento y valor de producto.>

**Como** <actor>, **quiero** <capacidad>, **para** <resultado>.

### Comportamiento

- **Dado** <contexto>, **cuando** <acción>, **entonces** <resultado observable>.

### Criterios de aceptación

- [ ] <Resultado observable y verificable>

### Demo

<Precondición → acción → evidencia observable.>

### Alcance

<Qué cubre este ticket, en una frase.>

### Fuera de alcance

- <Límite solo si puede confundirse.>
```

## Publication and Handoff

In `publish`, present one final preview after all drafts are approved. It lists the final inventory, coverage, tickets, relationships, external effects, and the complete observable Definition Handoff reference: specification and review locations, package and review handoff, verdict, prototype branch/commit (or `N/A`), and authority. Require explicit authorization for that preview, its effects, and that handoff reference. If the handoff changes materially, invalidate authorization, stop publication, re-audit coverage, produce a substitute preview, and require new explicit authorization. Apply the same replacement flow if the operation (`create`, `update`, `move`, or `relationship`), target ticket, content, or relationships changes materially, or any material must be reconstructed. For every `create`, `update`, `move`, or `relationship` mutation, verify the current Definition Handoff and existing-ticket equivalence before acting; reuse one exact match, create when no equivalent exists, and stop on multiple or conflicting matches. Create native parent/child or blocking relationships only after identities exist. Read back each create, update, move, and relationship mutation before continuing.

Outcomes are exhaustive. `blocked` permits no mutation request. `partial failure` follows any sent or possibly sent mutation request, including rejected or unverifiable results or read-backs. For each `partial failure`, stop, report last verifiable frontier, reconcile from tracker evidence, invalidate authorization, produce a complete substitute preview, and obtain new explicit authorization before resuming. If reconciliation is unavailable, remain in `partial failure` and do not resume. Preserve the approved breakdown and successful effects; avoid duplicate tickets or relationships; resume only from verified tracker evidence. Use memory only when validated against authority and tracker evidence; ask the user to reconstruct missing material. Reconstruction requires a complete substitute preview and new explicit authorization.

If the user elects to proceed after a suspected or confirmed definition defect, record the user's closed decision and its impact explicitly in the handoff and completion output.

Report the complete inventory and coverage audit, drafts and dispositions, proposed or verified relationships, open decisions, any closed definition-defect decision and impact, and any publication boundary. Include the observable Definition Handoff reference: specification and review locations, package and review handoff, verdict, prototype branch and commit (or explicit `N/A` when no prototype applies), and authority, without duplicating their contents. Report one invocation-visible outcome: `awaiting user approval`, `auditing`, `ready to publish`, `publishing`, `partial failure`, `published`, `blocked`, or `restart recommended`. Complete only when every source item has one terminal disposition; every decision, warning, risk, and deviation has an explicit disposition; the user approved the organization and every draft; dependencies and relationships were reviewed; and, in `publish`, every approved ticket and required relationship has verified read-back. `draft-only` ends without external effect.
