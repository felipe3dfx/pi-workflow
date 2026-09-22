---
name: scope-audit
description: "Trigger: audit a candidate capture, working tree, branch, or pull request before review. Produce fresh scope evidence, responsibility-surface questions, or explicit incomplete context."
license: Apache-2.0
metadata:
  author: "Grupo Ilao"
  version: "1.0.1"
  provenance: derived
---

# Audit Candidate Scope

## Activation Contract

Use before review to establish read-only evidence of which candidate diff units belong to approved ticket and technical-specification authority. Do not edit code, run implementation checks, create captures, publish tracker updates, commit, or decide correctness, security, architecture, test sufficiency, readiness, or code review.

## Required Inputs and Snapshot

Accept a candidate capture, working tree, branch, or pull request. Resolve it once into this common snapshot identity: `snapshot-version`, `target-id`, `target-kind`, `selected-scope`, `repository-id`, `base-ref`, `current-ref`, `branch`, `repository-status`, and the committed, staged, worktree, and untracked `paths-and-diffs`. Each partition contains `{path, change, source-path, mode, diff}`; use `null` when a field does not apply, sort entries by path then change, and compare all fields and diffs by deep equality. Branch and pull-request targets use committed partitions; working-tree and capture targets may also use staged, worktree, and untracked partitions.

Apply this precedence: `blocked` when the target or a required harness capability is inaccessible, no approved degraded path exists, or approved authorities contradict one another without a governing resolution; `incomplete-context` when candidate evidence is missing, omitted, stale, mismatched, or unavailable; `ready` only when required capabilities and evidence are current and complete. Record `invalidated` only in `invalidation-details`, never as a status. Keep pre-existing material, including `docs/research/`, visible.

## Audit Procedure

1. Derive ownership only from approved ticket/spec authority; repository evidence establishes freshness, not new behavior.
2. Classify every observed smallest practical path or hunk exactly once as `owned`, `supporting`, `shared`, `inherited`, `generated`, `integration-only`, `justified-fix`, `foreign`, or `untraced` when authority is sufficient.
3. Use `untraced` only for an evidenced absence of traceability: the authority and candidate evidence were examined, but establish no trace from the unit to approved ownership. Do not use it for unavailable or ambiguous authority/evidence; those units are unresolved and require `incomplete-context`.
4. For relevant navigation, authorization, persistence, state, integration, async, and presentation surfaces, emit review questions and QA implications without judging correctness.
5. Write the versioned handoff below to the handoff file for `qa-impact` and code review. The consuming review process owns requiring a final `qa-impact` result on the same final snapshot before final review publication; this skill neither publishes nor approves review.

## Handoff channel

Write the Output Contract JSON to `ilao-scope-audit-handoff.json` inside a new directory in the platform temporary directory for this invocation. Do not write it in the repository, do not name an operating-system path, and do not put the JSON in the human message. The human message states status, whether scope evidence is complete, the next action, and that handoff path. Both the message and the file must exist before the run is complete. If a later run needs the file and it is gone, regenerate it. Do not block the user and do not print the JSON. This remains scope evidence, not a review verdict.

## Output Contract

Write an object serialized as valid JSON to the handoff file, matching this field schema (the union annotations are schema notation, not literal values). Every key is mandatory; use `[]`, `{}`, or `null` when empty, and quote every string value. Every path-and-diff partition may be empty; its example item defines shape only. `ready`, `incomplete-context`, and `blocked` are the only status tokens.

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
validation: { current: boolean, mismatches: [], unavailable: [], omitted: [] }
classifications:
  - unit: string
    primary: owned | supporting | shared | inherited | generated | integration-only | justified-fix | foreign | untraced
    authority-evidence: []
    candidate-evidence: []
    rationale: string
responsibility-surfaces:
  - surface: navigation | authorization | persistence | state | integration | async | presentation
    review-questions: []
    qa-implications: []
foreign-and-excluded-pre-existing: []
unresolved-units: []
missing-context: []
invalidation-details: []
qa-impact-handoff:
  handoff-version: "1.0"
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
read-only-no-mutation: true
```

`ready` requires a current snapshot and exhaustive classification. `incomplete-context` has no valid scope evidence. An inaccessible target, unavailable required capability without an approved degraded path, or unresolved authority contradiction is `blocked`; all other missing evidence is `incomplete-context`. State that this is scope evidence, not a review verdict.
