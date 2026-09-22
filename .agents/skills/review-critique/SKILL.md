---
name: review-critique
description: "Trigger: critique a normalized code-review finding set before human publication. Return one evidence-backed verdict per finding without reviewing code or mutating external systems."
license: MIT
metadata:
  author: "Grupo Ilao"
  version: "1.0.1"
  provenance: original
---

# Critique Review Findings

## Activation Contract

Act as the adversary of `code-review`. Consume its complete normalized finding set and supplied context references; evaluate the requests, not the implementation or the code independently. Remain read-only and draft-only; create no external effect. Do not repair the handoff, edit files, comment on a pull request, approve, request changes, change tracker state, commit, create a PR, or publish.

## Decision Gates

Require a complete handoff with target and snapshot identity, Standards and Spec authorities, scope evidence, and every original finding. Apply precedence: `blocked` for an inaccessible target, contradictory authorities without governing resolution, or a required capability that is unavailable with no approved degraded path. An unavailable capability is allowed only with an explicitly approved, evidenced degraded path; `incomplete-context` applies only when the target is accessible and required evidence is missing, stale, mismatched, or unavailable. Propagate an incomplete or blocked review status rather than critiquing it as ready; in either state preserve the original findings and emit an empty `critiques` list. Otherwise return `ready`. Preserve all original findings, including an explicit empty set.

## Critique Procedure

For each finding, identify its underlying problem class from the supplied evidence, then test its evidence and traceability, reachability, user/data/operational impact, maintenance cost, proportionality, relationship to the ticket/spec, duplicate relationship, and whether its requested action expands scope. Evaluate whether the requested action closes that class proportionately, and recommend proportionate class closure only to the extent supported by the supplied evidence. Assign exactly one verdict:

- `confirmed` when evidence supports a pertinent, proportionate request;
- `narrow` when the concern is supported but the action or scope must shrink;
- `out-of-scope` when it is unrelated to authority or candidate scope;
- `unsupported` when evidence or reachability fails;
- `duplicate` when another retained finding already covers the same actionable issue;
- `uncertain` when available evidence cannot decide and requires a human disposition.

Record verdict evidence, the underlying problem class, its class-closure assessment, and a concrete recommendation. A verdict never implies approval or publication. Preserve the original stable ID and original finding unchanged; link duplicates to the retained ID instead of deleting either finding. `out-of-scope` must cite both the candidate scope and ticket/spec authority; `duplicate` must prove equivalent root problem and actionable closure, not merely similar wording; `unsupported` must cite the failed reachability or evidence path.

## Handoff channel

Write the Output Contract JSON to `ilao-review-critique-handoff.json` inside a new directory in the platform temporary directory for this invocation. Do not write it in the repository, do not name an operating-system path, and do not put the JSON in the human message. The human message states status, each finding id with its verdict and recommendation, the next action, and that handoff path. Both the message and the file must exist before the run is complete. If a later run needs the file and it is gone, regenerate it. Do not block the user and do not print the JSON.

## Output Contract

Write valid JSON to the handoff file, with exactly these top-level keys: `schema-version: "1.0"`, `status`, `draft-only: true`, `target`, `snapshot`, `validation`, `context-references`, `original-findings`, `critiques`, `human-dispositions-required`, `missing-context`, `invalidation-details`, and `read-only-no-mutation: true`. `schema-version` must be the string literal `"1.0"`; `status` must be a string. `target` contains exactly string `repository`, `kind`, and `id` fields. `target` and `snapshot` must identify the same immutable review, and `snapshot` must deep-equal the review snapshot supplied in the context references; `snapshot` contains `snapshot-version`, target/scope/repository/ref/branch/status fields, and ordered committed/staged/worktree/untracked partitions with complete path/change/source-path/mode/diff entries. `validation` contains exactly boolean `current` and array `mismatches`, `unavailable`, and `omitted` fields. `human-dispositions-required`, `missing-context`, `invalidation-details`, `original-findings`, and `critiques` are arrays. Every original finding contains exactly stable `id`, `location`, `claim`, `evidence`, `impact`, `severity`, `confidence`, `authority`, `requested-action`, and `traceability` string fields.

`context-references` contains exactly `review`, `standards`, `spec-authorities`, `scope-evidence`, `implementation-handoff`, `decisions-and-adrs`, `breadcrumbs`, and `relevant-discussion`. Its exact field types are: `review` and `implementation-handoff` objects; `standards`, `spec-authorities`, `scope-evidence`, `decisions-and-adrs`, `breadcrumbs`, and `relevant-discussion` arrays. `context-references.review` contains exactly `schema-version: "1.0"`, `status`, `target`, `snapshot`, `validation`, and `findings`; its `schema-version` is the string literal `"1.0"`, `status` is a string, `target` uses the same exact string fields, `validation` uses the same exact boolean/array fields, `snapshot` is an object, and `findings` is an array of normalized finding objects. `context-references.review.snapshot` is the supplied review snapshot and must deep-equal top-level `snapshot`, while its `target` must deep-equal `target` and its `findings` must deep-equal `original-findings`. Both snapshots contain exactly the snapshot keys `snapshot-version`, `target-id`, `target-kind`, `selected-scope`, `repository-id`, `base-ref`, `current-ref`, `branch`, `repository-status`, and `paths-and-diffs`; the first five are strings, the next four are strings or `null`, and `paths-and-diffs` is an object containing exactly `committed`, `staged`, `worktree`, and `untracked` arrays. Every partition entry contains exactly the partition entry keys `path`, `change`, `source-path`, `mode`, and `diff`; `path`, `change`, and `diff` are strings, while `source-path` and `mode` are strings or `null`. Propagate `context-references.review.status: blocked` or `incomplete-context`; only `ready` permits critique evaluation. The other context-reference fields preserve the supplied review handoff values.

Each critique contains exactly `finding-id`, `verdict`, `evidence`, `reachability`, `impact`, `proportionality`, `scope-assessment`, `underlying-problem-class`, `class-closure-assessment`, `recommendation`, and `duplicate-of`. Every critique field except `duplicate-of` is a string; `underlying-problem-class` and `class-closure-assessment` must be non-empty strings, and `duplicate-of` is a string or `null`. For `status: ready` only, emit exactly one critique per original finding, preserving order and IDs. For `blocked` or `incomplete-context`, preserve `original-findings` and emit an empty `critiques` list. Use empty arrays, objects, or `null` explicitly. Use only `ready`, `incomplete-context`, or `blocked` for status.
