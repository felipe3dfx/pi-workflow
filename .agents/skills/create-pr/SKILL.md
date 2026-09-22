---
name: create-pr
description: "Trigger: prepare or publish an explicitly approved selected commit, push, pull request, or child-ticket comment. Reconcile publication effects without duplicating an uncertain operation."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0"
  provenance: original
---

# Create a Pull Request

## Activation Contract

Prepare or perform only the requested subset of commit, push, pull-request, relationship, and child-ticket-comment work. Consume consumer workflow, quality, tracker, and PR contracts; the #17 implementation handoff and local validation; current #18 scope evidence; and current repository/provider state. Consumer contracts own commands, bases, policy, templates, and provider mechanisms.

## Decision Gates

Resolve the selected content, ticket/parent relationships, source and proposed destination, and the common #18 snapshot. Retain committed, staged, worktree, and untracked partitions. Reuse classifications; report all pre-existing or unrelated changes and preserve each user inclusion decision. A changed selection invalidates scope and affected quality evidence.

Require operation-specific implementation, validation, and consumer evidence. Report review, QA, test, and CI statuses verbatim. Final PR approval and same-final-snapshot `qa-impact` belong to subsequent #19 review; their absence alone does not block initial or corrective publication. A new commit makes prior approval historical; #19 selects its review or re-review. Return missing or invalid evidence to its owner; do not rerun review, scope, QA, or promotion work.

## Plan and Execution

Draft the exact content, conventional commit message, PR title/body, destination, relationships, and requested tracker artifact. When a PR is requested, draft the append-only Spanish child-ticket comment linking actual publication and evidence; it never changes ticket state. Present one plan listing every durable or external effect. Obtain explicit approval for that exact plan; material changes to content, operations, or destinations require a revised approval.

Before each approved effect, revalidate its inputs. Create commits using existing signing configuration, then confirm the conventional message, valid signature, selected tree, and diff against the planned base exactly match the candidate. Verify push and PR source/destination against observed remote refs. Preserve the original snapshot and validation identities as historical evidence; attach resulting commit and PR identities only to effect evidence.

After a failure, cancellation, concurrent change, or uncertain provider result, stop mutations. Preserve changes and completed effects. Reconcile authoritative repository/provider state before resuming, identify each completed operation, and never retry or duplicate an uncertain effect. Resume only a still-valid approved plan. Recovery that rewrites history, rolls back, or is destructive requires a separately approved consumer-policy-governed recovery plan.

## Output Contract

Return all fields required by the [output schema](references/output-schema.json) on every invocation. Empty arrays/objects and `null` mean known absence or inapplicability; list unavailable requirements in `missing-evidence`. Output is invocation-scoped evidence, not a durable execution ledger. `completed` requires confirmed requested effects; partial or unknown effects are `incomplete`.

## References

Maintainers validating wording and schema coverage, not runtime users, use the [scenario fixtures](assets/fixtures.json), [output fixtures](assets/output-fixtures.json), and `scripts/test_issue20_create_pr.py`.
