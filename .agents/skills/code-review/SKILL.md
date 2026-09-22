---
name: code-review
description: "Trigger: review a working diff, branch, or pull request against Standards and Spec. Produce a read-only, draft-only senior-review handoff with normalized findings."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0.2"
  provenance: original
---

# Review Code Changes

## Activation Contract

Review one candidate against applicable Standards and ticket/spec authority. Produce a draft for a senior human reviewer. Remain read-only: inspect evidence and temporary isolated artifacts only; create no external effect.

## Decision Gates

Resolve repository/PR identity, target kind, base and head, snapshot, prior-review identity, and evidence freshness. Consume current `scope-audit` evidence without reclassifying units. Reuse it only when `snapshot-version`, target, selected scope, repository, base/current refs, branch, repository status, and every canonically ordered committed/staged/worktree/untracked partition entry (`path`, `change`, `source-path`, `mode`, `diff`) match by deep equality. Refresh it only when missing, incomplete, stale, for another target, or contradicted by the observed snapshot; use replacement evidence only after revalidation. Apply precedence: `blocked` for an inaccessible target, contradictory authorities without governing resolution, or a required capability that is unavailable with no approved degraded path. An unavailable capability is allowed only with an explicitly approved, evidenced degraded path; `incomplete-context` applies only when the target is accessible and required evidence is missing, stale, mismatched, or incomplete. Propagate `scope-audit` status: `blocked` stays blocked and `incomplete-context` stays incomplete until refreshed and revalidated. Return `ready` only after completing the required inventory of the current target and snapshot, ready scope-audit, implementation handoff, authorities, breadcrumbs, and relevant discussion. An empty relevant-discussion inventory is valid when none exists. A missing prior review selects initial mode; only an identified prior review with unverifiable evidence is incomplete.

Select `initial` when no prior review exists or the caller explicitly requests a review from scratch; otherwise select `re-review`. An initial review examines the complete candidate while attributing every finding to it. A re-review first compares code and relevant discussion with the prior review: when neither changed, stop with zero new findings and state explicitly that nothing changed, nothing new was commented, and the prior review remains valid. When only discussion changed, assess prior findings only and emit zero new findings. When code changed, inspect only the delta from the reviewed snapshot plus necessary context; a defect introduced or exposed by that delta is a normal finding and must cite the exposing delta.

## Execution

1. Read Standards, ticket/spec, accepted decisions, scope evidence, implementation handoff, breadcrumbs, candidate context, prior findings, and relevant discussion. Complete this inventory before evaluating findings; if any required authority or evidence is absent, stale, mismatched, or inaccessible, apply the status gate instead of guessing.
2. Record every prior actionable comment as `resolved`, `accepted-argument`, `unresolved`, or `not-verifiable`. Accept an argument only when it is an explicit response in the PR or a visible tracker decision, with stable reference, author, time, affected unit, and relationship to the comment. Classify a non-requested, non-argued change as `unrequested-change`; assign severity from demonstrated risk.
3. Normalize each new finding with stable ID, location, claim, exact evidence, impact, severity, confidence, applicable Standard or Spec authority, requested action, and traceability. Include zero findings explicitly.
4. Write the Output Contract to the handoff file, including target validation, mode, scope evidence, implementation handoff, decisions/ADRs, breadcrumbs, deviations with rationale, findings, prior-comment outcomes, and senior-review context. Answer the human with the short draft only.
5. Mark the output `draft-only`; do not comment, approve, request changes, change tracker state, commit, create a PR, or publish.

## Completion

A human records publication approval separately. A pre-approval draft may be `ready`; `qa-impact` is not required to produce that draft. Any later code change invalidates human approval. After human approval, require `qa-impact` on the approved head and same final snapshot before considering the overall process complete; a missing or mismatched result then yields `incomplete-context`.

## Handoff channel

Write the Output Contract JSON to `ilao-code-review-handoff.json` inside a new directory in the platform temporary directory for this invocation. Do not write it in the repository, do not name an operating-system path, and do not put the JSON in the human message. The human message states status, review mode, each finding's id, severity, claim, and requested action, or an explicit zero-finding result, the next action, and that handoff path. Both the message and the file must exist before the run is complete. If a later run needs the file and it is gone, regenerate it. Do not block the user and do not print the JSON.

Chat example: "Draft-only. Status ready. Mode initial. F1 high: claim. Requested action: name it. Next: the senior reviewer decides publication. Handoff: the temporary path." The file holds the Output Contract, including nested snapshots. The message does not.

## Output Contract

Write valid JSON to the handoff file, with every key present: `schema-version: "1.0"`, `status`, `draft-only: true`, `target`, `snapshot`, `validation`, `review-mode`, `consumed-scope-audit`, `implementation-handoff`, `breadcrumbs`, `decisions-and-adrs`, `deviations`, `prior-review`, `prior-comment-outcomes`, `findings`, `senior-review-context`, `scope-refresh`, `qa-impact-requirement`, `missing-context`, `invalidation-details`, and `read-only-no-mutation: true`. `target` contains `repository`, `id`, and `kind`; `snapshot` contains `snapshot-version`, `target-id`, `target-kind`, `selected-scope`, `repository-id`, `base-ref`, `current-ref`, `branch`, `repository-status`, and ordered `paths-and-diffs` partitions whose entries contain `path`, `change`, `source-path`, `mode`, and `diff`; `validation` contains `current`, `mismatches`, `unavailable`, and `omitted`; each finding contains stable `id`, `location`, `claim`, `evidence`, `impact`, `severity`, `confidence`, `authority`, `requested-action`, and `traceability`; each prior outcome contains `comment-id`, `outcome`, and evidence, and `accepted-argument` additionally contains a non-null `argument-source` with `kind`, `reference`, `author`, `time`, `unit`, and `relationship`; other outcomes may use `null`.

`consumed-scope-audit` must contain `schema-version: "1.0"`, `status`, `snapshot`, `validation`, `classifications`, `responsibility-surfaces`, `foreign-and-excluded-pre-existing`, `unresolved-units`, `missing-context`, `invalidation-details`, `qa-impact-handoff`, and `read-only-no-mutation: true`. Its `snapshot` uses the exact schema above and must deep-equal `snapshot`; its `status` propagates `blocked` and `incomplete-context`, and `status: ready` is required for a ready review. It must deep-equal the supplied scope-audit as a whole, field for field, including `validation` and `foreign-and-excluded-pre-existing`, and must reject unsupported extra fields. `qa-impact-handoff` contains `handoff-version: "1.0"`, `handoff-state: present`, `snapshot-identity`, `scope-status`, `classifications`, `responsibility-surfaces`, `unresolved-units`, `missing-context`, and `invalidation-details`; `snapshot-identity` uses the exact snapshot schema and must deep-equal `snapshot`, `scope-status` must equal the consumed scope-audit `status`, and its `classifications`, `responsibility-surfaces`, `unresolved-units`, `missing-context`, and `invalidation-details` must each deep-equal the matching `consumed-scope-audit` value.

Keep stable finding IDs across re-reviews, use empty arrays/objects or `null` explicitly, and emit exactly one outcome per prior actionable comment. Use only `ready`, `incomplete-context`, or `blocked` for status.
