---
name: qa-impact
description: "Trigger: derive supplemental manual QA coverage for a scoped candidate, including mandatory final impact before final review publication. Return ready evidence or explicit incomplete context."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0.1"
  provenance: original
---

# Analyze Indirect Manual QA Impact

## Activation Contract

Use preventively to derive read-only, supplemental indirect manual regression coverage from a scoped candidate. Do not edit files, execute QA, create tests or captures, publish tracker updates, commit, or decide correctness, security, architecture, test sufficiency, release readiness, or code review.

The consuming review process requires this result on the same final snapshot before final review publication; earlier or different snapshots are `incomplete-context`, not final-QA evidence.

## Required Inputs and Handoff

Require approved ticket/spec behavior authority, applicable consumer contracts, and changed-system evidence. Consume one of these exact scope-audit handoff variants:

- `present`: `handoff-version`, `snapshot-identity`, `scope-status`, `classifications`, `responsibility-surfaces`, `unresolved-units`, `missing-context`, and `invalidation-details`, with every snapshot field complete;
- `absent`: `handoff-version: "1.0"`, `handoff-state: absent`, `absence-reason: missing-scope-evidence`, and a non-empty `missing-context` list. Do not invent snapshot, classification, or surface evidence. Resolve and emit the current top-level `snapshot`; only the consumed handoff uses the absent variant, so `snapshot: null` is invalid.

For a `present` handoff, match every `snapshot-identity` field exactly against a current common snapshot: `snapshot-version`, `target-id`, `target-kind`, `selected-scope`, `repository-id`, `base-ref`, `current-ref`, `branch`, `repository-status`, and canonically ordered committed, staged, worktree, and untracked `paths-and-diffs` partitions by deep equality. Branch and pull-request targets use committed partitions; working-tree and capture targets may also use staged, worktree, and untracked partitions.

Apply this precedence: `blocked` when the target or a required harness capability is inaccessible, no approved degraded path exists, or approved authorities contradict one another without a governing resolution; then an `absent` handoff yields `incomplete-context`; for a present handoff, `scope-status: blocked` propagates `blocked`, `scope-status: incomplete-context` propagates `incomplete-context`, and only `scope-status: ready` permits QA evidence evaluation; after a ready scope handoff, incomplete candidate evidence yields `incomplete-context`; `ready` requires current and complete capabilities, authority, handoff, and changed-system evidence. Put `invalidated` only in `invalidation-details`, never in `status`.

## Analysis Procedure

1. Consider only traced, non-foreign units inside the consumed scope boundary; retain foreign and `untraced` material as distinct exclusions. `untraced` has an evidenced absence of ownership traceability, not missing authority; do not turn it into an unresolved exposure.
2. Connect each relevant indirect exposure to an evidenced existing journey, integration, state transition, or observable. Do not infer impact from path names or claim the implementation works.
3. For each exposure, emit one proportional supplemental manual case or an evidence-backed no-impact rationale. A case includes affected journey/integration, trigger, setup, action, expected observable, rationale, and linked unit.
4. Exclude direct task scenarios and do not replace evidence gaps with speculative cases. `untraced` is a scope-audit classification with evidenced absent traceability; unresolved authority/evidence is not untraced and must propagate `incomplete-context`.
5. Draft, but never publish, a tracker comment according to the publication contract.

## Handoff channel

Write `ilao-qa-impact-handoff.json` in a new platform-temp directory for this invocation. Do not write it in the repository, name an OS path, or put the JSON in the human message. The human message is the Spanish draft plus that path. Both must exist. Regenerate a missing later file. Do not block or print the JSON.

## Output and Publication Contract

Write valid JSON to the handoff file, matching this field schema (union annotations are notation, not literal values). Every key is mandatory; use `[]`, `{}`, or `null` when empty. Path partitions may be empty. `ready`, `incomplete-context`, and `blocked` are the only status tokens.

```yaml
schema-version: "1.0"
status: ready | incomplete-context | blocked
snapshot:
  snapshot-version: "1.0"
  target-id: string
  target-kind: capture | working-tree | branch | pull-request
  selected-scope: string
  repository-id: string
  base-ref: string | null
  current-ref: string | null
  branch: string | null
  repository-status: string | null
  paths-and-diffs:
    committed:
      - { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string }
    staged:
      - { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string }
    worktree:
      - { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string }
    untracked:
      - { path: string, change: added, source-path: null, mode: string | null, diff: string }
validation: { current: boolean, handoff-match: boolean, mismatches: [], unavailable: [], omitted: [] }
consumed-scope-audit-handoff:
  one-of:
    - handoff-version: "1.0"
      handoff-state: present
      snapshot-identity:
        snapshot-version: "1.0"
        target-id: string
        target-kind: capture | working-tree | branch | pull-request
        selected-scope: string
        repository-id: string
        base-ref: string | null
        current-ref: string | null
        branch: string | null
        repository-status: string | null
        paths-and-diffs:
          committed:
            - { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string }
          staged:
            - { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string }
          worktree:
            - { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string }
          untracked:
            - { path: string, change: added, source-path: null, mode: string | null, diff: string }
      scope-status: ready | incomplete-context | blocked
      classifications: []
      responsibility-surfaces: []
      unresolved-units: []
      missing-context: []
      invalidation-details: []
    - handoff-version: "1.0"
      handoff-state: absent
      absence-reason: missing-scope-evidence
      missing-context: [string]
behavior-authority: []
changed-system-evidence: []
supplemental-manual-cases:
  - affected-journey-or-integration: string
    trigger: string
    setup: string
    action: string
    expected-observable: string
    rationale: string
    linked-unit: string
no-impact-rationales: []
excluded-direct-scenarios: []
foreign-material: []
untraced-material: []
unresolved-exposures: []
evidence-gaps: []
invalidation-details: []
tracker-comment-draft:
  language: es
  status-visible: true
  body: string
  approval-required: true
  target-issue: string | null
  append-only: true
  deduplication-key: string
  approval-status: pending
  publication-state: draft-only
read-only-no-mutation: true
```

The draft must be Spanish, visibly state its status using the exact token `ready`, `incomplete-context`, or `blocked`, and include cases, no-impact rationales, or unresolved context as applicable. Publication is orchestrator-only: require approval of the exact draft and target issue; append only that text; deduplicate by `deduplication-key`; read back and verify the comment; and report failure without treating publication as complete.

`ready` requires current matching evidence, `scope-status: ready`, and a case or no-impact rationale for every relevant exposure. An `absent` handoff yields `incomplete-context`. `incomplete-context` requires a reviewer decision; `blocked` is a process failure, never a no-impact result.
