# Promotion-readiness runtime output schema

Runtime reference: read this immediately before emitting a `promotion-readiness` result. It defines the complete JSON contract; the Issue #18 snapshot remains the authority for snapshot semantics and is carried unchanged here.

Every named key is required. `null` means known absence or inapplicability; `[]` and `{}` mean known emptiness. Evidence that is absent, inaccessible, stale, contradictory, invalid, or otherwise unevaluable must also have a corresponding `missing-evidence` item. Strings are non-empty unless explicitly nullable; a #18 `diff` may be empty when its existing snapshot semantics permit it. Union annotations are schema notation.

```yaml
schema-version: "1.0"
verdict: READY | READY WITH WARNINGS | BLOCKED
target:
  repository: string
  kind: capture | working-tree | branch | pull-request | delivery
  id: string
snapshot: object | null # Exact Issue #18 common snapshot when present; never repair or recapture it here.
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
    committed: [ { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string } ]
    staged: [ { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string } ]
    worktree: [ { path: string, change: added | modified | deleted | renamed, source-path: string | null, mode: string | null, diff: string } ]
    untracked: [ { path: string, change: added, source-path: null, mode: string | null, diff: string } ]
destination-confirmation:
  proposed: string | null
  selected: string | null
  confirmed: boolean
  evidence: string | null
bases:
  working: { value: string | null, evidence: string | null }
  production: { value: string | null, evidence: string | null }
consumed-evidence:
  - kind: scope-audit | parent-requirement | provenance | relationship | final-review | qa-impact | stack | other
    identity: string | null
    reference: string | null
    status: string | null # Preserve the source token verbatim.
    snapshot: object | null # The supplied source snapshot, unchanged.
    freshness: fresh | stale | unknown | not-applicable
    validation: valid | invalid | unavailable | contradictory | not-applicable
    gaps: [string]
    disposition: pending | accepted | rejected | none | null
provenance:
  - unit: string
    approved-scope: [string]
    integration-origin: [string]
    evidence: [string]
    gaps: [string]
    disposition: pending | accepted | rejected | none | null
parent-coverage:
  - parent: string
    requirements:
      - requirement: string
        coverage: covered | outstanding | unknown
        evidence: [string]
        gaps: [string]
        disposition: pending | accepted | rejected | none | null
    evidence: [string]
    gaps: [string]
    disposition: pending | accepted | rejected | none | null
warnings:
  - finding: string
    impact: string
    source-status: string | null
    disposition: pending | accepted | rejected | none | null
missing-evidence:
  - subject: string
    needed: string
    reason: absent | inaccessible | stale | contradictory | invalid | incomplete | untraced
    impact: string
    owner: string | null
invalidation-details:
  - subject: string
    condition: string
    effect: string
    source: string | null
feedback:
  - subject: string
    assessment: string
    supported-by: [string]
    requires-review: [string]
read-only-no-mutation: true
```

`snapshot` has the object shape shown above when present; a null top-level snapshot is known absent evidence and must be named in `missing-evidence`. A `consumed-evidence[].snapshot` is `null` without a missing-evidence item only when a snapshot is known inapplicable to that source, such as a relationship. For every source that supplied no snapshot, keep its `consumed-evidence[].snapshot` null; never synthesize one by copying the audit snapshot, including for parent requirements or provenance. If a source that requires a snapshot has none, name that absence in `missing-evidence`; otherwise use the exact supplied object. The consumed final-review and `qa-impact` snapshots must deep-equal the top-level final snapshot before either can support readiness. Do not infer a destination, bases, relationship, coverage, approval, freshness, or successful status from a proposal, stack, publication effect, accepted risk, or empty field.

Assemble snapshot fields by copying parsed source objects with available structured-data tooling, not by regenerating their text. Before emitting the result, serialize and reparse the complete output and compare the top-level snapshot and each consumed snapshot with its own supplied source by deep equality, including refs and exact diff strings. Preserve null sources as null. Formatting and key order may differ; decoded values may not. A mismatch or inability to verify preservation yields `BLOCKED` with the verification limitation; never emit `READY` from an unchecked copy. This is evidence validation within the harness, not an operational promotion step.

Each `bases.*.evidence` identifies the actual supplied authority for that base, such as `bases.production`; use null if that authority is unavailable. A proposed or selected destination is not evidence for either base, even when its value happens to match.

`BLOCKED` means the listed evidence prevents a meaningful audit, including `destination-confirmation.confirmed: false`. `READY WITH WARNINGS` requires evaluable evidence and at least one unresolved warning, risk, adverse result, provenance gap, or pending/accepted disposition. `READY` requires fresh, sufficient, consistent evidence and empty `warnings` and `missing-evidence`. A verdict never encodes a promotion action, automatic approval, or restriction on the user's manual action.
