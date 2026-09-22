---
name: promotion-readiness
description: "Trigger: audit a specified delivery's promotion readiness against a user-confirmed destination. Aggregate read-only provenance, parent coverage, final review, and same-snapshot QA evidence."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: original
---

# Audit Promotion Readiness

## Activation Contract

Audit one specified delivery against its explicit user-confirmed destination. This is feedback only: inspect authoritative artifacts and normalized harness evidence; create no promotion, publication, mutation, approval, review, QA execution, scope classification, runbook, command, or operational next step.

## Decision Gates

Resolve source content, its #18 common snapshot, parent requirements, working base, production base, and destination confirmation for this invocation. Propose recorded consumer values, but audit the selected destination even when it differs. Working and production bases are separate consumer values, never fixed branch names. If the destination is absent or unconfirmed, return `BLOCKED`, name it in `missing-evidence`, and leave the manual decision to the user.

Consume #18 classifications and traceable issue, PR, and commit relationships without repairing or reclassifying them. Consume #19's final PR review and `qa-impact` from the same final snapshot; publication effects, a draft, or historical approval do not substitute. A corrective commit leaves earlier approval historical until applicable #19 re-review and final QA evidence exist. Preserve every source status, identity, reference, snapshot, freshness result, gap, and disposition verbatim.

Parent coverage and provenance are evaluated facts, not provider integrations. Optional normalized stack evidence may establish bases, dependencies, relationships, commits, PRs, or states; equivalent traceable non-stack evidence is valid. A stack alone proves neither coverage nor approval.

## Audit

1. Inventory approved scope, integration origin, parent requirements, accepted deviations, review, QA, source/destination freshness, and evidence access. Record missing, foreign, incomplete, contradictory, stale, and untraced material with impact and user disposition; never make it current or successful by acceptance.
2. Assess evidence sufficiency and consistency, rather than repeating code-quality review or QA. Preserve upstream tokens even when their effect differs from the aggregate verdict.
3. Return `BLOCKED` when absent, contradictory, inaccessible, or stale evidence prevents a meaningful assessment. Return `READY WITH WARNINGS` when the delivery remains evaluable but gaps, adverse results, incomplete provenance, pending/accepted dispositions, or risks remain. Return `READY` only when evidence is sufficient, fresh, consistent, and warning-free. Warnings never upgrade missing or failed evidence.
4. Emit the complete JSON shape in [the runtime output schema](references/runtime-output-schema.md). Before producing output, read it; it defines nested types, explicit absence, and the #18 snapshot reference. Use [synthetic fixtures](assets/promotion-readiness-fixtures.json) only when maintaining this skill; a runtime does not need them.

## Completion

State what the evidence supports and what requires review. Each verdict describes evaluability, not permission or a physical restriction on the user's manual action.
