---
name: to-tickets
description: "Trigger: turn a published technical specification into approved, independently verifiable product tickets. Audit coverage, propose relationships, and prepare safe publication."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.3"
  provenance: derived
---

# Technical Specification to Tickets

## Activation Contract

Run after `to-spec` publishes the current specification and consolidated `feature-review` report; it owns the product ticket breakdown, its parent relationship, and handoff, not rediscovery, review, synthesis, implementation, QA, or pull requests.

## Definition Handoff

Consume the published **Definition Handoff** as is, never reopening definitions or closing recommendations. It carries the specification, review report, parent, package/review handoff, verdict, prototype branch/commit, disposition and UI contract, decisions (resolver, source/authority, status, accepted supersession with what it replaced), deviations, accepted risks, dependencies, native relationships, conditions, and invariants. Verify currency, a `READY` or `READY WITH WARNINGS` verdict, a disposition for every warning and risk, consistent prototype evidence, and, in GitHub or Linear, an open parent citing the specification, even without children; a specification issue is its own parent. Keep that trail by pointer in durable artifacts, not conversation, memory, or temporary files, adding no duplicate, capture ID, hash, template, stage, or state; tickets cite each implemented decision's source; acceptance criteria verify it. Return suspected definition defects to their owner with evidence; the user decides whether to restart.

A missing generated authority artifact alone does not block once functional and semantic decisions are closed and readiness otherwise holds; report the gap, never as a recurring waiver; a present but malformed, stale, blocked, or conflicting one still blocks. Genuine semantic, functional, or technical conflicts go to the developer with sources and canon; owners supply evidence, never the decision.

Request only the audit's tracker reads and relationships, and write capability before `publish` mutates; before any mutation request, a missing or inconsistent handoff, unavailable required tracker operation, or unverifiable write capability is `blocked`. Consumer policy supplies metadata, estimates, assignment, and language otherwise; human-facing tickets are Spanish.

## Inventory and Approval

Use `draft-only` by default; it mutates no tracker or repository. Approvals follow the pull-request playbook's approval policy and approval preview; with none recorded, use `every-step` and [the shipped rules](../setup-workflow/assets/pull-requests.md#approval-gates-and-external-effects), telling the user once to run `setup-workflow update`. The policy never changes the mode. Show a suggested inventory before drafting. Give every in-scope requirement one accountable child and observable outcome; a child may own several, and classified dependencies and exclusions are dispositions, not requirements. Map every scenario, state, dependency, decision, accepted deviation, warning, risk, and invariant exactly once as `new subtask`, `existing task to update`, `existing task to move`, `duplicate/absorbed`, `dependency/base`, `external configuration`, or `out of scope`, with exclusions scoped to this handoff.

Inspect existing tickets, present equivalence evidence, and confirm reuse, update, move, or absorption where the approval policy asks, always when equivalence is open. Reuse a prior confirmation only within its exact scope, never repeating an identical question or inferring universal permission. A capability dependency is an invocation precondition, not a ticket, relationship, or state; other dependencies are `implementation dependency` or `external configuration`. Order proposed tickets by dependency, showing coverage, ownership boundaries, and conceptual dependencies distinct from native relationships, which only publication creates. Re-audit after every user reorganization or material change. An omission, duplicate, or interpretation concern yields evidence and `restart recommended`, not a block.

## Ticket Drafting

Draft and review tickets one at a time; under `every-step`, approve each before drafting the next. Each ticket is an independently implementable vertical slice of product value for one session, not a file, layer, or administrative task, stating its verifiable outcome. `Demo` and `Alcance` are mandatory. Coverage, demo, estimate, implementation, and QA are separate, non-substitutable evidence; an open ticket never proves pending work. Split only into independently demonstrable tickets.

Use this proportional format without duplicating the specification:

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

In `publish`, present one final approval preview: final inventory with each requirement's owner and outcome, tickets, relationships with each moved ticket's previous parent, external effects, and the Definition Handoff reference (specification and review locations, parent, package/review handoff, verdict, prototype branch/commit or `N/A`, authority). Authorize that preview and its effects; `autonomous` publishes and reports. A material change to the handoff, scope, operation, target, content, or relationships, or reconstructed material, invalidates authorization and the confirmations it touches, leaving others reusable: stop, re-audit coverage, produce a substitute preview, and require new explicit authorization. Before every mutation, verify the current handoff and equivalence; reuse one exact match, create when none exists, and stop on multiple or conflicting matches, including a reused ticket under another parent not confirmed as a move. Only after identities exist, create native relationships and, in GitHub and Linear, hang every new, updated, and confirmed-moved ticket except `dependency/base` from the parent; parents never replace blockers. Read back each mutation before continuing.

`blocked` permits no mutation request. `partial failure` follows any sent or possibly sent mutation request, including rejected or unverifiable results or read-backs: stop, report the last verifiable frontier, reconcile from tracker evidence, invalidate authorization, produce a complete substitute preview, and always obtain new explicit authorization before resuming; without reconciliation, remain in `partial failure`. Preserve the approved breakdown and successful effects, avoid duplicates, resume only from verified tracker evidence, trust memory only when validated against it and authority, and ask the user to reconstruct missing material.

Report the Definition Handoff reference without duplicating it, inventory, coverage audit, drafts and dispositions, relationships, any authority-artifact gap, each decision's status, sources, and supersession, any decision to proceed despite a suspected or confirmed definition defect with its impact (recorded in the handoff), and any publication boundary, with one outcome from: `awaiting user approval`, `auditing`, `ready to publish`, `publishing`, `partial failure`, `published`, `blocked`, or `restart recommended`. Complete only when every inventoried source item has one explicit terminal disposition; the organization and every draft cleared the approval policy; dependencies and relationships were reviewed; and, in `publish`, every approved ticket and required relationship has verified read-back.
